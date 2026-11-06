import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

register('./publication-fixture-loader.mjs', import.meta.url);
const {createIncrementalStorage}=await import('./storage.mjs');
const {validateManifest,validateCatalogs,hash,encode}=await import('./manifest.mjs');
const {applyIncremental}=await import('./transport.mjs');
const {projectDirectory}=await import('../lib/incremental-project-directory.mjs');
const {resolveProjectDirectory}=await import('../review-frontend/shared/project-loader.mjs');
const {MAX_ACTIVE_DATASETS,MAX_DIRECTORY_PROJECTS}=await import('../review-frontend/shared/directory-policy.mjs');

function environment(t) {
 const db=new DatabaseSync(':memory:'); db.exec(fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));t.after(()=>db.close());
 const DB={prepare(sql){return{bind(...args){return{first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>db.prepare(sql).run(...args),execute:()=>db.prepare(sql).run(...args)}}}},async batch(statements){db.exec('BEGIN');try{for(const s of statements)s.execute();db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}};
 const objects=new Map(),BUCKET={async get(key){const b=objects.get(key);return b?{size:b.length,body:new Blob([b]).stream()}:null},async put(key,bytes,options){assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});if(BUCKET.beforePut)await BUCKET.beforePut(key);if(objects.has(key))return null;objects.set(key,Buffer.from(bytes));return {key}}};
 const storage=createIncrementalStorage(),env={DB,BUCKET};
 return {db,env,objects,call:(name,args)=>storage.call('entity_assets_'+name,args,env)};
}
async function bundle(datasetId='synthetic',label='Resource') {
 const docs=new Map([
  ['assets/catalog.json',{version:1,assets:[{id:'r',sourceId:'r',name:label}]}],
  ['assets/objects-catalog.json',{version:2,objects:[{id:'o',sourceId:'o',name:'Object'}]}],
  ['assets/render-profiles.json',{schemaVersion:1,profiles:[]}],
  ['assets/canopy-rules.json',{version:1,flatCanopySourceMaterialIds:[]}]
 ]),files=[],blocks={};
 for(const [path,doc] of docs){const bytes=encode(doc),sha256=await hash(bytes);files.push({id:'f'+files.length,path,bytes:bytes.length,sha256,metadata:{},revision:sha256,sourceId:path,identityKind:'stable-source',dependencyDetection:'declared-only-opaque',dependencies:[],blocks:[{sha256,bytes:bytes.length}]});blocks[sha256]=Buffer.from(bytes).toString('base64')}
 const manifest={schema:'entity-incremental-indexed/1',projectId:'HamstersAway',datasetId,adapter:'indexed-v1',animation:'metadata-only',files},v=await validateManifest(manifest);
 return {manifest,blocks,docs,v,args:{projectId:manifest.projectId,datasetId,version:v.version}};
}
async function prepare(e,b,baseVersion=null) {
 await e.call('begin',{manifest:b.manifest,baseVersion});
 for(const file of b.manifest.files){for(const block of file.blocks)await e.call('put_block',{...b.args,sha256:block.sha256,base64:b.blocks[block.sha256]});await e.call('commit_file',{...b.args,sha256:file.sha256})}
}
function seedScopes(e,count) {
 for(let i=0;i<count;i++){const version='v-'+i.toString(16).padStart(64,'0');e.db.prepare('INSERT INTO ingest_versions VALUES(?,?,?,?,?,?)').run('Sulfur','seed'+i,version,version.slice(2),1,1);e.db.prepare('INSERT INTO ingest_active VALUES(?,?,?,?)').run('Sulfur','seed'+i,version,1)}
}

