import {fileURLToPath} from 'node:url';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const root=path.dirname(fileURLToPath(import.meta.url));
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{assert(!e.isSymbolicLink(),'Verification does not follow symlinks: '+e.name);return e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)];});}
const files=walk(root);
for(const file of files){
 assert(!/\/(?:\.git|\.env|\.openai|node_modules|\.wrangler)(?:\/|$)/.test(file));
 if(!/\.(?:mjs|js|html|css|json|md)$/.test(file))continue;
 const text=fs.readFileSync(file,'utf8');
 assert(!/appgprj_[a-z0-9]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|https?:\/\/[^\s]+\.chatgpt\.site|\/workspace\/scratch\//i.test(text),path.basename(file)+' contains private deployment data');
 for(const m of text.matchAll(/(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g))assert(fs.existsSync(path.resolve(path.dirname(file),m[2])),file+' missing '+m[2]);
}
const directory=JSON.parse(fs.readFileSync(path.join(root,'project-directory.json')));
for(const entry of directory.projects){
 const configPath=path.join(root,entry.config),config=JSON.parse(fs.readFileSync(configPath));assert.equal(config.id,entry.id);
 const assets=path.join(path.dirname(configPath),'assets');
 for(const name of ['catalog.json','objects-catalog.json','render-profiles.json'])assert(fs.existsSync(path.join(assets,name)));
 const catalog=JSON.parse(fs.readFileSync(path.join(assets,'catalog.json')));
 const objects=JSON.parse(fs.readFileSync(path.join(assets,'objects-catalog.json')));
 const models=[...new Set([...catalog.assets,...objects.objects].map(item=>item.modelUrl).filter(Boolean))];
 assert(models.length,'project requires a model');
 for(const model of models){
  const b=fs.readFileSync(path.join(path.dirname(configPath),model));assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(8),b.length);
  const gltf=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());assert(gltf.buffers.every(b=>!b.uri));assert(!gltf.images?.some(i=>i.uri));
 }
}
console.log(JSON.stringify({passed:true,files:files.length,catalogues:directory.projects.length,dependencyAudit:{scope:'static relative import existence and selected private-data patterns only',externalDependenciesMeasured:false,browserNetworkVerified:false,dynamicImportsFullyResolved:false,cssDependenciesTraversed:false,licenseAuditPerformed:false},gpuVerified:false}));
