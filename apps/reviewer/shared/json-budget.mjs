// Page-lifetime byte limits bound both concurrent downloads and gzip inflation.
const MiB = 1024 * 1024;
function limit(value, fallback, cap) {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), cap) : fallback;
}
export function createJSONBudget(config = {}) {
  const options = config.jsonLimits || {};
  return {
    downloadLimit: limit(options.downloadBytes, 64 * MiB, 256 * MiB),
    decodedLimit: limit(options.decodedBytes, 128 * MiB, 256 * MiB),
    totalDownloadLimit: limit(options.totalDownloadBytes, 512 * MiB, 1024 * MiB),
    totalDecodedLimit: limit(options.totalDecodedBytes, 512 * MiB, 1024 * MiB),
    downloaded: 0,
    decoded: 0
  };
}
async function collect(stream, budget, kind, context) {
  if (!stream?.getReader) throw Error(`${context}: streaming response required for bounded JSON`);
  const reader = stream.getReader(),
    chunks = [];
  let size = 0;
  const key = kind === 'download' ? 'downloaded' : 'decoded',
    max = kind === 'download' ? budget.downloadLimit : budget.decodedLimit,
    total = kind === 'download' ? budget.totalDownloadLimit : budget.totalDecodedLimit;
  try {
    while (true) {
      const {
        done,
        value
      } = await reader.read();
      if (done) break;
      size += value.byteLength;
      budget[key] += value.byteLength;
      if (size > max || budget[key] > total) throw Error(`${context}: JSON ${kind} byte budget exceeded; reload to start a new bounded session`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export async function readBoundedJSON(response, {
  budget = createJSONBudget(),
  context = 'JSON',
  gzip = false
} = {}) {
  const length = Number(response.headers?.get('content-length'));
  if (Number.isFinite(length) && length > budget.downloadLimit) {
    await response.body?.cancel();
    throw Error(`${context}: JSON download byte budget exceeded`);
  }
  let bytes = await collect(response.body, budget, 'download', context);
  if (gzip && bytes[0] === 31 && bytes[1] === 139) {
    if (typeof DecompressionStream !== 'function') throw Error('This browser does not support gzip JSON decompression');
    bytes = await collect(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), budget, 'decoded', context);
  } else {
    budget.decoded += bytes.byteLength;
    if (bytes.byteLength > budget.decodedLimit || budget.decoded > budget.totalDecodedLimit) throw Error(`${context}: JSON decoded byte budget exceeded`);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
