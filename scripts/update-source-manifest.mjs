import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../apps/reviewer');
function walk(directory){
 return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const file=path.join(directory,entry.name);
  if(entry.isSymbolicLink())throw Error('Source manifest does not follow symlinks');
  if(entry.isDirectory())return walk(file);
  if(!entry.isFile())throw Error('Source manifest accepts regular files only');
  return file===path.join(root,'MANIFEST.json')?[]:[file];
 });
}
const files=Object.fromEntries(walk(root).sort().map(file=>{
 const bytes=fs.readFileSync(file);
 return [path.relative(root,file).split(path.sep).join('/'),{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}];
}));
fs.writeFileSync(path.join(root,'MANIFEST.json'),JSON.stringify({format:'assets-platform-source-manifest/1',files},null,2)+'\n');
console.log(JSON.stringify({manifest:'apps/reviewer/MANIFEST.json',files:Object.keys(files).length}));
