import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {gzipSync} from 'node:zlib';
import {createServer} from 'node:net';
import {runInNewContext} from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateResourceReference} from '../apps/reviewer/shared/resource-url.mjs';
import {createJSONBudget,readBoundedJSON} from '../apps/reviewer/shared/json-budget.mjs';
import {importDirectory} from '../scripts/import-directory.mjs';
import {startLocalTestServer} from '../scripts/local-test-server.mjs';
import {loadProject,loadProjectData} from '../apps/reviewer/shared/project-loader.mjs';
import {parseGLB} from '../apps/reviewer/viewer.mjs';
import {createWorkbench} from '../apps/reviewer/shared/workbench.mjs';
import {reviewBackupIdentity} from '../apps/reviewer/shared/review-export.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cube=fs.readFileSync(path.join(root,'apps/reviewer/demo-a/assets/cube.glb'));
function setup() { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'directory-import-'));const source=path.join(dir,'source');fs.mkdirSync(source);return {dir,source,output:path.join(dir,'out'),id:'my-library'}; }
function clean(x){fs.rmSync(x.dir,{recursive:true,force:true});}
test('standalone imported workspace loads through real HTTP, loader, adapter and parser',async()=>{
 const x=setup();let server;
 try {
  fs.mkdirSync(path.join(x.source,'nested'));fs.writeFileSync(path.join(x.source,'nested','彩色 cube.GLB'),cube);fs.writeFileSync(path.join(x.source,'secret.txt'),'not included');
  const report=importDirectory(x);assert.equal(report.models,1);
  const validation=spawnSync(process.execPath,['validate-workspace.mjs'],{cwd:x.output,encoding:'utf8'});assert.equal(validation.status,0,validation.stderr);assert.equal(JSON.parse(validation.stdout).projects[0].models.length,1);
  assert(!fs.existsSync(path.join(x.output,'demo-a')));assert(!fs.existsSync(path.join(x.output,'secret.txt')));
  const manifest=JSON.parse(fs.readFileSync(path.join(x.output,'import-report.json')));assert.equal(manifest.files[0].relative,'nested/彩色 cube.GLB');
  const port=30000+Math.floor(Math.random()*20000);
  server=startLocalTestServer('server.mjs',{cwd:x.output,port});
  await server.waitUntilReady();
  const base=`http://127.0.0.1:${port}/`;const fetchJSON=async url=>{const r=await fetch(url);assert.equal(r.status,200,url);return r.json();};
  const project=await loadProject({fetchJSON,location:{href:base,search:''}});assert.equal(project.config.projectId,x.id);assert.equal(project.config.datasetId,report.datasetId);
  const data=await loadProjectData(project,fetchJSON);assert.equal(data.catalog.assets.length,1);assert.equal(data.objectCatalog.objects.length,1);
  const model=data.catalog.assets[0];assert(model.triangleCount>0);assert(model.vertexCount>0);assert.equal((await fetch(base+'library/assets/preview-pending.svg')).status,200);const url=project.config.resourceResolver.resolve(model.modelUrl);const response=await fetch(url);assert.equal(response.status,200);assert(parseGLB(await response.arrayBuffer()).triangles>0);
  const html=await (await fetch(base)).text();assert(html.includes('ASSET REVIEW'));
  for (const relative of ['app.mjs','viewer.mjs','shared/project-loader.mjs','adapters/indexed-data.mjs','style.css']) assert.equal((await fetch(base+relative)).status,200);
 } finally {
  try {
   await server?.stop();
  } finally {
   clean(x);
  }
 }
});
test('same input preserves identity, content changes isolate dataset and review keys',()=>{
 const x=setup();try {
  fs.writeFileSync(path.join(x.source,'cube.glb'),cube);const a=importDirectory(x);const b=importDirectory({...x,output:path.join(x.dir,'second')});assert.equal(a.datasetId,b.datasetId);
  fs.copyFileSync(path.join(x.source,'cube.glb'),path.join(x.source,'new.glb'));const c=importDirectory({...x,output:path.join(x.dir,'third')});assert.notEqual(a.datasetId,c.datasetId);
  const read=p=>JSON.parse(fs.readFileSync(path.join(p,'library/project-config.json')));assert.notEqual(read(a.output).config.reviewKey,read(c.output).config.reviewKey);
  const old=fs.readFileSync(path.join(a.output,'project-directory.json'));assert.throws(()=>importDirectory(x),/already exists/);assert.deepEqual(fs.readFileSync(path.join(a.output,'project-directory.json')),old);
 }finally{clean(x);}
});
test('invalid and external models fail without leaving output; non-assets and hidden directories excluded',()=>{
 const x=setup();try {
  assert.throws(()=>importDirectory(x),/No visible/);assert(!fs.existsSync(x.output));
  fs.writeFileSync(path.join(x.source,'broken.glb'),'invalid');assert.throws(()=>importDirectory(x));assert(!fs.existsSync(x.output));fs.unlinkSync(path.join(x.source,'broken.glb'));
  const doc={asset:{version:'2.0'},buffers:[{byteLength:4,uri:'https://example.com/private'}]};let js=Buffer.from(JSON.stringify(doc));js=Buffer.concat([js,Buffer.alloc((4-js.length%4)%4,32)]);const out=Buffer.alloc(28+js.length);out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(js.length,12);out.writeUInt32LE(0x4e4f534a,16);js.copy(out,20);out.writeUInt32LE(0,20+js.length);out.writeUInt32LE(0x004e4942,24+js.length);fs.writeFileSync(path.join(x.source,'external.glb'),out);assert.throws(()=>importDirectory(x));assert(!fs.existsSync(x.output));fs.unlinkSync(path.join(x.source,'external.glb'));
  fs.mkdirSync(path.join(x.source,'.private'));fs.writeFileSync(path.join(x.source,'.private','bad.glb'),'invalid');fs.writeFileSync(path.join(x.source,'cube.glb'),cube);assert.equal(importDirectory(x).models,1);
 }finally{clean(x);}
});
test('unsafe IDs, symlinks, overlapping paths and oversized GLBs are refused',()=>{
 const x=setup();try {
  fs.writeFileSync(path.join(x.source,'cube.glb'),cube);
  assert.throws(()=>importDirectory({...x,id:'../../escape'}));
  assert.throws(()=>importDirectory({...x,output:path.join(x.source,'output')}),/outside/);
  assert.throws(()=>importDirectory({...x,output:path.join(root,'output')}),/outside/);
  assert.throws(()=>importDirectory({...x,source:path.parse(x.dir).root}),/outside/);
  if (process.platform === 'win32') {
   const sourceAlias = path.join(x.dir, 'SOURCE');
   if (fs.existsSync(sourceAlias)) {
    assert.throws(()=>importDirectory({...x,output:path.join(sourceAlias,'output')}),/outside/);
   }
   const repositoryAlias = root.toLowerCase();
   if (repositoryAlias !== root && fs.existsSync(repositoryAlias)) {
    assert.throws(()=>importDirectory({...x,output:path.join(repositoryAlias,'output')}),/outside/);
   }
  }
  fs.symlinkSync(path.join(x.source,'cube.glb'),path.join(x.source,'link.glb'));assert.throws(()=>importDirectory(x),/Symbolic links/);fs.unlinkSync(path.join(x.source,'link.glb'));
  fs.symlinkSync(x.source,path.join(x.dir,'alias'));assert.throws(()=>importDirectory({...x,source:path.join(x.dir,'alias')}),/Symbolic links/);
  const fd=fs.openSync(path.join(x.source,'large.glb'),'w');fs.ftruncateSync(fd,64*1024*1024+1);fs.closeSync(fd);assert.throws(()=>importDirectory(x),/byte budget/);assert(!fs.existsSync(x.output));
 }finally{clean(x);}
});

