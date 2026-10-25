import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createIncrementalStorage} from './storage.mjs';
import {hash,validateManifest,encode} from './manifest.mjs';

// Exercise actual SQL and byte verification; the in-memory bucket only replaces
// the R2 transport. No cloud state, credentials, or private fixture is required.
async function fixture(evidence={label:'safe evidence'}){
 const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const DB={prepare(sql){return{bind(...args){return{first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>db.prepare(sql).run(...args)}}}},async batch(statements){db.exec('BEGIN');try{for(const s of statements)await s.run();db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}};
 const objects=new Map(),BUCKET={async get(key){const b=objects.get(key);return b?{size:b.length,body:new Blob([b]).stream()}:null},async put(key,b){objects.set(key,Buffer.from(b))}};
 const docs=new Map([
  ['assets/catalog.json',{version:1,assets:[{id:'r',sourceId:'synthetic:r',name:'Resource',type:'mesh',modelUrl:'assets/model.glb'}]}],
  ['assets/objects-catalog.json',{version:2,objects:[{id:'o',sourceId:'synthetic:o',name:'Object',modelUrl:'assets/model.glb'}]}],
  ['assets/render-profiles.json',{schemaVersion:1,profiles:[]}],['assets/canopy-rules.json',{version:1,flatCanopySourceMaterialIds:[]}]
 ]);
 const j={asset:{version:'2.0'},extras:evidence,scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[0,0,0]}]};
 let body=Buffer.from(JSON.stringify(j));body=Buffer.concat([body,Buffer.alloc((4-body.length%4)%4,32)]);const model=Buffer.alloc(28+body.length+36);model.writeUInt32LE(0x46546c67);model.writeUInt32LE(2,4);model.writeUInt32LE(model.length,8);model.writeUInt32LE(body.length,12);model.writeUInt32LE(0x4e4f534a,16);body.copy(model,20);model.writeUInt32LE(36,20+body.length);model.writeUInt32LE(0x004e4942,24+body.length);
 const files=[];for(const[path,bytes]of[...[...docs].map(([p,d])=>[p,encode(d)]),['assets/model.glb',model]]){const sha256=await hash(bytes);files.push({id:'f'+files.length,path,bytes:bytes.length,sha256,metadata:{label:path},revision:sha256,sourceId:'synthetic:'+path,identityKind:'stable-source',dependencyDetection:'declared-only-opaque',dependencies:[],blocks:[{sha256,bytes:bytes.length}]});objects.set(`review-ingest/HamstersAway/privacy/objects/${sha256}`,bytes)}
 const manifest={schema:'entity-incremental-indexed/1',projectId:'HamstersAway',datasetId:'privacy',adapter:'indexed-v1',animation:'metadata-only',files},v=await validateManifest(manifest),storage=createIncrementalStorage(),env={DB,BUCKET};
 const args={projectId:manifest.projectId,datasetId:manifest.datasetId,version:v.version},call=(name,extra={})=>storage.call('entity_assets_'+name,{...args,...extra},env);
 await storage.call('entity_assets_begin',{manifest,baseVersion:null},env);
 for(const f of files)db.prepare('INSERT INTO ingest_files VALUES(?,?,?,?,?,?)').run(args.projectId,args.datasetId,f.sha256,f.bytes,f.path.split('.').at(-1),'indexed-static-1');
 return{db,storage,env,args,v,files,call,close:()=>db.close()};
}
test('legacy receipts need full content revalidation before activation; safe migration is resumable',async()=>{const f=await fixture();try{
 assert.equal((await f.call('status')).verifiedObjects,0);
 for(const file of f.files){assert.equal((await f.call('check_file',{sha256:file.sha256})).verified,false);assert.equal((await f.call('commit_file',{sha256:file.sha256})).verified,true);assert.equal((await f.call('check_file',{sha256:file.sha256})).verified,true)}
 assert.equal((await f.call('status')).verifiedObjects,f.files.length);assert.equal((await f.call('finalize')).ready,true);assert.equal((await f.call('finalize')).revision,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ingest_files WHERE validation=?').get('indexed-static-2').n,f.files.length);
 }finally{f.close()}});
test('legacy GLB private extras cannot be relabeled or activated',async()=>{const f=await fixture({apiKey:'synthetic-not-a-secret'});try{
 const model=f.files.at(-1);await assert.rejects(f.call('commit_file',{sha256:model.sha256}),/ingest-private-metadata/);
 assert.equal(f.db.prepare('SELECT validation FROM ingest_files WHERE sha=?').get(model.sha256).validation,'indexed-static-1');
 await assert.rejects(f.call('finalize'),/ingest-incomplete/);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ingest_active').get().n,0);
 }finally{f.close()}});
test('existing immutable ready versions remain readable without relabeling legacy receipts',async()=>{const f=await fixture();try{
 f.db.prepare('INSERT INTO ingest_versions VALUES(?,?,?,?,?,?)').run(f.args.projectId,f.args.datasetId,f.args.version,f.v.sha256,f.files.length,f.v.totalBytes);
 const response=await f.storage.read(new Request(`https://review.invalid/api/review-assets/${f.args.projectId}/${f.args.datasetId}/${f.args.version}/assets/model.glb`),f.env);
 assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,f.files.at(-1).bytes);
 assert.equal(f.db.prepare('SELECT DISTINCT validation FROM ingest_files').get().validation,'indexed-static-1');
 }finally{f.close()}});
test('unknown receipt versions and conflicting sizes cannot be upgraded',async()=>{const f=await fixture();try{
 const file=f.files[0];f.db.prepare('UPDATE ingest_files SET validation=? WHERE sha=?').run('future-unknown',file.sha256);
 await assert.rejects(f.call('status'),/ingest-conflict/);await assert.rejects(f.call('commit_file',{sha256:file.sha256}),/ingest-receipt/);
 f.db.prepare('UPDATE ingest_files SET validation=?,bytes=bytes+1 WHERE sha=?').run('indexed-static-1',file.sha256);
 await assert.rejects(f.call('commit_file',{sha256:file.sha256}),/ingest-receipt/);
 }finally{f.close()}});
