// Immutable release-embedded bytes only. No store, upload, proxy, role inference or owner registration.
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const errors = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export function createNativeSampleHandler({ sample, getUser }) {
  return async function handle(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return Response.json({ error: 'read-only' }, { status: 405, headers: { ...errors, Allow: 'GET, HEAD' } });
    if (!await getUser()) return Response.json({ error: 'sign-in-required' }, { status: 401, headers: errors });
    const url = new URL(request.url);
    if (url.search || url.pathname.includes('%')) return Response.json({ error: 'query-or-encoding-not-supported' }, { status: 400, headers: errors });
    const item = Object.hasOwn(sample.payloads, url.pathname) && sample.payloads[url.pathname];
    if (!item) return Response.json({ error: 'not-allowlisted' }, { status: 404, headers: errors });
    if (request.headers.has('Range')) return Response.json({ error: 'range-not-supported' }, { status: 416, headers: errors });
    const bytes = Buffer.from(item.base64, 'base64');
    if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) return Response.json({ error: 'release-integrity-failed' }, { status: 503, headers: errors });
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
      'Cache-Control': 'private, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff',
      'Content-Type': item.mime, 'Content-Length': String(item.bytes), ETag: '"sha256-' + item.sha256 + '"',
      'X-Entity-Delivery-Scope': 'one-readonly-native-sample', 'Vary': 'Cookie'
    } });
  };
}