test('directory accepts all 128 active scopes plus fixed entries, rejects overflow without truncation',async t=>{
 const e=environment(t);seedScopes(e,128);const directory=await (await projectDirectory(e.env)).json();assert.equal(directory.projects.length,MAX_DIRECTORY_PROJECTS);assert.equal(resolveProjectDirectory(directory).id,'entity');
 e.db.prepare('INSERT INTO ingest_active VALUES(?,?,?,?)').run('Sulfur','overflow','v-'+'f'.repeat(64),1);await assert.rejects(projectDirectory(e.env),/Directory unavailable/);
});
test('atomic last-slot admission permits one new scope and permits existing updates/replays at capacity',async t=>{
 const e=environment(t);seedScopes(e,127);const a=await bundle('lastA'),b=await bundle('lastB');await prepare(e,a);await prepare(e,b);
 const results=await Promise.allSettled([e.call('finalize',a.args),e.call('finalize',b.args)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/ingest-budget/);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ingest_active').get().n,MAX_ACTIVE_DATASETS);
 const winner=results[0].status==='fulfilled'?a:b,loser=winner===a?b:a;assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ingest_versions WHERE version=?').get(loser.v.version).n,0);
 const next=await bundle(winner.args.datasetId,'Next');await prepare(e,next,winner.v.version);assert.equal((await e.call('finalize',next.args)).revision,2);assert.equal((await e.call('finalize',winner.args)).ready,true);assert.equal((await e.call('status',winner.args)).activeVersion,next.v.version);
});
test('historical publication replays keep B active, validate receipts, and stale uncommitted plans reject',async t=>{
 const e=environment(t),a=await bundle(),b=await bundle('synthetic','B'),stale=await bundle('synthetic','stale');await prepare(e,a);await prepare(e,stale);await e.call('finalize',a.args);await prepare(e,b,a.v.version);await e.call('finalize',b.args);
 for(const result of [await e.call('begin',{manifest:a.manifest,baseVersion:null}),await e.call('finalize',a.args),await e.call('status',a.args)]){assert.equal(result.ready,true);assert.equal(result.revision,null);assert.equal(result.activeVersion,b.v.version);assert.equal(result.activeRevision,2)}
 await assert.rejects(e.call('finalize',stale.args),/ingest-baseline-conflict/);
 for(const column of ['manifest_sha','file_count','total_bytes']){const original=e.db.prepare('SELECT '+column+' AS value FROM ingest_versions WHERE version=?').get(a.v.version).value;e.db.prepare('UPDATE ingest_versions SET '+column+'=? WHERE version=?').run(column==='manifest_sha'?'bad':original+1,a.v.version);await assert.rejects(e.call('begin',{manifest:a.manifest,baseVersion:null}),/ingest-receipt/);await assert.rejects(e.call('finalize',a.args),/ingest-receipt/);e.db.prepare('UPDATE ingest_versions SET '+column+'=? WHERE version=?').run(original,a.v.version)}
});
test('transport reconciles lost finalize response after another version activates',async t=>{
 const e=environment(t),a=await bundle(),b=await bundle('synthetic','B');
 const result=await applyIncremental({bundle:a,call:async(name,args)=>{const result=await e.call(name.slice('entity_assets_'.length),args);if(name==='entity_assets_finalize'){await prepare(e,b,a.v.version);await e.call('finalize',b.args);throw Error('response lost')}return result}});
 assert.equal(result.ready,true);assert.equal(result.version,a.v.version);assert.equal(result.activeVersion,b.v.version);assert.equal(result.revision,null);assert.equal(result.createCountersComplete,false);
});
test('begin reconciles a commit between receipt and active reads',async t=>{
 const e=environment(t),a=await bundle(),b=await bundle('synthetic','B');await prepare(e,a);const original=e.env.DB.prepare;let switched=false;
 e.env.DB.prepare=function(sql){const statement=original(sql);if(!switched&&sql==='SELECT version,revision FROM ingest_active WHERE project=? AND dataset=?'){return {bind(...args){const bound=statement.bind(...args);return {...bound,async first(){switched=true;await e.call('finalize',a.args);await prepare(e,b,a.v.version);await e.call('finalize',b.args);return bound.first()}}}}}return statement};
 const result=await e.call('begin',{manifest:a.manifest,baseVersion:null});assert.equal(result.noop,true);assert.equal(result.activeVersion,b.v.version);
});
test('concurrent conditional block creates attribute exactly one creation and verify loser readback',async t=>{
 const e=environment(t),b=await bundle();await e.call('begin',{manifest:b.manifest,baseVersion:null});const file=b.manifest.files[0],args={...b.args,sha256:file.sha256,base64:b.blocks[file.sha256]};let arrivals=0,release;const gate=new Promise(resolve=>release=resolve);e.env.BUCKET.beforePut=async()=>{if(++arrivals===2)release();await gate};
 const results=await Promise.all([e.call('put_block',args),e.call('put_block',args)]);assert.equal(results.filter(r=>r.created).length,1);assert(results.every(r=>r.verified));
 e.env.BUCKET.beforePut=undefined;const key=`review-ingest/${b.v.scope}/blocks/${file.sha256}`;e.objects.set(key,Buffer.from('corrupt'));await assert.rejects(e.call('put_block',args),/ingest-integrity/);
});
test('Python rejects invalid dataset before importer loading or output work, accepts exact ASCII boundaries',()=>{
 const script=fileURLToPath(new URL('./export_local.py',import.meta.url));for(const dataset of ['', 'a'.repeat(65),'é','x.y',' x','x\n','a/b']){const r=spawnSync('python',[script,'--importer','missing-importer.py','--store','missing-store','--out','missing-out','--dataset',dataset],{encoding:'utf8'});assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/--dataset must contain/);assert.doesNotMatch(r.stderr,/FileNotFoundError/)}
 for(const dataset of ['a','A_0-','a'.repeat(64)]){const r=spawnSync('python',[script,'--importer','missing-importer.py','--store','missing-store','--out','missing-out','--dataset',dataset],{encoding:'utf8'});assert.match(r.stderr,/FileNotFoundError/);assert.doesNotMatch(r.stderr,/--dataset must contain/)}
});

