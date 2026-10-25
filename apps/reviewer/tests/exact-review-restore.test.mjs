import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createWorkbench} from '../shared/workbench.mjs';
import {restoreReviewSnapshot, importReviewBackup} from '../shared/review-import.mjs';
import {loadReviewState} from '../shared/selection-state.mjs';
const config = {projectId:'a',datasetId:'dataset-a',label:'A',importFormat:'review',reviewKey:'review-a',sharedSelections:false,importLimitMiB:25};
const parse = createWorkbench(config).parseReviewImport;
const knownIds = new Set(['one','two']);
const backup = extra => JSON.stringify({format:'review',version:2,projectId:'a',datasetId:'dataset-a',scope:'full-catalogue',reviews:{one:{status:'keep',comment:'restored'}},selected:['one'],...extra});
function harness({text=backup(), accepted=true, fail=false, settings=config}={}) {
  const original = JSON.stringify({version:1,projectId:'a',datasetId:'dataset-a',reviews:{two:{status:'skip',comment:'old'}},selected:['two']});
  const values=new Map([['review-a',original],['unrelated','untouched']]);
  const calls=[];
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>{calls.push(['write',key]);if(fail)throw Error('quota');values.set(key,value)}};
  const run=()=>restoreReviewSnapshot({text,knownIds,parse,config:settings,storage,confirmReplace:message=>{calls.push(['confirm',message]);return accepted}});
  return {run,storage,values,calls,original};
}
test('exact restore replaces rather than unions; one identity-bound storage write after confirmation',()=>{
  const h=harness(),result=h.run();
  assert.deepEqual(h.calls.map(x=>x[0]),['confirm','write']);
  assert.match(h.calls[0][1],/替换全部现有审阅记录和选择/);
  assert.match(h.calls[0][1],/空备份会清空/);
  assert.equal(h.calls[1][1],'review-a');
  const loaded=loadReviewState(h.storage,config);
  assert.equal(loaded.reviews.two,undefined);assert.deepEqual(loaded.selected,['one']);assert.equal(result.reviews.one.comment,'restored');
  assert.equal(JSON.parse(h.values.get('review-a')).datasetId,'dataset-a');assert.equal(h.values.get('unrelated'),'untouched');
});
test('cancel and empty-backup cancel preserve bytes; confirmed empty backup clears',()=>{
  for(const text of [backup(),backup({reviews:{},selected:[]})]){
    const h=harness({text,accepted:false});assert.equal(h.run(),null);assert.equal(h.values.get('review-a'),h.original);assert.deepEqual(h.calls.map(x=>x[0]),['confirm']);
  }
  const h=harness({text:backup({reviews:{},selected:[]})});h.run();assert.deepEqual(loadReviewState(h.storage,config).reviews,{});assert.deepEqual(loadReviewState(h.storage,config).selected,[]);
});
const invalid=[{reviews:{one:{status:'keep',unexpected:{important:'lost'}}}},null,[],{version:1},{version:3},{scope:'selected'},{scope:undefined},{projectId:'b'},{datasetId:'b'},{selected:undefined},{selected:['unknown']},{selected:[1]},{selected:['one','one']},{reviews:{unknown:{status:'keep'}}},{reviews:{one:{status:'bad'}}},{reviews:{one:{status:'keep',comment:4}}},{reviews:{one:{status:'keep',comment:'x'.repeat(10001)}}},{reviews:{one:{status:'keep',updatedAt:42}}},{reviews:[]}];
for(const [i,extra] of invalid.entries())test(`invalid restore ${i} never prompts or writes`,()=>{
  const h=harness({text:extra===null?'null':Array.isArray(extra)?'[]':backup(extra)});assert.throws(h.run);assert.deepEqual(h.calls,[]);assert.equal(h.values.get('review-a'),h.original);
});
test('malformed JSON and non-local/multi-key configs never prompt or write',()=>{
  for(const options of [{text:'{'},{settings:{...config,sharedSelections:true}},{settings:{...config,sharedSelections:undefined}},{settings:{...config,selectionStorageKey:'selection-a'}}]){const h=harness(options);assert.throws(h.run);assert.deepEqual(h.calls,[]);assert.equal(h.values.get('review-a'),h.original)}
});
test('storage failure retains exact original bytes and returns no replacement',()=>{
  const h=harness({fail:true});assert.throws(h.run,/保存失败/);assert.equal(h.values.get('review-a'),h.original);assert.deepEqual([...h.values.keys()],['review-a','unrelated']);
});
test('default merge continues accepting selected scope, sanitizing unknowns and confirming legacy',()=>{
  const result=importReviewBackup({text:backup({scope:'selected',reviews:{one:{status:'keep'},unknown:{status:'skip'}},selected:['one','unknown']}),knownIds,parse,config,confirmLegacy:()=>assert.fail('unexpected confirm')});
  assert.deepEqual(Object.keys(result.reviews),['one']);assert.deepEqual(result.selected,['one']);
});
const app=await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8');
const start=app.indexOf("$('#restore-file').onchange = async event => {");
const end=app.indexOf('\nfunction setDefaultPreview',start);
assert(start>=0 && end>start);
async function runHandler(options={}){
  const h=harness(options), nodes=new Map(), node=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)};
  const effects=[];
  const context=vm.createContext({restoreGeneration:0,importReviewBackup,config:{...config},localStorage:h.storage,window:{confirm:()=>options.accepted!==false},restoreReviewSnapshot,parseReviewImport:parse,itemMap:new Map([...knownIds].map(x=>[x,{}])),reviews:{two:{status:'skip',comment:'old'}},selected:new Set(['two']),legacySelected:['two'],storageOK:false,commentTimer:7,current:{id:'one'},clearTimeout:()=>effects.push('timer'),$:node,updateReviewButtons:()=>effects.push('buttons'),render:()=>effects.push('render'),showToast:message=>effects.push(message)});
  vm.runInContext("function reviewOf(item) {return reviews[item.id] || {status:'pending',comment:''}}\n"+app.slice(app.indexOf("$('#import-file').onchange = async event => {"),end),context);
  const target={files:[{size:5,text:options.read || (async()=>options.text??backup())}],value:'chosen'};
  const pending=node('#restore-file').onchange({target});
  if(options.duringRead) await options.duringRead({context,node,target});
  await pending;
  return {context,effects,target,nodes,h};
}
test('actual UI handler applies only after successful persistence and refreshes comment/selection',async()=>{
  const {context,effects,target,nodes,h}=await runHandler();
  assert.equal(context.reviews.two,undefined);assert.deepEqual([...context.selected],['one']);assert.equal(nodes.get('#comment').value,'restored');assert.equal(nodes.get('#detail-selected').checked,true);assert(effects.includes('render'));assert(effects.includes('timer'));assert.equal(target.value,'');assert.notEqual(h.values.get('review-a'),h.original);
});
test('actual UI handler cancel/invalid/storage-error never mutate live state, render or clear pending comment',async()=>{
  for(const options of [{accepted:false},{text:backup({scope:'selected'})},{fail:true}]){
    const {context,effects,target,h}=await runHandler(options);
    assert.equal(context.reviews.two.comment,'old');assert.equal(context.reviews.one,undefined);assert.deepEqual([...context.selected],['two']);assert.equal(context.storageOK,false);assert(!effects.includes('render'));assert(!effects.includes('timer'));assert.equal(target.value,'');assert.equal(h.values.get('review-a'),h.original);
  }
});

