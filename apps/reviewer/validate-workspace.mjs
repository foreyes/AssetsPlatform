import fs from 'node:fs';
import path from 'node:path';
import {createJSONBudget,readBoundedJSON} from './shared/json-budget.mjs';
import {validateResourceReference} from './shared/resource-url.mjs';
import {fileURLToPath} from 'node:url';
import {loadProject,loadProjectData,resolveProjectDirectory} from './shared/project-loader.mjs';
import {parseGLB,PREVIEW_LIMITS} from './viewer.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const base='http://workspace.invalid/';
function read(url,limit) {
 validateResourceReference(url);
 const u=new URL(url);
 if(u.origin!==new URL(base).origin || u.search || u.hash || u.username || u.password) throw Error('Nonlocal workspace URL: '+url);
 const relative=decodeURIComponent(u.pathname).replace(/\/+/g,'/').slice(1);
 if(relative.split('/').some(p=>!p||p==='..'||p.startsWith('.')||p.includes('\\')||process.platform==='win32'&&p.includes(':'))) throw Error('Unsafe workspace path');
 const file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep))throw Error('Workspace path escapes root');
 let current=root;for(const part of relative.split('/')){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('Workspace symlink refused');}
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>limit)throw Error('Workspace file budget exceeded: '+relative);
 return fs.readFileSync(file);
}
const MiB=1024*1024;
const offlineBudget=createJSONBudget({jsonLimits:{downloadBytes:16*MiB,decodedBytes:16*MiB,totalDownloadBytes:64*MiB,totalDecodedBytes:64*MiB}});
function descriptorBudget(){return createJSONBudget({jsonLimits:{downloadBytes:2*MiB,decodedBytes:2*MiB,totalDownloadBytes:16*MiB,totalDecodedBytes:16*MiB}});}
// One reader preserves browser BOM, gzip magic/trailer and #record semantics.
// Offline totals include every read; each bootstrap also has its browser budget.
async function fetchJSON(url,required=true,bootstrapBudget=null){
 validateResourceReference(url);
 const resolved=new URL(url), key=resolved.hash.slice(1);resolved.hash='';
 let bytes;
 try {bytes=read(resolved.href,Math.min(offlineBudget.downloadLimit,bootstrapBudget?.downloadLimit??Infinity));} catch(error) {
  if(!required&&(error.code==='ENOENT'||error.code==='ENOTDIR'))return null;
  throw error;
 }
 const options={context:resolved.href,gzip:!bootstrapBudget&&resolved.pathname.endsWith('.gz')};
 const data=await readBoundedJSON(new Response(bytes),{...options,budget:offlineBudget});
 if(bootstrapBudget)await readBoundedJSON(new Response(bytes),{...options,budget:bootstrapBudget});
 if(!key)return data;
 const record=data.records?.[decodeURIComponent(key)];
 if(!record&&required)throw Error('索引分片缺少对应源记录');
 return record||null;
}

try {
 const directory=await fetchJSON(base+'project-directory.json',true,descriptorBudget());
 resolveProjectDirectory(directory,'',base);
 const results=[];
 for(const entry of directory.projects||[]) {
  const budget=descriptorBudget();
  const project=await loadProject({fetchJSON:url=>fetchJSON(url,true,budget),location:{href:base,search:'?project='+encodeURIComponent(entry.id)}});
  const data=await loadProjectData(project,fetchJSON), objects=data.objectCatalog.objects ?? data.objectCatalog.assets, items=[...data.catalog.assets,...objects];
  if(!objects.length)throw Error('物件目录暂不可用');
  const modelURLs=new Set(items.flatMap(item=>[item.modelUrl,item.assemblyModelUrl,item.materialModelUrl].filter(Boolean)).map(url=>project.config.resourceResolver.resolve(url)));
  const models=[];
  for(const url of modelURLs){const g=parseGLB(read(url,PREVIEW_LIMITS.downloadBytes));models.push({path:new URL(url).pathname,vertexCount:g.vertices,triangleCount:g.triangles,warnings:g.warnings});}
  results.push({projectId:entry.id,datasetId:project.config.datasetId,resources:data.catalog.assets.length,objects:objects.length,models});
 }
 if(!results.length)throw Error('No projects registered');
 console.log(JSON.stringify({passed:true,scope:'registered indexed catalogs and referenced GLB CPU parsing',gpu:'not-verified',browserOpenability:'not-verified',jsonBudgetScope:'independent offline 16 MiB/file and 64 MiB/aggregate raw and decoded; browser descriptor 2 MiB/file and 16 MiB/bootstrap enforced; per-project browser data limits not verified',projects:results},null,2));
} catch(error){console.error('Workspace validation failed: '+error.message);process.exitCode=1;}
