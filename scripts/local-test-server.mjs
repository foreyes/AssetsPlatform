import {spawn} from 'node:child_process';

const STARTUP_TIMEOUT_MS = 5000;
const STDERR_TAIL_LENGTH = 4096;

export function startLocalTestServer(script, {cwd, port}) {
  const child = spawn(process.execPath, [script], {
    cwd,
    env: {...process.env, PORT: String(port)},
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let childError;
  child.on('error', error => { childError = error; });
  const closed = new Promise(resolve => {
    child.once('close', (code, signal) => resolve({code, signal}));
  });

  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL_LENGTH);
  });

  const readyMessage = `Asset Review: http://127.0.0.1:${port}/`;
  const started = new Promise(resolve => {
    let pending = '';
    child.stdout.setEncoding('utf8').on('data', chunk => {
      const output = pending + chunk;
      if (output.includes(readyMessage)) resolve();
      pending = output.slice(-readyMessage.length);
    });
  });

  return {
    async waitUntilReady() {
      let timer;
      try {
        await Promise.race([
          started,
          closed.then(({code, signal}) => {
            if (childError) throw Error(`Local server process failed: ${childError.message}`, {cause: childError});
            const status = signal ? `signal ${signal}` : `code ${code}`;
            const details = stderr.trim();
            throw Error(`Local server exited before ready (${status})${details ? `\n${details}` : ''}`);
          }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('Local server startup timeout')), STARTUP_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    async stop() {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    },
  };
}