test('finalize whose transaction loses to committed A and then B never reactivates A',async t=>{
 const e=environment(t),a=await bundle(),b=await bundle('synthetic','B');await prepare(e,a);
 const batch=e.env.DB.batch;let entered,release;const arrived=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let paused=false;
 e.env.DB.batch=async statements=>{if(!paused){paused=true;entered();await gate}return batch(statements)};
 const pending=e.call('finalize',a.args);await arrived;await e.call('finalize',a.args);await prepare(e,b,a.v.version);await e.call('finalize',b.args);release();
 const result=await pending;assert.equal(result.ready,true);assert.equal(result.activeVersion,b.v.version);assert.equal(result.revision,null);assert.equal(e.db.prepare('SELECT revision FROM ingest_active').get().revision,2);
});
test('finalize observes successful publication even if B commits before its readback',async t=>{
 const e=environment(t),a=await bundle(),b=await bundle('synthetic','B');await prepare(e,a);const batch=e.env.DB.batch;let advanced=false;
 e.env.DB.batch=async statements=>{await batch(statements);if(!advanced){advanced=true;await prepare(e,b,a.v.version);await e.call('finalize',b.args)}};
 const result=await e.call('finalize',a.args);assert.equal(result.ready,true);assert.equal(result.activeVersion,b.v.version);assert.equal(result.revision,null);
});
test('concurrent object creates attribute exactly one creation',async t=>{
 const e=environment(t),b=await bundle();await e.call('begin',{manifest:b.manifest,baseVersion:null});const file=b.manifest.files[0];await e.call('put_block',{...b.args,sha256:file.sha256,base64:b.blocks[file.sha256]});let arrivals=0,release;const gate=new Promise(r=>release=r);e.env.BUCKET.beforePut=async()=>{if(++arrivals===2)release();await gate};
 const results=await Promise.all([e.call('commit_file',{...b.args,sha256:file.sha256}),e.call('commit_file',{...b.args,sha256:file.sha256})]);assert.equal(results.filter(r=>r.created).length,1);assert(results.every(r=>r.verified));
});
test('conditional put loser still rejects mismatching readback',async t=>{
 const e=environment(t),b=await bundle();await e.call('begin',{manifest:b.manifest,baseVersion:null});const file=b.manifest.files[0];e.env.BUCKET.beforePut=async key=>{e.objects.set(key,Buffer.from('corrupt'))};await assert.rejects(e.call('put_block',{...b.args,sha256:file.sha256,base64:b.blocks[file.sha256]}),/ingest-integrity/);
});
test('lost block and object responses do not fabricate creation counts',async t=>{
 const e=environment(t),b=await bundle();const lost=new Set();const result=await applyIncremental({bundle:b,call:async(name,args)=>{const result=await e.call(name.slice('entity_assets_'.length),args);if(['entity_assets_put_block','entity_assets_commit_file'].includes(name)&&!lost.has(name)){lost.add(name);throw Error('response lost')}return result}});
 assert.equal(result.ready,true);assert.equal(result.reconciledResults,2);assert.equal(result.createCountersComplete,false);assert.equal(result.blocksCreated,b.v.unique.length-1);assert.equal(result.objectsCreated,b.v.unique.length-1);
});

