import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=path.join(root,'apps/reviewer');
const check=spawnSync(process.execPath,['verify.mjs'],{cwd:app,encoding:'utf8'});
assert.equal(check.status,0,check.stdout+check.stderr);
const {parseGLB}=await import('../apps/reviewer/viewer.mjs');
let sampleGLBParses=0;
const directory=JSON.parse(fs.readFileSync(path.join(app,'project-directory.json')));
for(const entry of directory.projects){
 const folder=path.dirname(path.join(app,entry.config));
 const catalog=JSON.parse(fs.readFileSync(path.join(folder,'assets/catalog.json')));
 const objects=JSON.parse(fs.readFileSync(path.join(folder,'assets/objects-catalog.json')));
 for(const model of new Set([...catalog.assets,...objects.objects].map(item=>item.modelUrl).filter(Boolean))){
  const b=fs.readFileSync(path.join(folder,model));
  const g=parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  assert(g,'sample parsed');sampleGLBParses++;
 }
}
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>['.git','dist'].includes(e.name)?[]:e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);}
const all=walk(root);let links=0;
for(const p of all.filter(p=>p.endsWith('.md'))){
 const s=fs.readFileSync(p,'utf8');
 for(const m of s.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
  const url=m[1];if(/^(https?:|#)/.test(url))continue;
  assert(fs.existsSync(path.resolve(path.dirname(p),url.split('#')[0])),`missing document link ${p}: ${url}`);links++;
 }
}
for(const p of all){
 assert(!/\/(?:node_modules|\.env|\.openai|\.wrangler)(?:\/|$)/.test(p),'excluded payload');
 if(p.endsWith('.glb'))assert(p.startsWith(app+path.sep),'only own demo GLBs');
}
const port=30000+Math.floor(Math.random()*20000);
const server=spawn(process.execPath,[path.join(app,'server.mjs')],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
try{
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('local server startup timeout')),5000);
  server.stdout.once('data',()=>{clearTimeout(timeout);resolve();});
  server.once('exit',code=>{clearTimeout(timeout);reject(Error('server exited '+code));});
 });
 const base=`http://127.0.0.1:${port}`;
 let res=await fetch(base+'/');assert.equal(res.status,200);assert((await res.text()).includes('ASSET REVIEW'));
 res=await fetch(base+'/project-directory.json');assert.equal((await res.json()).projects.length,directory.projects.length);
 res=await fetch(base+'/demo-a/assets/cube.glb',{method:'HEAD'});assert.equal(res.status,200);assert.equal((await res.arrayBuffer()).byteLength,0);
 res=await fetch(base+'/',{method:'POST'});assert.equal(res.status,405);
 res=await fetch(base+'/missing.json');assert.equal(res.status,404);
}finally{server.kill();await new Promise(resolve=>server.once('exit',resolve));}
console.log(JSON.stringify({passed:true,appVerification:JSON.parse(check.stdout),sampleGLBParses,documentLinksChecked:links,files:all.length,localHTTP:['GET index','GET directory','HEAD model','reject POST','missing 404'],hostedBackendBuild:'not-in-public-scope',gpu:'not-run',networkDependencyAudit:'not-comprehensive'}));
