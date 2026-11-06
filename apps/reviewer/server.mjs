import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.svg':'image/svg+xml'};
const port=Number(process.env.PORT||8768);

function endWithStatus(res, status) {
  res.writeHead(status);
  res.end();
}

function handleFileError(res, error) {
  if (res.destroyed) return;
  const missing = error.code === 'ENOENT' || error.code === 'ENOTDIR';
  if (!missing || res.headersSent) console.error('Static file request failed:', error.code || error.name);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  endWithStatus(res, missing ? 404 : 500);
}

function streamFile(res, target, headers) {
  const file = fs.createReadStream(target);
  file.on('error', error => handleFileError(res, error));
  res.once('close', () => file.destroy());
  res.on('error', () => {
    file.destroy();
    res.destroy();
  });
  file.once('open', () => {
    if (res.destroyed) {
      file.destroy();
      return;
    }
    res.writeHead(200, headers);
    file.pipe(res);
  });
}

http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return endWithStatus(res, 405);
  let requested;
  try {
    requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return endWithStatus(res, 400);
  }
  if (requested.includes('\0') || requested.split('/').some(part => part.startsWith('.'))) return endWithStatus(res, 404);
  const target = path.resolve(root, '.' + requested + (requested.endsWith('/') ? 'index.html' : ''));
  if (!target.startsWith(root + path.sep)) return endWithStatus(res, 404);

  try {
    const realTarget = fs.realpathSync(target);
    if (!realTarget.startsWith(root + path.sep) ||
        path.relative(root, realTarget).split(path.sep).some(part => part.startsWith('.')) ||
        !fs.statSync(realTarget).isFile()) return endWithStatus(res, 404);

    const headers = {
      'Content-Type': types[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    streamFile(res, realTarget, headers);
  } catch (error) {
    handleFileError(res, error);
  }
}).listen(port,'127.0.0.1',()=>console.log(`Asset Review: http://127.0.0.1:${port}/`));