async function runExporter(t,mutate=()=>{}){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'assets-export-contract-'));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 const b=await bundle(),files=b.manifest.files.map(f=>({...f})),blocks={...b.blocks};await mutate(files,blocks);
 const doc={scope:{rootId:'HamstersAway'},sourceLedger:files.map(f=>({id:f.id,sourceId:f.sourceId,identityKind:f.identityKind,dependencyDetection:f.dependencyDetection,dependencies:f.dependencies})),snapshot:{files}};
 fs.writeFileSync(path.join(temporary,'fixture.json'),JSON.stringify({doc,blocks}));
 const importer=path.join(temporary,'importer.py');fs.writeFileSync(importer,`import pathlib,json,base64
fixture=json.loads(pathlib.Path(__file__).with_name('fixture.json').read_text(encoding='utf-8'))
CHUNK=32768
def open_store(store):return pathlib.Path(store),{}
def current_version(root):return 'synthetic'
def validate_version(root,version):return fixture['doc']
def verify_object(root,sha,size):return {'chunks':[{'sha256':sha}]}
def read_file(file,limit):return base64.b64decode(fixture['blocks'][file.name])
def no_links(value):return pathlib.Path(value)
def overlaps(output,root):return False
def create_json(output,value):output.write_text(json.dumps(value))
`);
 const out=path.join(temporary,'output.json');const result=spawnSync('python',[fileURLToPath(new URL('./export_local.py',import.meta.url)),'--importer',importer,'--store',path.join(temporary,'store'),'--out',out],{encoding:'utf8',timeout:10000});
 assert.ifError(result.error);
 return {result,out};
}
test('exporter accepts valid prospective hosted manifest with shared dependency-free contract',async t=>{
 const {result,out}=await runExporter(t);assert.equal(result.status,0,result.stderr);const exported=JSON.parse(fs.readFileSync(out,'utf8'));await validateManifest(exported.manifest);
});
test('exporter preserves a lone surrogate and Unicode in metadata',async t=>{
 const label='\ud800 Café 林';
 const {result,out}=await runExporter(t,files=>{files[0].metadata={label}});
 assert.equal(result.status,0,result.stderr);
 const exported=JSON.parse(fs.readFileSync(out,'utf8'));
 assert.equal(exported.manifest.files[0].metadata.label,label);
 await validateManifest(exported.manifest);
});
test('exporter rejects a 1,048,577-byte file before creating the requested output',async t=>{
 const {result,out}=await runExporter(t,async(files,blocks)=>{const bytes=Buffer.alloc(1048577,120),sha256=await hash(bytes);files[0]={...files[0],bytes:bytes.length,sha256,revision:sha256};blocks[sha256]=bytes.toString('base64')});
 assert.equal(result.status,2,result.stderr);assert.match(result.stderr,/Invalid hosted manifest: ingest-schema/);assert.equal(fs.existsSync(out),false);
});
for(const [name,mutate]of[
 ['unsafe filename',files=>files[0].path='assets/../catalog.json'],
 ['unsupported uppercase extension',files=>files[0].path='assets/catalog.JSON'],
 ['malformed metadata',files=>files[0].metadata={unexpected:'value'}],
 ['missing required metadata file',files=>files.pop()],
 ['file count cap',files=>{while(files.length<2049)files.push({...files[0],id:'extra'+files.length})}],
 ['JSON count cap',files=>{while(files.length<9)files.push({...files[0],id:'extra'+files.length,path:'assets/extra'+files.length+'.json'})}]
])test('exporter structural preflight rejects '+name+' without output',async t=>{
 const {result,out}=await runExporter(t,mutate);assert.equal(result.status,2,result.stderr);assert.match(result.stderr,/Invalid hosted manifest:/);assert.equal(fs.existsSync(out),false);
});

test('frontend-invalid metadata cannot receive a publication receipt or active pointer',async t=>{
 const e=environment(t),b=await bundle('synthetic','   ');await prepare(e,b);await assert.rejects(e.call('finalize',b.args),/ingest-catalog/);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ingest_versions').get().n,0);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ingest_active').get().n,0);
});


