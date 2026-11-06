import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createReviewWriter,loadReviewState} from '../apps/reviewer/shared/selection-state.mjs';
import {reviewExportBlob,reviewSnapshotBlob,reviewStateSnapshot} from '../apps/reviewer/shared/review-export.mjs';
const config={projectId:'p',datasetId:'d',reviewKey:'r',importFormat:'review',importLimitMiB:25};
test('snapshot reads latest state, overlays pending and dirty intents without writing or consuming them',async()=>{
 let value=JSON.stringify({version:1,reviews:{one:{status:'keep',comment:'old'}},selected:['one']}), fail=true,writes=0;
 const storage={getItem:()=>value,setItem(key,text){writes++;if(fail)throw Error('quota');value=text;}};
 const fallback={reviews:{one:{status:'keep',comment:'old'}},selected:['one'],legacySelected:['one']};
 const writer=createReviewWriter(storage,config);
 const pending=writer.save({patch:{id:'one',comment:'pending'},selection:{remove:['one'],add:['two']}},fallback);
 value=JSON.stringify({version:1,reviews:{one:{status:'skip',comment:'external'},two:{status:'keep',comment:'new'}},selected:['one','three']});
 const result=writer.snapshot(pending,{patch:{id:'one',comment:'dirty'}});
 assert.equal(writes,1);assert.equal(result.reviews.one.comment,'dirty');assert.equal(result.reviews.one.status,'skip');assert.equal(result.reviews.two.comment,'new');assert.deepEqual(result.selected,['three','two']);
 value='{broken';const unavailable=writer.snapshot(pending);assert.equal(unavailable.ok,false);assert.equal(unavailable.reviews.one.comment,'pending');assert.equal(writes,1);
 value=JSON.stringify({version:1,reviews:{},selected:[]});fail=false;
 assert.equal(writer.save({},pending).reviews.one.comment,'pending');assert.equal(writes,2);
 const payload=reviewStateSnapshot(config,result.reviews,result.selected);
 assert.equal(await reviewSnapshotBlob(payload,config).blob.text(),JSON.stringify(payload));
 assert.equal(await reviewExportBlob(payload,config).blob.text(),JSON.stringify(payload,null,2));
});
for(const path of ['apps/reviewer/app.mjs','reference/hosted/review-frontend/shared/app.mjs'])test(path+' explicit object model does not inherit resource variants',async()=>{
 const source=await readFile(new URL('../'+path,import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function normalizeObject('),source.indexOf('function allRelatedIds('));
 const normalize=new Function('objectNames','objectCategory','config',body+'return normalizeObject;')({},()=> 'object',{assetRoot:'https://example.test/assets/'});
 const base={id:'base',modelUrl:'fragment.glb',modelAsset:{id:'fragment'},variants:[{id:'fragment',modelUrl:'fragment.glb'}]};
 const normalized=normalize({id:'object',assetId:'base',assemblyModelUrl:'assembly.glb'},new Map([['base',base]]),new Map());
 assert.equal(normalized.modelUrl,'assembly.glb');assert.equal(normalized.modelAsset,undefined);assert.deepEqual(normalized.variants,[]);
 const variants=[{id:'whole',modelUrl:'whole.glb'}];
 assert.deepEqual(normalize({id:'object',assetId:'base',modelUrl:'whole.glb',variants},new Map([['base',base]]),new Map()).variants,variants);
 assert.equal(normalize({id:'object',assetId:'base'},new Map([['base',base]]),new Map()).modelAsset,base.modelAsset);
 if(path.startsWith('reference/')){
  for(const modelUrl of ['./fragment.glb','https://example.test/assets/fragment.glb']){
   const same=normalize({id:'object',assetId:'base',modelUrl},new Map([['base',base]]),new Map());
   assert.equal(same.modelAsset,base.modelAsset);assert.deepEqual(same.variants,[]);
  }
 }
});

test('native stage classifies actual context loss before its DOM event and separates cancellation',async()=>{
 const source=await readFile(new URL('../reference/hosted/asset-source/render-stage.js',import.meta.url),'utf8');
 const start=source.indexOf(' const contextLostError='),end=source.indexOf(' const cleanup=',start);
 const check=new Function('lease','renderer','disposed',source.slice(start,end)+'return assertActive;');
 const lease={valid:true,signal:{}};
 assert.throws(check(lease,{getContext:()=>({isContextLost:()=>true})},false),{code:'WEBGL_CONTEXT_LOST'});
 assert.throws(check({...lease,valid:false},{getContext:()=>({isContextLost:()=>false})},false),{name:'AbortError'});
 assert.doesNotThrow(check(lease,{getContext:()=>({isContextLost:()=>false})},false));
});

for(const separateSelection of [false,true])test('snapshot preserves visible state on missing storage but honors an explicit stored empty state '+separateSelection,()=>{
 const settings={...config,...(separateSelection?{selectionStorageKey:'selected'}:{})};
 const values=new Map();let writes=0;
 const storage={getItem:key=>values.get(key)??null,setItem(){writes++;throw Error('blocked');}};
 const fallback={reviews:{one:{status:'keep',comment:'visible'}},selected:['one'],legacySelected:['one']};
 const writer=createReviewWriter(storage,settings);
 const missing=writer.snapshot(fallback);assert.equal(missing.ok,false);assert.equal(missing.reviews.one.comment,'visible');assert.deepEqual(missing.selected,['one']);assert.equal(writes,0);
 values.set('r',JSON.stringify({version:1,projectId:'p',datasetId:'d',reviews:{},selected:[]}));
 if(separateSelection)values.set('selected','[]');
 const empty=writer.snapshot(fallback);assert.equal(empty.ok,true);assert.deepEqual(Object.keys(empty.reviews),[]);assert.deepEqual(empty.selected,[]);assert.equal(writes,0);
 const pending=writer.save({patch:{id:'one',comment:'pending'},selection:{add:['two']}},fallback);
 values.clear();const writesBeforeSnapshot=writes;
 const recovered=writer.snapshot(pending,{patch:{id:'one',comment:'dirty'}});
 assert.equal(recovered.ok,false);assert.equal(recovered.reviews.one.comment,'dirty');assert.deepEqual(recovered.selected,['two']);assert.equal(writes,writesBeforeSnapshot);
});

test('snapshot rejects blank or malformed raw storage without changing the ordinary decoder contract',()=>{
 const fallback={reviews:{one:{status:'keep',comment:'visible'}},selected:['one'],legacySelected:['one']};
 for(const bytes of ['', '{}'])assert.equal(loadReviewState({getItem:()=>bytes},config).ok,true);
 for(const bytes of ['', '  ', '{}', 'null', '[]', '{"version":2}', '{"version":1}', '{"version":1,"reviews":{}}', '{"version":1,"selected":[]}', '{"version":1,"reviews":[]}', '{"version":1,"selected":{}}']){
  const writer=createReviewWriter({getItem:()=>bytes,setItem:()=>assert.fail('snapshot must not write')},config);
  const snapshot=writer.snapshot(fallback);assert.equal(snapshot.ok,false,bytes);assert.equal(snapshot.reviews.one.comment,'visible',bytes);assert.deepEqual(snapshot.selected,['one'],bytes);
 }
 for(const bytes of ['', '  ', '{}', 'null']){
  const writer=createReviewWriter({getItem:key=>key==='r'?JSON.stringify({version:1,reviews:{},selected:[]}):bytes,setItem:()=>assert.fail('snapshot must not write')},{...config,selectionStorageKey:'selection'});
  const snapshot=writer.snapshot(fallback);assert.equal(snapshot.ok,false,bytes);assert.deepEqual(Object.keys(snapshot.reviews),[]);assert.deepEqual(snapshot.selected,['one'],bytes);
 }
});

test('snapshot ignores an editor change reverted to baseline while retaining actual dirty input',async()=>{
 const source=await readFile(new URL('../apps/reviewer/app.mjs',import.meta.url),'utf8');
 const start=source.indexOf('  const intent = current && commentDirty',source.indexOf('function exportReviewSnapshot()'));
 const end=source.indexOf('  const latest =',start);
 const intentFor=new Function('current','commentDirty','commentBaseline','$',source.slice(start,end)+'return intent;');
 assert.deepEqual(intentFor({id:'one'},true,'Original',()=>({value:'Original'})),{});
 assert.equal(intentFor({id:'one'},true,'Original',()=>({value:'New'})).patch.comment,'New');
});
