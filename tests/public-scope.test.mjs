import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createWorkbench} from '../apps/reviewer/shared/workbench.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=fs.readFileSync(path.join(root,'apps/reviewer/app.mjs'),'utf8');
test('public source is a standalone static reviewer, with no hosted reference subtree',()=>{
 assert(!fs.existsSync(path.join(root,'reference/hosted')));
 const allowlist=JSON.parse(fs.readFileSync(path.join(root,'scripts/public-build-inputs.json')));
 assert(allowlist.every(file=>fs.existsSync(path.join(root,'apps/reviewer',file))));
 assert(allowlist.includes('viewer.mjs'));assert(allowlist.includes('shared/semantic-ui.mjs'));
});
test('all literal application DOM bindings refer to actual HTML or explicitly created controls',()=>{
 const html=fs.readFileSync(path.join(root,'apps/reviewer/index.html'),'utf8');
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 for(const match of app.matchAll(/\.id = '([\w-]+)'/g))ids.add(match[1]);
 for(const match of app.matchAll(/\$\('#([\w-]+)'\)/g))assert(ids.has(match[1]),`missing DOM control: ${match[1]}`);
});
test('actual profile UI and lookup reject unsupported descriptor modes, not just saved preference values',()=>{
 const supported={id:'material',mode:'material',implemented:true,label:'Source',description:'Generic'};
 const custom={id:'custom-inspection',mode:'unsupported-mode',implemented:true,label:'Unsupported'};
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
 const {availableProfile}=createWorkbench({});
 const context=vm.createContext({profiles:[custom,supported],availableProfile,$:node,defaultProfile:'material',profileA:'material',profileB:'material',esc:String});
 vm.runInContext(app.slice(app.indexOf('function profileById('),app.indexOf('function updateProfileNotes(')),context);
 vm.runInContext('buildProfiles()',context);
 assert(!node('#default-profile').innerHTML.includes('custom-inspection'));
 assert(node('#default-profile').innerHTML.includes('material'));
 assert.equal(context.profileById('custom-inspection').id,'material');
 assert.throws(()=>context.viewerProfile(custom),/不支持/);
 assert.equal(context.viewerProfile(supported).mode,'material');
});
