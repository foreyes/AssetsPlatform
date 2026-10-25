import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SITES_IDENTITY_CONTRACT, guardFixedAssetRequest, runWithSitesIdentityContract, isSitesIdentityRequest} from '../lib/sites-identity-contract.mjs';
const env = {ASSET_IDENTITY_CONTRACT: SITES_IDENTITY_CONTRACT};
const headers = {'oai-authenticated-user-id': 'synthetic-user', 'oai-authenticated-user-email': 'synthetic@example.invalid'};
test('fixed assets deny absent or unknown deployment contract despite spoofed headers', () => {
  for (const path of ['/__entity_assets/v/a.glb', '/__entity_bundles/a', '/__entity_static_fallback/a']) {
    for (const config of [{}, {ASSET_IDENTITY_CONTRACT:'generic'}]) assert.equal(guardFixedAssetRequest(new Request('https://example.invalid'+path,{headers}),config).status,503);
  }
});
test('fixed assets deny anonymous and blank identity; internal fallback never public', () => {
  for(const h of [{}, {...headers,'oai-authenticated-user-id':' '}]) assert.equal(guardFixedAssetRequest(new Request('https://example.invalid/__entity_assets/a',{headers:h}),env).status,401);
  assert.equal(guardFixedAssetRequest(new Request('https://example.invalid/__entity_static_fallback/a',{headers}),env).status,404);
  assert.equal(guardFixedAssetRequest(new Request('https://example.invalid/__entity_assets/a',{headers}),env),null);
});
test('contract context defaults closed and isolates simultaneous requests', async () => {
  assert.equal(isSitesIdentityRequest(),false);
  await Promise.all([runWithSitesIdentityContract(env,async()=>{await new Promise(r=>setTimeout(r,10));assert.equal(isSitesIdentityRequest(),true);}),runWithSitesIdentityContract({},async()=>{await Promise.resolve();assert.equal(isSitesIdentityRequest(),false);})]);
  assert.equal(isSitesIdentityRequest(),false);
});

test('Worker gates fixed assets before storage and keeps identity request-scoped', async () => {
  const fs=await import('node:fs');
  const worker=fs.readFileSync('worker/index.ts','utf8');
  const auth=fs.readFileSync('app/chatgpt-auth.ts','utf8');
  const vite=fs.readFileSync('vite.config.ts','utf8');
  assert(worker.indexOf('guardFixedAssetRequest(request, env)')<worker.indexOf('batch877.read(request, env)'));
  assert.match(worker,/runWithSitesIdentityContract\(env/);
  assert(auth.indexOf('if (!isSitesIdentityRequest()) return null;')<auth.indexOf('await headers()'));
  assert.match(vite,/ASSET_IDENTITY_CONTRACT: "sites-private-ingress-v1"/);
  assert.match(vite,/"\/__entity_static_fallback\/\*"/);
});
