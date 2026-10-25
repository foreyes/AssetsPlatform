import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadProject,loadProjectData} from './shared/project-loader.mjs';
import {parseGLB,PREVIEW_LIMITS} from './viewer.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const base='http://workspace.invalid/';
function read(url,limit) {
 const u=new URL(url,base);
 if(u.origin!==new URL(base).origin || u.search || u.hash) throw Error('Nonlocal workspace URL: '+url);
 const relative=decodeURIComponent(u.pathname).slice(1);
 if(relative.split('/').some(p=>!p||p==='..'||p.startsWith('.'))) throw Error('Unsafe workspace path');
 const file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep))throw Error('Workspace path escapes root');
 let current=root;for(const part of relative.split('/')){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('Workspace symlink refused');}
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>limit)throw Error('Workspace file budget exceeded: '+relative);
 return fs.readFileSync(file);
}
let totalJSON=0;
const fetchJSON=async url=>{const bytes=read(url,16*1024*1024);totalJSON+=bytes.length;if(totalJSON>64*1024*1024)throw Error('Aggregate workspace JSON budget exceeded');return JSON.parse(bytes.toString('utf8'));};
try {
 const directory=await fetchJSON(base+'project-directory.json');
 const results=[];
 for(const entry of directory.projects||[]) {
  const project=await loadProject({fetchJSON,location:{href:base,search:'?project='+encodeURIComponent(entry.id)}});
  const data=await loadProjectData(project,fetchJSON), objects=data.objectCatalog.objects ?? data.objectCatalog.assets, items=[...data.catalog.assets,...objects];
  const modelURLs=new Set(items.flatMap(item=>[item.modelUrl,item.assemblyModelUrl,item.materialModelUrl].filter(Boolean)).map(url=>project.config.resourceResolver.resolve(url)));
  const models=[];
  for(const url of modelURLs){const g=parseGLB(read(url,PREVIEW_LIMITS.downloadBytes));models.push({path:new URL(url).pathname,vertexCount:g.vertices,triangleCount:g.triangles,warnings:g.warnings});}
  results.push({projectId:entry.id,datasetId:project.config.datasetId,resources:data.catalog.assets.length,objects:objects.length,models});
 }
 if(!results.length)throw Error('No projects registered');
 console.log(JSON.stringify({passed:true,scope:'registered indexed catalogs and referenced GLB CPU parsing',gpu:'not-verified',projects:results},null,2));
} catch(error){console.error('Workspace validation failed: '+error.message);process.exitCode=1;}
