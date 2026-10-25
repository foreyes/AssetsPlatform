// Authoritative frontend emitter, used unchanged by every existing Site build.
// No project-specific application generation: only descriptors/resources differ.
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{fileURLToPath}from'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export function frontendFiles(){return fs.readdirSync(path.join(root,'shared')).filter(file=>fs.statSync(path.join(root,'shared',file)).isFile()).map(file=>({source:'shared/'+file,target:['app.mjs','index.html','style.css','player-layout.css','project-panels.css'].includes(file)?file:'shared/'+file})).concat(fs.readdirSync(path.join(root,'adapters')).filter(file=>file.endsWith('.mjs')&&!file.endsWith('.test.mjs')).map(file=>({source:'adapters/'+file,target:'adapters/'+file})));}
export function emitFrontend({destination,descriptor,viewerSource}){
 fs.mkdirSync(destination,{recursive:true});const hashes={};
 for(const file of frontendFiles()){const target=path.join(destination,file.target);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file.source),target);hashes[file.target]=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');}
 for(const[file,text]of Object.entries({'app.js':"// Canonical entry compatibility alias. No project controller.\nimport './app.mjs';\n",'styles.css':"/* Canonical stylesheet compatibility alias. */\n@import url('./style.css');\n"})){fs.writeFileSync(path.join(destination,file),text);hashes[file]=crypto.createHash('sha256').update(text).digest('hex');}
 fs.writeFileSync(path.join(destination,'project-config.json'),JSON.stringify(descriptor,null,2)+'\n');
 fs.writeFileSync(path.join(destination,'project-directory.json'),JSON.stringify({schema:'asset-review-project-directory/1',defaultProject:descriptor.id,projects:[{id:descriptor.id,label:descriptor.config.label,config:'./project-config.json'}]},null,2)+'\n');
 if(viewerSource)fs.copyFileSync(viewerSource,path.join(destination,'viewer-source.mjs'));
 return {schema:'canonical-review-frontend-build/1',canonicalMain:true,canonicalDOM:true,canonicalInputController:true,projectId:descriptor.id,hashes};
}