test('pending file read cannot follow a dataset identity change',async()=>{
  let resolve;
  const read=()=>new Promise(done=>resolve=done);
  const result=await runHandler({read,duringRead:({context})=>{context.config.datasetId='dataset-b';resolve(backup({datasetId:'dataset-b'}))}});
  assert.deepEqual(result.h.calls,[]);assert.equal(result.context.reviews.two.comment,'old');assert(!result.effects.includes('render'));
});
test('epoch invalidation rejects old reads even after return to original dataset',async()=>{
  let resolve;
  const result=await runHandler({read:()=>new Promise(done=>resolve=done),duringRead:({context})=>{context.config.datasetId='dataset-b';context.restoreGeneration++;context.config.datasetId='dataset-a';context.restoreGeneration++;resolve(backup())}});
  assert.deepEqual(result.h.calls,[]);assert.equal(result.context.reviews.two.comment,'old');
});
test('newer restore supersedes older pending read without resetting its input',async()=>{
  let resolve;
  const result=await runHandler({read:()=>new Promise(done=>resolve=done),duringRead:async({node})=>{
    await node('#restore-file').onchange({target:{files:[{size:5,text:async()=>backup({reviews:{two:{status:'check',comment:'newer'}},selected:['two']})}],value:'new'}});
    resolve(backup());
  }});
  assert.equal(result.context.reviews.two.comment,'newer');assert.equal(result.context.reviews.one,undefined);assert.equal(result.h.calls.filter(x=>x[0]==='write').length,1);
});

test('older pending merge cannot resurrect records after a newer exact restore',async()=>{
  let resolveRestore;
  const result=await runHandler({read:()=>new Promise(done=>resolveRestore=done),duringRead:async({node})=>{
    let resolveMerge;
    const pendingMerge=node('#import-file').onchange({target:{files:[{size:5,text:()=>new Promise(done=>resolveMerge=done)}],value:'old-merge'}});
    await node('#restore-file').onchange({target:{files:[{size:5,text:async()=>backup()}],value:'new-restore'}});
    resolveMerge(backup({reviews:{two:{status:'skip',comment:'should not return'}},selected:['two']}));
    await pendingMerge;
    resolveRestore(backup());
  }});
  assert.equal(result.context.reviews.two,undefined);assert.equal(result.context.reviews.one.comment,'restored');assert.deepEqual([...result.context.selected],['one']);assert.equal(result.h.calls.filter(x=>x[0]==='write').length,1);
});