test('lexical source and repository boundaries survive a directory mount', t=>{
 const x=setup();
 try {
  const sourceMount=path.join(x.source,'mounted');
  const repositoryMount=path.join(root,'scripts');
  fs.mkdirSync(sourceMount);
  const outputParents=[sourceMount,repositoryMount];
  const caseAlias=path.join(x.dir,'SOURCE','mounted');
  if(process.platform==='win32'&&fs.existsSync(caseAlias))outputParents.push(caseAlias);
  const nestedSource=path.join(sourceMount,'nested');
  fs.mkdirSync(nestedSource);
  const nativeRealpath=fs.realpathSync.native;
  t.mock.method(fs.realpathSync,'native',file=>{
   // NTFS folder-mounted volumes can report a directory to lstat but resolve
   // under a different drive root. Redirect only the paths that model mounts.
   if(outputParents.includes(file)||file===nestedSource)return x.dir;
   return nativeRealpath(file);
  });
  for(const outputParent of outputParents){
   const output=path.join(outputParent,path.basename(x.dir)+'-output');
   assert.throws(()=>importDirectory({...x,output}),/outside source and platform repository/);
   assert(!fs.existsSync(output));
  }
  assert.throws(()=>importDirectory({...x,source:nestedSource,output:sourceMount}),/outside source and platform repository/);
 }finally{clean(x);}
});

