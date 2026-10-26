import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../apps/reviewer');
test('source manifest describes every shipped app file and exact bytes (excluding itself)',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'MANIFEST.json')));
 assert.equal(manifest.format,'assets-platform-source-manifest/1');
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{assert(!entry.isSymbolicLink());const file=path.join(dir,entry.name);return entry.isDirectory()?walk(file):[file];});
 const files=walk(root).map(file=>path.relative(root,file).split(path.sep).join('/')).filter(file=>file!=='MANIFEST.json').sort();
 assert.deepEqual(Object.keys(manifest.files).sort(),files,'Run node scripts/update-source-manifest.mjs after source changes');
 for(const relative of files){const bytes=fs.readFileSync(path.join(root,relative));assert.deepEqual(manifest.files[relative],{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},relative);}
});
