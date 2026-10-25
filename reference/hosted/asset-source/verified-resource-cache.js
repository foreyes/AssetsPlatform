/**
 * Browser/worker-only content transport. No renderer, DOM, Node import, persistence,
 * or external URL support. JSON/dependency-closure validation belongs to the caller.
 *
 * A cache entry is private. Every successful get() returns a newly owned ArrayBuffer.
 * maxBytes bounds retained cache bytes, not consumer copies. At most concurrency
 * jobs own transport/read/hash/cancellation work, each bounded by maxResourceBytes.
 * A fetch/stream that ignores abort can retain a slot indefinitely: timeout rejects
 * consumers, but never pretends that the underlying work has stopped.
 */
const MIB = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const RESOURCE_PATH = /^(?:\/api\/assets\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)|\/__entity_assets\/(batch-[a-f0-9]{64}))\/(?:models\/([a-f0-9]{64})\.gltf|resources\/([a-f0-9]{64})\.bin)$/;

function error(name, code, message, cause) {
  const result = new Error(message);
  result.name = name;
  result.code = code;
  if (cause !== undefined) result.cause = cause;
  return result;
}
function abortError(message = 'Resource request cancelled', cause) {
  return error('AbortError', 'ERR_ABORTED', message, cause);
}
function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
function descriptor(input, maxResourceBytes) {
  if (!input || typeof input !== 'object' || typeof input.url !== 'string'
      || typeof input.sha256 !== 'string' || !SHA256.test(input.sha256)
      || !Number.isSafeInteger(input.bytes) || input.bytes < 0) {
    throw error('ResourceValidationError', 'ERR_RESOURCE_DESCRIPTOR', 'Resource requires a strict URL, lowercase SHA-256 and nonnegative byte length');
  }
  const match = RESOURCE_PATH.exec(input.url);
  if (!match || match[0] !== input.url || match[1] === '.' || match[1] === '..' || match[2] === '.' || match[2] === '..'
      || (match[4] || match[5]) !== input.sha256) {
    throw error('ResourceValidationError', 'ERR_RESOURCE_URL', 'Only exact same-origin content-addressed asset paths matching the SHA-256 are permitted');
  }
  if (input.bytes > maxResourceBytes) {
    throw error('ResourceLimitError', 'ERR_RESOURCE_LIMIT', 'Declared resource exceeds maxResourceBytes');
  }
  // Snapshot caller-owned metadata before any asynchronous work.
  return { url: input.url, sha256: input.sha256, bytes: input.bytes, key: `${input.sha256}:${input.bytes}` };
}
function validateSignal(signal) {
  if (signal != null && (typeof signal.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
    throw new TypeError('signal must be an AbortSignal');
  }
}

export function createVerifiedResourceCache({
  fetcher = globalThis.fetch,
  concurrency = 4,
  maxBytes = 64 * MIB,
  maxResourceBytes = 64 * MIB,
  timeoutMs = 30000,
} = {}) {
  if (typeof fetcher !== 'function') throw new TypeError('fetcher must be a function');
  integer(concurrency, 'concurrency', 1);
  integer(maxBytes, 'maxBytes');
  integer(maxResourceBytes, 'maxResourceBytes');
  integer(timeoutMs, 'timeoutMs', 1, 2147483647);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') throw new Error('Native WebCrypto SHA-256 is required');

  const entries = new Map(); // In insertion/LRU order; buffers never leave this closure.
  const tasks = new Map(); // Only joinable tasks. Stopped active jobs still hold slots.
  const waiting = [];
  const counters = { calls: 0, hits: 0, deduplicated: 0, fetches: 0, verified: 0, failed: 0, aborted: 0, timedOut: 0, evictions: 0 };
  let cachedBytes = 0;
  let active = 0;
  let disposed = false;

  function removeCurrent(task) {
    if (tasks.get(task.resource.key) === task) tasks.delete(task.resource.key);
  }
  function detach(subscriber) {
    subscriber.signal?.removeEventListener('abort', subscriber.onAbort);
  }
  function requestCancel(task) {
    if (task.reader && !task.cancelPromise) {
      // Keep the job's slot until the real cancellation promise settles as well.
      // A rejection means cancellation has settled; the original failure is kept.
      try { task.cancelPromise = Promise.resolve(task.reader.cancel(task.failure)).catch(() => {}); }
      catch { task.cancelPromise = Promise.resolve(); }
    }
  }
  function stop(task, failure, kind = 'failed') {
    if (task.stopped || task.finished) return;
    task.stopped = true;
    task.failure = failure;
    counters[kind]++;
    clearTimeout(task.timer);
    removeCurrent(task);
    if (task.state === 'queued') {
      const position = waiting.indexOf(task);
      if (position !== -1) waiting.splice(position, 1);
      task.state = 'settled';
    }
    for (const subscriber of task.subscribers) {
      detach(subscriber);
      subscriber.reject(failure);
    }
    task.subscribers.clear();
    task.controller.abort(failure);
    requestCancel(task);
  }
  function checkRunning(task) {
    if (task.stopped) throw task.failure;
  }
  function remember(resource, buffer) {
    if (buffer.byteLength > maxBytes || maxBytes === 0) return;
    const old = entries.get(resource.key);
    if (old) { cachedBytes -= old.byteLength; entries.delete(resource.key); }
    while (cachedBytes + buffer.byteLength > maxBytes && entries.size) {
      const oldest = entries.keys().next().value;
      cachedBytes -= entries.get(oldest).byteLength;
      entries.delete(oldest);
      counters.evictions++;
    }
    entries.set(resource.key, buffer);
    cachedBytes += buffer.byteLength;
  }
  function validateResponse(response, resource) {
    if (!response || response.ok !== true || !Number.isInteger(response.status)
        || response.status < 200 || response.status >= 300) {
      throw error('ResourceResponseError', 'ERR_RESOURCE_HTTP', `Resource HTTP request failed (${response?.status ?? 'no response'})`);
    }
    if (response.redirected || response.type === 'opaqueredirect' || response.type === 'opaque') {
      throw error('ResourceResponseError', 'ERR_RESOURCE_REDIRECT', 'Redirected or opaque asset responses are forbidden');
    }
    // A native same-origin fetch with redirect:error cannot leave the origin.
    // Also refuse any noncanonical response path when the response exposes a URL.
    if (response.url) {
      let finalURL;
      try { finalURL = new URL(response.url); } catch {
        throw error('ResourceResponseError', 'ERR_RESOURCE_REDIRECT', 'Invalid final response URL');
      }
      if (finalURL.pathname !== resource.url || finalURL.search || finalURL.hash
          || finalURL.username || finalURL.password
          || !['https:', 'http:'].includes(finalURL.protocol)
          || (globalThis.location?.origin && finalURL.origin !== globalThis.location.origin)) {
        throw error('ResourceResponseError', 'ERR_RESOURCE_REDIRECT', 'Asset response URL changed');
      }
    }
    const contentLength = response.headers?.get?.('content-length');
    const encoding = response.headers?.get?.('content-encoding');
    // HTTP content-encoding may make Content-Length differ from decoded bytes.
    // Never treat headers as proof: stream length and SHA are always checked below.
    if (contentLength != null && (!encoding || encoding.toLowerCase() === 'identity')) {
      if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength))
          || Number(contentLength) !== resource.bytes) {
        throw error('ResourceIntegrityError', 'ERR_RESOURCE_LENGTH', 'Content-Length differs from the declared resource length');
      }
    }
  }
  async function execute(task) {
    const resource = task.resource;
    let readComplete = false;
    try {
      counters.fetches++;
      const response = await fetcher(resource.url, {
        method: 'GET', credentials: 'same-origin', mode: 'same-origin',
        redirect: 'error', cache: 'no-store', signal: task.controller.signal,
      });
      // Acquire ownership before validation so an invalid or late response is
      // cancelled too. No response.arrayBuffer() fallback can bypass our budget.
      if (response?.body != null) {
        if (typeof response.body.getReader !== 'function') {
          throw error('ResourceResponseError', 'ERR_RESOURCE_STREAM', 'A readable byte stream is required');
        }
        task.reader = response.body.getReader();
      }
      checkRunning(task);
      validateResponse(response, resource);
      if (!task.reader && resource.bytes !== 0) {
        throw error('ResourceIntegrityError', 'ERR_RESOURCE_LENGTH', 'Resource body is missing');
      }
      const output = new Uint8Array(resource.bytes);
      let received = 0;
      if (task.reader) {
        for (;;) {
          checkRunning(task);
          const { done, value } = await task.reader.read();
          checkRunning(task);
          if (done) { readComplete = true; break; }
          if (!(value instanceof Uint8Array)) {
            throw error('ResourceResponseError', 'ERR_RESOURCE_STREAM', 'Response body produced a non-byte chunk');
          }
          // Check BEFORE copying or accumulating; output is fixed at declared size.
          if (value.byteLength > resource.bytes - received) {
            throw error('ResourceLimitError', 'ERR_RESOURCE_LIMIT', 'Stream exceeds the declared resource length');
          }
          output.set(value, received);
          received += value.byteLength;
        }
      } else readComplete = true;
      if (received !== resource.bytes) {
        throw error('ResourceIntegrityError', 'ERR_RESOURCE_LENGTH', 'Actual resource length differs from its declaration');
      }
      checkRunning(task);
      const digest = new Uint8Array(await subtle.digest('SHA-256', output));
      checkRunning(task);
      const actualSHA = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
      if (actualSHA !== resource.sha256) {
        throw error('ResourceIntegrityError', 'ERR_RESOURCE_SHA256', 'Actual resource SHA-256 differs from its declaration');
      }
      // No await between the cancellation check and cache commit/delivery.
      remember(resource, output.buffer);
      counters.verified++;
      task.finished = true;
      clearTimeout(task.timer);
      removeCurrent(task);
      for (const subscriber of task.subscribers) {
        detach(subscriber);
        try { subscriber.resolve(output.buffer.slice(0)); }
        catch (failure) { subscriber.reject(failure); }
      }
      task.subscribers.clear();
    } catch (failure) {
      stop(task, failure);
    } finally {
      if (task.reader && !readComplete) requestCancel(task);
      if (task.cancelPromise) await task.cancelPromise;
      if (task.reader) {
        try { task.reader.releaseLock(); } catch { /* Already released/errored. */ }
      }
      task.reader = null;
      task.state = 'settled';
      clearTimeout(task.timer);
      removeCurrent(task); // Identity guard protects a newer task with the same key.
      active--;
      drain();
    }
  }
  function drain() {
    while (!disposed && active < concurrency && waiting.length) {
      const task = waiting.shift();
      if (task.stopped || task.subscribers.size === 0) continue;
      task.state = 'active';
      active++;
      // execute catches failures and retains the slot through real cleanup.
      void execute(task);
    }
  }
  function get(input, options = {}) {
    try {
      if (disposed) return Promise.reject(error('DisposedError', 'ERR_DISPOSED', 'Resource cache has been disposed'));
      const resource = descriptor(input, maxResourceBytes);
      const signal = options.signal;
      validateSignal(signal);
      if (signal?.aborted) return Promise.reject(abortError('Resource request cancelled', signal.reason));
      counters.calls++;
      const entry = entries.get(resource.key);
      if (entry) {
        entries.delete(resource.key);
        entries.set(resource.key, entry);
        counters.hits++;
        return Promise.resolve(entry.slice(0));
      }
      let task = tasks.get(resource.key);
      const fresh = !task;
      if (fresh) {
        task = {
          resource, controller: new AbortController(), subscribers: new Set(),
          state: 'queued', stopped: false, finished: false, failure: null,
          reader: null, cancelPromise: null, timer: null,
        };
        tasks.set(resource.key, task);
      } else counters.deduplicated++;
      const result = new Promise((resolve, reject) => {
        const subscriber = { signal, resolve, reject, onAbort: null };
        subscriber.onAbort = () => {
          if (!task.subscribers.delete(subscriber)) return;
          detach(subscriber);
          const failure = abortError('Resource request cancelled', signal.reason);
          reject(failure);
          if (task.subscribers.size === 0) stop(task, failure, 'aborted');
        };
        task.subscribers.add(subscriber);
        signal?.addEventListener('abort', subscriber.onAbort, { once: true });
        if (signal?.aborted) subscriber.onAbort();
      });
      if (fresh && !task.stopped) {
        // Whole-job deadline includes queue time. Joining does not extend it.
        task.timer = setTimeout(() => stop(task,
          error('TimeoutError', 'ERR_RESOURCE_TIMEOUT', 'Resource request timed out'), 'timedOut'), timeoutMs);
        waiting.push(task);
        drain();
      }
      return result;
    } catch (failure) { return Promise.reject(failure); }
  }
  function invalidate(permanent) {
    if (permanent) disposed = true;
    entries.clear();
    cachedBytes = 0;
    const failure = abortError(permanent ? 'Resource cache disposed' : 'Resource cache cleared');
    failure.code = permanent ? 'ERR_DISPOSED' : 'ERR_CLEARED';
    for (const task of [...tasks.values()]) stop(task, failure, 'aborted');
  }
  return Object.freeze({
    get,
    /** Clear cached bytes and cancel all current consumers/work. Reusable afterward.
     * Returns immediately; abandoned non-abortable jobs retain active slots. */
    clear() { invalidate(false); },
    /** Same as clear, permanently preventing future gets. Idempotent. */
    dispose() { if (!disposed) invalidate(true); },
    get stats() {
      return Object.freeze({ ...counters, active, queued: waiting.length, pending: tasks.size,
        subscribers: [...tasks.values()].reduce((sum, task) => sum + task.subscribers.size, 0),
        cacheEntries: entries.size, cacheBytes: cachedBytes,
        concurrency, maxBytes, maxResourceBytes, timeoutMs, disposed });
    },
  });
}