test('a case-distinct directory is usable when the filesystem gives it a separate identity', t=>{
 const x=setup();
 try {
  const sibling=path.join(x.dir,'SOURCE');
  if(fs.existsSync(sibling)){t.skip('temporary filesystem is case-insensitive');return;}
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(x.source,'cube.glb'),cube);
  const output=path.join(sibling,'output');
  assert.equal(importDirectory({...x,output}).models,1);
  assert(fs.existsSync(path.join(output,'import-report.json')));
 }finally{clean(x);}
});

test('duplicate JSON chunks cannot bypass self-contained URI screening',()=>{
 const x=setup();try {
  const size=cube.readUInt32LE(12);const doc=JSON.parse(cube.subarray(20,20+size).toString());doc.buffers[0].uri='https://invalid.example/private.bin';
  let bytes=Buffer.from(JSON.stringify(doc));bytes=Buffer.concat([bytes,Buffer.alloc((4-bytes.length%4)%4,32)]);const chunk=Buffer.alloc(8);chunk.writeUInt32LE(bytes.length,0);chunk.writeUInt32LE(0x4e4f534a,4);
  const malformed=Buffer.concat([cube,chunk,bytes]);malformed.writeUInt32LE(malformed.length,8);fs.writeFileSync(path.join(x.source,'duplicate.glb'),malformed);
  assert.throws(()=>importDirectory(x),/exactly one JSON/);assert(!fs.existsSync(x.output));
 } finally {clean(x);}
});