async function refreshBundle(b){
 b.blocks={};for(const file of b.manifest.files){const bytes=encode(b.docs.get(file.path));file.sha256=await hash(bytes);file.bytes=bytes.length;file.revision=file.sha256;file.blocks=[{sha256:file.sha256,bytes:file.bytes}];b.blocks[file.sha256]=Buffer.from(bytes).toString('base64')}
 b.v=await validateManifest(b.manifest);b.args.version=b.v.version;return b;
}
for(const [name,mutate] of [
 ['synthetic-origin profile',b=>b.docs.get('assets/objects-catalog.json').profilesUrl='https://ingest.invalid/assets/render-profiles.json'],
 ['query profile unsupported by frontend',b=>b.docs.get('assets/objects-catalog.json').profilesUrl='assets/render-profiles.json?revision=1'],
 ['host-bearing profile',b=>b.docs.get('assets/objects-catalog.json').profilesUrl='//ingest.invalid/assets/render-profiles.json'],
 ['nested foreign shards',b=>b.docs.get('assets/catalog.json').assets[0].extra={assetShards:['https://foreign.invalid/shard.json']}],
 ['nested null shards',b=>b.docs.get('assets/canopy-rules.json').extra={assetShards:null}]
])test('apply rejects '+name+' before publication',async t=>{
 const e=environment(t),b=await bundle();mutate(b);await refreshBundle(b);
 await assert.rejects(applyIncremental({bundle:b,call:(name,args)=>e.call(name.slice('entity_assets_'.length),args)}),/ingest-(reference|catalog|private-metadata)/);
 assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ingest_versions').get().n,0);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ingest_active').get().n,0);
});
for(const profilesUrl of ['/assets/render-profiles.json','assets/render-profiles.json'])test('valid logical profile path publishes and loads in actual frontend '+profilesUrl,async t=>{
 const e=environment(t),b=await bundle();b.docs.get('assets/objects-catalog.json').profilesUrl=profilesUrl;await refreshBundle(b);assert.equal((await applyIncremental({bundle:b,call:(name,args)=>e.call(name.slice('entity_assets_'.length),args)})).ready,true);
 const {loadData}=await import('../review-frontend/adapters/indexed-data.mjs'),{validateCatalogData}=await import('../review-frontend/shared/project-schema.mjs');
 const root=`/api/review-assets/HamstersAway/synthetic/${b.v.version}/`;
 const data=await loadData({config:{projectId:'HamstersAway',datasetId:'synthetic',assetRoot:root,origin:'https://actual-viewer.invalid',dataKind:'indexed'},readJSON:async url=>{const target=new URL(url);assert.equal(target.origin,'https://actual-viewer.invalid');return structuredClone(b.docs.get(target.pathname.slice(root.length)))}});
 assert.equal(validateCatalogData(data).evidence.profiles.length,0);
});


for(const [label,mutate] of [
 ['blank resource ID',b=>b.docs.get('assets/catalog.json').assets[0].id='  '],
 ['reserved object ID',b=>b.docs.get('assets/objects-catalog.json').objects[0].id='constructor'],
 ['blank object name',b=>b.docs.get('assets/objects-catalog.json').objects[0].name='  '],
 ['wrong actual profiles JSON',b=>b.docs.get('assets/objects-catalog.json').profilesUrl='assets/canopy-rules.json']
])test(label+' rejects before active pointer or receipt',async t=>{
 const e=environment(t),b=await bundle();mutate(b);await refreshBundle(b);await prepare(e,b);
 await assert.rejects(e.call('finalize',b.args),/ingest-(catalog|profiles)/);
 assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ingest_versions').get().n,0);
 assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ingest_active').get().n,0);
});
test('profile reference must select JSON even when non-JSON file is registered',async()=>{
 const b=await bundle();b.v.manifest.files.push({path:'assets/preview.png'});
 b.docs.get('assets/objects-catalog.json').profilesUrl='assets/preview.png';
 assert.throws(()=>validateCatalogs(b.v,b.docs),/ingest-profiles/);
});
test('null profile reference retains the indexed adapter fallback',async t=>{
 const e=environment(t),b=await bundle();b.docs.get('assets/objects-catalog.json').profilesUrl=null;await refreshBundle(b);
 assert.equal((await applyIncremental({bundle:b,call:(name,args)=>e.call(name.slice('entity_assets_'.length),args)})).ready,true);
});
