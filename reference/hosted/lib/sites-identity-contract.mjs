import { AsyncLocalStorage } from 'node:async_hooks';

// This is an explicit deployment contract, NOT signature verification. Only the
// official private Sites ingress may set these identity headers; it must strip
// client-supplied values and enforce the site's audience, including static files.
export const SITES_IDENTITY_CONTRACT = 'sites-private-ingress-v1';
const trust = new AsyncLocalStorage();
export function hasSitesIdentityContract(env) {
  return env?.ASSET_IDENTITY_CONTRACT === SITES_IDENTITY_CONTRACT;
}
export function runWithSitesIdentityContract(env, run) {
  return trust.run(hasSitesIdentityContract(env), run);
}
export function isSitesIdentityRequest() {
  return trust.getStore() === true;
}
export function hasSitesIdentityHeaders(headers) {
  return Boolean(headers.get('oai-authenticated-user-id')?.trim()
    && headers.get('oai-authenticated-user-email')?.trim());
}
export function guardFixedAssetRequest(request, env) {
  const pathname = new URL(request.url).pathname;
  if (!/^\/(?:__entity_assets|__entity_bundles|__entity_static_fallback)(?:\/|$)/.test(pathname)) return null;
  const headers = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'};
  if (!hasSitesIdentityContract(env)) {
    return Response.json({error: 'trusted-ingress-not-configured'}, {status: 503, headers});
  }
  if (!hasSitesIdentityHeaders(request.headers)) {
    return Response.json({error: 'sign-in-required'}, {status: 401, headers});
  }
  // Fallback is internal to the binding, never a client-addressable asset route.
  if (pathname.startsWith('/__entity_static_fallback')) {
    return Response.json({error: 'not-found'}, {status: 404, headers});
  }
  return null;
}