test('portable validator catches a missing arbitrary model, without cube assumptions',()=>{
 const x=setup();try{fs.writeFileSync(path.join(x.source,'arbitrary.glb'),cube);importDirectory(x);const catalog=JSON.parse(fs.readFileSync(path.join(x.output,'library/assets/catalog.json')));fs.unlinkSync(path.join(x.output,'library',catalog.assets[0].modelUrl));const result=spawnSync(process.execPath,['validate-workspace.mjs'],{cwd:x.output,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/validation failed/);}finally{clean(x);}
});

test('snapshot backup round-trip works, and changed bytes cannot silently inherit selection or review',()=>{
 const x=setup();try {
  const file=path.join(x.source,'same-path.glb');fs.writeFileSync(file,cube);importDirectory(x);
  const configFor=out=>{const d=JSON.parse(fs.readFileSync(path.join(out,'library/project-config.json')));return {...d.config,projectId:d.id,datasetId:d.datasetId};};
  const idsFor=out=>JSON.parse(fs.readFileSync(path.join(out,'library/assets/objects-catalog.json'))).objects.map(o=>o.id);
  const a=configFor(x.output),ids=idsFor(x.output);const backup=JSON.stringify({...reviewBackupIdentity(a),selected:ids,reviews:{[ids[0]]:{status:'keep',comment:'Check silhouette'}}});
  const restored=createWorkbench(a).parseReviewImport(backup,new Set(ids));assert.deepEqual(restored.selected,ids);assert.equal(restored.reviews[ids[0]].comment,'Check silhouette');
  const changed=Buffer.from(cube);const length=changed.readUInt32LE(12);let text=changed.subarray(20,20+length).toString();const trailing=text.lastIndexOf(' ');assert(trailing>=0);changed[20+trailing]=10;fs.writeFileSync(file,changed);
  const second=path.join(x.dir,'changed');importDirectory({...x,output:second});const b=configFor(second);assert.deepEqual(idsFor(second),ids);assert.notEqual(a.datasetId,b.datasetId);assert.notEqual(a.reviewKey,b.reviewKey);assert.throws(()=>createWorkbench(b).parseReviewImport(backup,new Set(ids)),/身份不匹配/);
 }finally{clean(x);}
});

test('whitespace-only model basename gets a valid deterministic display name',()=>{
 const x=setup();try{fs.writeFileSync(path.join(x.source,' .glb'),cube);importDirectory(x);const catalog=JSON.parse(fs.readFileSync(path.join(x.output,'library/assets/catalog.json')));assert.match(catalog.assets[0].name,/^Model [a-f0-9]{12}$/);const r=spawnSync(process.execPath,['validate-workspace.mjs'],{cwd:x.output,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}finally{clean(x);}
});


test('offline validator handles optional absence, real gzip, fragments and legacy object assets',()=>{
 const x=setup();try {
  fs.writeFileSync(path.join(x.source,'cube.glb'),cube);importDirectory(x);
  const assets=path.join(x.output,'library/assets'), catalog=JSON.parse(fs.readFileSync(path.join(assets,'catalog.json'))), objects=JSON.parse(fs.readFileSync(path.join(assets,'objects-catalog.json')));
  for(const file of ['render-profiles.json','canopy-rules.json'])fs.rmSync(path.join(assets,file),{force:true});
  fs.writeFileSync(path.join(assets,'records.json.gz'),gzipSync(JSON.stringify({records:{resources:catalog.assets,profiles:{profiles:[]}}})));
  catalog.assetShards=['assets/records.json.gz#resources'];delete catalog.assets;
  fs.writeFileSync(path.join(assets,'catalog.json'),JSON.stringify(catalog));
  objects.assets=objects.objects;delete objects.objects;objects.profilesUrl='assets//records.json.gz#profiles';
  fs.writeFileSync(path.join(assets,'objects-catalog.json'),JSON.stringify(objects));
  const r=spawnSync(process.execPath,['validate-workspace.mjs'],{cwd:x.output,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).projects[0].objects,1);assert.equal(JSON.parse(r.stdout).browserOpenability,'not-verified');
 }finally{clean(x);}
});

for(const failure of ['optional-malformed','gzip-malformed','gzip-trailer','descriptor-limit','descriptor-total','gzip-decoded-limit','compressed-limit','aggregate-decoded','aggregate-download','empty-objects','invalid-default','unsafe-optional','optional-symlink'])test('offline validator rejects '+failure,()=>{
 const x=setup();try {
  fs.writeFileSync(path.join(x.source,'cube.glb'),cube);importDirectory(x);
  const assets=path.join(x.output,'library/assets');
  const read=file=>JSON.parse(fs.readFileSync(path.join(assets,file)));
  const write=(file,value)=>fs.writeFileSync(path.join(assets,file),JSON.stringify(value));
  const objects=read('objects-catalog.json'),catalog=read('catalog.json');
  switch(failure){
   case 'optional-malformed':fs.writeFileSync(path.join(assets,'canopy-rules.json'),'{broken');break;
   case 'gzip-malformed':objects.profilesUrl='assets/bad.json.gz';fs.writeFileSync(path.join(assets,'bad.json.gz'),Buffer.from([31,139,0]));break;
   case 'gzip-trailer':objects.profilesUrl='assets/bad.json.gz';fs.writeFileSync(path.join(assets,'bad.json.gz'),Buffer.concat([gzipSync('{}'),Buffer.from('junk')]));break;
   case 'descriptor-limit':{const file=path.join(x.output,'library/project-config.json');fs.appendFileSync(file,' '.repeat(2*1024*1024));break;}
   case 'descriptor-total':{
    const file=path.join(x.output,'project-directory.json'),directory=JSON.parse(fs.readFileSync(file)),base=JSON.parse(fs.readFileSync(path.join(x.output,'library/project-config.json')));
    directory.projects=[];
    for(let n=0;n<9;n++){const d=structuredClone(base);d.id='p'+n;d.config.reviewKey='r'+n;d.config.renderPreferenceKey='v'+n;d.assetRoot='./library/';fs.writeFileSync(path.join(x.output,'p'+n+'.json'),JSON.stringify(d)+' '.repeat(1900*1024));directory.projects.push({id:d.id,config:'p'+n+'.json'});}
    directory.defaultProject='p0';fs.writeFileSync(file,JSON.stringify(directory));break;
   }
   case 'gzip-decoded-limit':objects.profilesUrl='assets/bad.json.gz';fs.writeFileSync(path.join(assets,'bad.json.gz'),gzipSync(' '.repeat(17*1024*1024)+'{}'));break;
   case 'compressed-limit':objects.profilesUrl='assets/bad.json.gz';fs.writeFileSync(path.join(assets,'bad.json.gz'),Buffer.alloc(17*1024*1024));break;
   case 'aggregate-decoded':case 'aggregate-download':{
    const gzip=failure==='aggregate-decoded',filename='large.json'+(gzip?'.gz':'');
    const bytes=Buffer.from(' '.repeat(14*1024*1024)+'[]');fs.writeFileSync(path.join(assets,filename),gzip?gzipSync(bytes):bytes);
    catalog.assetShards=Array(5).fill('assets/'+filename);write('catalog.json',catalog);break;
   }
   case 'empty-objects':objects.objects=[];break;
   case 'invalid-default':{const file=path.join(x.output,'project-directory.json'),directory=JSON.parse(fs.readFileSync(file));directory.defaultProject='unknown';fs.writeFileSync(file,JSON.stringify(directory));break;}
   case 'unsafe-optional':objects.profilesUrl='assets/%2e%2e/secret.json';break;
   case 'optional-symlink':fs.symlinkSync(x.source,path.join(assets,'link'),process.platform==='win32'?'junction':'dir');objects.profilesUrl='assets/link/absent.json';break;
  }
  write('objects-catalog.json',objects);
  const r=spawnSync(process.execPath,['validate-workspace.mjs'],{cwd:x.output,encoding:'utf8'});assert.notEqual(r.status,0,failure+' unexpectedly passed');assert.match(r.stderr,/validation failed/);
  if(failure==='aggregate-decoded')assert.match(r.stderr,/buffer|length|budget/i);
  if(failure==='aggregate-download')assert.match(r.stderr,/download byte budget/);
 }finally{clean(x);}
});

test('manual setup validator remains an exact runnable copy',()=>{
 const guide=fs.readFileSync(path.join(root,'docs/ASSET-INGESTION-STANDARD.md'),'utf8');
 const embedded=guide.slice(guide.indexOf('## 17 ')).match(/```js\r?\n([\s\S]*?)```/)[1];
 assert.equal(embedded.replaceAll('\r\n','\n'),fs.readFileSync(path.join(root,'apps/reviewer/validate-workspace.mjs'),'utf8').replaceAll('\r\n','\n'));
});


async function availablePort(){
 const listener=createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 const port=listener.address().port;await new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));return port;
}

test('offline validator treats a child of a regular file as missing only when optional',async()=>{
 const x=setup();let server;
 try {
  fs.writeFileSync(path.join(x.source,'cube.glb'),cube);importDirectory(x);
  const assets=path.join(x.output,'library/assets'),objectsFile=path.join(assets,'objects-catalog.json');
  const missing='assets/existing.json/child.json';
  fs.writeFileSync(path.join(assets,'existing.json'),'{}');
  const objects=JSON.parse(fs.readFileSync(objectsFile));
  objects.profilesUrl=missing;fs.writeFileSync(objectsFile,JSON.stringify(objects));

  const port=await availablePort();server=startLocalTestServer('server.mjs',{cwd:x.output,port});await server.waitUntilReady();
  const response=await fetch(`http://127.0.0.1:${port}/library/${missing}`);
  assert.equal(response.status,404);await response.arrayBuffer();
  const validate=()=>spawnSync(process.execPath,['validate-workspace.mjs'],{cwd:x.output,encoding:'utf8'});
  const optional=validate();assert.equal(optional.status,0,optional.stderr);

  const catalogFile=path.join(assets,'catalog.json'),catalog=JSON.parse(fs.readFileSync(catalogFile));
  delete catalog.assets;catalog.assetShards=[missing];fs.writeFileSync(catalogFile,JSON.stringify(catalog));
  const required=validate();assert.notEqual(required.status,0);assert.match(required.stderr,/ENOTDIR|ENOENT/);
 }finally{await server?.stop();clean(x);}
});

test('offline JSON skips optional ENOTDIR but propagates permission errors on every platform',async()=>{
 const source=fs.readFileSync(path.join(root,'apps/reviewer/validate-workspace.mjs'),'utf8');
 const functionSource=source.slice(source.indexOf('async function fetchJSON('),source.indexOf('\ntry {'));
 for(const code of ['ENOTDIR','EACCES']){
  const error=Object.assign(new Error(code),{code});
  const fetchJSON=runInNewContext(functionSource+';fetchJSON',{
   URL,validateResourceReference,offlineBudget:{downloadLimit:1024},read:()=>{throw error;}
  });
  const url='http://workspace.invalid/assets/existing.json/child.json';
  await assert.rejects(fetchJSON(url),rejection=>rejection===error);
  if(code==='ENOTDIR')assert.equal(await fetchJSON(url,false),null);
  else await assert.rejects(fetchJSON(url,false),rejection=>rejection===error);
 }
});

for(const variant of ['plain-gz-fragment','bom','gzip-trailing-junk','gzip','bad-json'])test('offline JSON matches browser reader '+variant,async()=>{
 const x=setup();let server;try{
  fs.writeFileSync(path.join(x.source,'cube.glb'),cube);importDirectory(x);
  const assets=path.join(x.output,'library/assets'),objects=JSON.parse(fs.readFileSync(path.join(assets,'objects-catalog.json')));
  const json=JSON.stringify({records:{profile:{profiles:[]}}});
  let bytes=Buffer.from(json);
  if(variant==='bom')bytes=Buffer.concat([Buffer.from([239,187,191]),bytes]);
  if(variant==='gzip'||variant==='gzip-trailing-junk')bytes=gzipSync(bytes);
  if(variant==='gzip-trailing-junk')bytes=Buffer.concat([bytes,Buffer.from('junk')]);
  if(variant==='bad-json')bytes=Buffer.from('{broken');
  objects.profilesUrl='assets/profiles.json.gz#profile';fs.writeFileSync(path.join(assets,'objects-catalog.json'),JSON.stringify(objects));fs.writeFileSync(path.join(assets,'profiles.json.gz'),bytes);
  const port=await availablePort();server=startLocalTestServer('server.mjs',{cwd:x.output,port});await server.waitUntilReady();
  let browserAccepted=true;
  try{const data=await readBoundedJSON(await fetch(`http://127.0.0.1:${port}/library/assets/profiles.json.gz`),{budget:createJSONBudget(),gzip:true});assert(data.records.profile);}catch{browserAccepted=false;}
  const result=spawnSync(process.execPath,['validate-workspace.mjs'],{cwd:x.output,encoding:'utf8'});
  assert.equal(result.status===0,browserAccepted,result.stderr);
 }finally{await server?.stop();clean(x);}
});
test('offline pass explicitly leaves lower per-project browser data budgets unverified',()=>{
 const x=setup();try{
  fs.writeFileSync(path.join(x.source,'cube.glb'),cube);importDirectory(x);
  const file=path.join(x.output,'library/project-config.json'),descriptor=JSON.parse(fs.readFileSync(file));
  descriptor.config.jsonLimits={downloadBytes:1,decodedBytes:1};fs.writeFileSync(file,JSON.stringify(descriptor));
  const run=spawnSync(process.execPath,['validate-workspace.mjs'],{cwd:x.output,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(run.stdout);assert.equal(report.browserOpenability,'not-verified');assert.match(report.jsonBudgetScope,/per-project browser data limits not verified/);
 }finally{clean(x);}
});


for(const declaration of ['missing-animation','missing-actions','malformed','valid-absent'])test('optional animation files require valid URL declarations: '+declaration,()=>{
 const x=setup();try{
  fs.writeFileSync(path.join(x.source,'cube.glb'),cube);importDirectory(x);
  const file=path.join(x.output,'library/project-config.json'),descriptor=JSON.parse(fs.readFileSync(file));
  Object.assign(descriptor.config,{verifiedAnimation:true,animationCatalogUrl:'assets/absent-animation.json',actionsCatalogUrl:'assets/absent-actions.json'});
  if(declaration==='missing-animation')delete descriptor.config.animationCatalogUrl;
  if(declaration==='missing-actions')delete descriptor.config.actionsCatalogUrl;
  if(declaration==='malformed')descriptor.config.animationCatalogUrl={path:'assets/absent-animation.json'};
  fs.writeFileSync(file,JSON.stringify(descriptor));
  const run=spawnSync(process.execPath,['validate-workspace.mjs'],{cwd:x.output,encoding:'utf8'});
  if(declaration==='valid-absent')assert.equal(run.status,0,run.stderr);else{assert.notEqual(run.status,0);assert.match(run.stderr,/Unsafe resource reference/);}
 }finally{clean(x);}
});


test('offline read path keeps POSIX literal/encoded colon filenames while Windows rejects them',()=>{
 const source=fs.readFileSync(path.join(root,'apps/reviewer/validate-workspace.mjs'),'utf8');
 const functionSource=source.slice(source.indexOf('function read('),source.indexOf('const MiB='));
 const bytes=Buffer.from('{}'),files=new Map([['/workspace/assets/notes:2026.json',bytes]]);
 const filesystem={lstatSync:()=>({isSymbolicLink:()=>false}),statSync:file=>({isFile:()=>files.has(file),size:bytes.length}),readFileSync:file=>{assert(files.has(file));return files.get(file);}};
 for(const platform of ['linux','darwin','win32']){
  const read=runInNewContext(functionSource+';read',{root:'/workspace',base:'http://workspace.invalid/',URL,path:path.posix,fs:filesystem,process:{platform},validateResourceReference});
  for(const name of ['notes:2026.json','notes%3A2026.json']){
   const url='http://workspace.invalid/assets/'+name;
   if(platform==='win32')assert.throws(()=>read(url,1024),/Unsafe workspace path/);else assert.equal(read(url,1024),bytes);
  }
 }
});
