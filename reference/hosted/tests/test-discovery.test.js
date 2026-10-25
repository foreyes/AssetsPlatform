import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('default discovery includes ingestion, frontend and registry regression suites',()=>{
 const result=spawnSync(process.execPath,['scripts/test-unit.mjs','--list'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 for(const path of ['incremental-candidate/guards.test.mjs','review-frontend/tests/resource-url.test.mjs','shared-core/render-profile-registry-0.2.0/tests/registry.test.mjs','shared-core/render-profile-registry-0.2.0/tests/composition.test.mjs']) assert(result.stdout.split('\n').includes(path),path);
 assert(!result.stdout.includes('node_modules/'));
});
