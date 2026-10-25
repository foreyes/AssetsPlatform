import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {importDirectory} from '../scripts/import-directory.mjs';
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
  server=spawn(process.execPath,['server.mjs'],{cwd:x.output,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),5000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});server.once('exit',c=>{clearTimeout(timer);reject(Error('server exit '+c));});});
  const base=`http://127.0.0.1:${port}/`;const fetchJSON=async url=>{const r=await fetch(url);assert.equal(r.status,200,url);return r.json();};
  const project=await loadProject({fetchJSON,location:{href:base,search:''}});assert.equal(project.config.projectId,x.id);assert.equal(project.config.datasetId,report.datasetId);
  const data=await loadProjectData(project,fetchJSON);assert.equal(data.catalog.assets.length,1);assert.equal(data.objectCatalog.objects.length,1);
  const model=data.catalog.assets[0];assert(model.triangleCount>0);assert(model.vertexCount>0);assert.equal((await fetch(base+'library/assets/preview-pending.svg')).status,200);const url=project.config.resourceResolver.resolve(model.modelUrl);const response=await fetch(url);assert.equal(response.status,200);assert(parseGLB(await response.arrayBuffer()).triangles>0);
  const html=await (await fetch(base)).text();assert(html.includes('ASSET REVIEW'));
  for (const relative of ['app.mjs','viewer.mjs','shared/project-loader.mjs','adapters/indexed-data.mjs','style.css']) assert.equal((await fetch(base+relative)).status,200);
 } finally {if(server){server.kill();await new Promise(resolve=>server.once('exit',resolve));}clean(x);}
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
  fs.symlinkSync(path.join(x.source,'cube.glb'),path.join(x.source,'link.glb'));assert.throws(()=>importDirectory(x),/Symbolic links/);fs.unlinkSync(path.join(x.source,'link.glb'));
  fs.symlinkSync(x.source,path.join(x.dir,'alias'));assert.throws(()=>importDirectory({...x,source:path.join(x.dir,'alias')}),/Symbolic links/);
  const fd=fs.openSync(path.join(x.source,'large.glb'),'w');fs.ftruncateSync(fd,64*1024*1024+1);fs.closeSync(fd);assert.throws(()=>importDirectory(x),/byte budget/);assert(!fs.existsSync(x.output));
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
