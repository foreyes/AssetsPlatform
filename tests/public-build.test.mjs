import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function build(){const r=spawnSync(process.execPath,['scripts/build-public.mjs'],{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);return fs.readFileSync(path.join(root,'dist/reviewer/build-manifest.json'),'utf8');}
test('public build is deterministic, allowlisted and explicitly backend-free',()=>{
 const first=build();assert.equal(build(),first);
 const manifest=JSON.parse(first);
 assert.deepEqual(manifest.capabilities,{staticReview:true,hostedAuthentication:false,backendIngestion:false,fixedPrivatePilots:false});
 assert(manifest.files['index.html']);assert(manifest.files['demo-a/assets/cube.glb']);
 for(const [relative,hash] of Object.entries(manifest.files)){
  const bytes=fs.readFileSync(path.join(root,'dist/reviewer',relative));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
  if (/\.(?:mjs|js)$/.test(relative)) for (const match of bytes.toString().matchAll(/(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g)) {
    assert(fs.existsSync(path.resolve(root,'dist/reviewer',path.dirname(relative),match[2])), 'missing built import '+relative+': '+match[2]);
  }
 }
 assert(!fs.existsSync(path.join(root,'dist/reviewer/server.mjs')));
 assert(!fs.existsSync(path.join(root,'dist/reviewer/reference')));
});

test('isolated build refuses symlink inputs and outputs, and never copies unlisted data',()=>{
 const sandbox=fs.mkdtempSync('/tmp/public-build-test-');
 try {
  fs.mkdirSync(path.join(sandbox,'scripts'));
  fs.mkdirSync(path.join(sandbox,'apps/reviewer'),{recursive:true});
  fs.copyFileSync(path.join(root,'scripts/build-public.mjs'),path.join(sandbox,'scripts/build-public.mjs'));
  fs.writeFileSync(path.join(sandbox,'scripts/public-build-inputs.json'),JSON.stringify(['index.html']));
  fs.writeFileSync(path.join(sandbox,'apps/reviewer/index.html'),'synthetic');
  fs.writeFileSync(path.join(sandbox,'apps/reviewer/unlisted-private.json'),'must not copy');
  const run=()=>spawnSync(process.execPath,['scripts/build-public.mjs'],{cwd:sandbox,encoding:'utf8'});
  assert.equal(run().status,0);
  assert(!fs.existsSync(path.join(sandbox,'dist/reviewer/unlisted-private.json')));
  fs.rmSync(path.join(sandbox,'apps/reviewer/index.html'));
  fs.symlinkSync(path.join(sandbox,'apps/reviewer/unlisted-private.json'),path.join(sandbox,'apps/reviewer/index.html'));
  assert.notEqual(run().status,0);
  fs.rmSync(path.join(sandbox,'apps/reviewer/index.html'));
  fs.writeFileSync(path.join(sandbox,'apps/reviewer/index.html'),'synthetic');
  fs.rmSync(path.join(sandbox,'dist'),{recursive:true});
  fs.symlinkSync(path.join(sandbox,'missing'),path.join(sandbox,'dist'));
  assert.notEqual(run().status,0);
  assert(!fs.existsSync(path.join(sandbox,'missing')));
 } finally {fs.rmSync(sandbox,{recursive:true,force:true});}
});
