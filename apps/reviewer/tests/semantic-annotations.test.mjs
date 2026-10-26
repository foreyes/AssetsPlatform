import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnnotationState,inputFingerprint,reconcileInputs,importProposals,reviewProposal,
  setSemanticOverride,setSemanticOverrides,reviewProposals,effectiveSemantics,semanticMatches,filterSemanticItems,
  exportAnnotations,importAnnotations,restoreAnnotationState,rollbackAnnotations
} from '../shared/semantic-annotations.mjs';

const identity={projectId:'synthetic',datasetId:'set-1'};
const evidence=[{source:'local-contact-sheet',reference:'sha256:synthetic'}];
const items=[
  {id:'food-icon',name:'Food icon',type:'texture',isIndependentImage:true,imageUrl:'icon.png'},
  {id:'food-model',name:'Food model',type:'mesh',modelUrl:'food.glb',textureId:'shared'},
  {id:'plant',name:'Plant',type:'mesh',modelUrl:'plant.glb',textureId:'shared'},
  {id:'gun-red',name:'Red gun',type:'mesh',modelUrl:'gun.glb',materialId:'red'},
  {id:'gun-blue',name:'Blue gun',type:'mesh',modelUrl:'gun.glb',materialId:'blue'},
  {id:'shared',name:'Shared texture',type:'texture',imageUrl:'shared.png'},
  {id:'bones',name:'Bones only',type:'mesh',modelUrl:'bones.glb',animationFacts:{skeletonPresent:{value:true,evidence:[{source:'glb-parser',reference:'nodes/4'}]}}}
];
function proposals(state,rows) {return {identity,ruleVersion:state.ruleVersion,proposals:rows.map(([assetId,field,value])=>({assetId,field,value,inputFingerprint:inputFingerprint(items.find(i=>i.id===assetId)),method:'local-agent',version:'1',evidence,confidence:.7}))};}
test('facts are deterministic, dimension is independent of technical type and dependencies',()=>{
  const state=createAnnotationState(identity);reconcileInputs(state,items);
  assert.equal(effectiveSemantics(items[0],state).dimension,'2D');
  assert.equal(effectiveSemantics(items[1],state).dimension,'3D');
  assert.equal(effectiveSemantics(items[5],state).dimension,'unknown');
  assert.equal(effectiveSemantics(items[0],state).technicalType,'texture');
  assert.equal(effectiveSemantics(items[6],state).animation.skeletonPresent.value,true);
  assert.equal(effectiveSemantics(items[6],state).animation.sourceTracks.value,null);
  assert.equal(effectiveSemantics(items[6],state).animation.playbackVerified.value,null);
  assert.equal(effectiveSemantics(items[1],state).unannotated,true);
  assert.equal(effectiveSemantics(items[1],state).needsReview,false);
  assert.equal(effectiveSemantics({id:'image-object',isObject:true,originalUrl:'original.png'},state).dimension,'2D');
  assert.equal(effectiveSemantics({id:'thumbnail-only',isObject:true,previewUrl:'thumb.png'},state).dimension,'unknown');
});
test('candidate import requires identity, fingerprint, provenance and controlled vocabulary; never verifies animation',()=>{
  const state=createAnnotationState(identity);reconcileInputs(state,items);
  const payload=proposals(state,[['food-icon','category','food']]);
  assert.throws(()=>importProposals(state,{...payload,identity:{projectId:'other',datasetId:'set-1'}},items),/mismatch/);
  assert.throws(()=>importProposals(state,proposals(state,[['bones','animation','playbackVerified']]),items),/unsupported/);
  assert.throws(()=>importProposals(state,proposals(state,[['food-icon','category','banana']]),items),/vocabulary/);
  const result=importProposals(state,payload,items);
  assert.equal(result.accepted.length,1);
  assert.equal(effectiveSemantics(items[0],state).unannotated,true);
  reviewProposal(state,result.accepted[0],'accept');
  assert.equal(semanticMatches(items[0],state,{categories:['item']}),true);
  assert.equal(semanticMatches(items[0],state,{categories:['food']}),true);
});
test('malformed candidate batch is atomic; locked human rejection survives reruns',()=>{
  const state=createAnnotationState(identity);reconcileInputs(state,items);
  const good=proposals(state,[['food-icon','category','food']]);
  const revision=state.revision;
  assert.throws(()=>importProposals(state,{...good,proposals:[...good.proposals,{...good.proposals[0],field:'animation'}]},items),/unsupported/);
  assert.equal(state.revision,revision);
  assert.equal(state.entries['food-icon'].proposals.length,0);
  const id=importProposals(state,good,items).accepted[0];
  reviewProposal(state,id,'reject',{locked:true});
  assert.equal(importProposals(state,good,items).accepted.length,0);
  assert.equal(semanticMatches(items[0],state,{categories:['food']}),false);
});
test('shared resources, mesh variants, rejection, input invalidation and locked override',()=>{
  const state=createAnnotationState(identity);reconcileInputs(state,items);
  const rs=importProposals(state,proposals(state,[['food-model','category','food'],['plant','category','plant'],['gun-red','category','firearm'],['gun-blue','category','firearm'],['shared','category','food']]),items);
  for(const id of rs.accepted.slice(0,4))reviewProposal(state,id,'accept');
  reviewProposal(state,rs.accepted[4],'reject',{locked:true});
  assert.equal(semanticMatches(items[5],state,{categories:['food']}),false);
  assert.equal(semanticMatches(items[2],state,{categories:['food']}),false);
  assert.equal(semanticMatches(items[3],state,{categories:['weapon']}),true);
  assert.equal(semanticMatches(items[4],state,{categories:['weapon']}),true);
  const changed=items.map(x=>x.id==='food-model'?{...x,modelUrl:'changed.glb'}:x);
  assert.deepEqual(reconcileInputs(state,changed).changed,['food-model']);
  assert.equal(semanticMatches(changed[1],state,{categories:['food']}),false);
  assert.equal(effectiveSemantics(changed[1],state).needsReview,true);
  assert.deepEqual(importProposals(state,proposals(state,[['food-model','category','food']]),changed).stale,['food-model']);
  setSemanticOverride(state,'food-model','category','food',{locked:true});
  assert.equal(semanticMatches(changed[1],state,{categories:['item']}),true);
});
test('same-dimension OR, cross-dimension AND, all/any/exclude, zero, page/matched/catalog',()=>{
  const state=createAnnotationState(identity);reconcileInputs(state,items);
  const rs=importProposals(state,proposals(state,[['food-icon','category','food'],['food-model','category','food'],['plant','category','plant'],['gun-red','category','firearm']]),items);
  rs.accepted.forEach(id=>reviewProposal(state,id,'accept'));
  assert.equal(filterSemanticItems(items,state,{categories:['food','plant']}).matched,3);
  assert.equal(filterSemanticItems(items,state,{categories:['food','plant'],dimensions:['2D']}).matched,1);
  assert.equal(filterSemanticItems(items,state,{categories:{all:['food','item']}}).matched,2);
  assert.equal(filterSemanticItems(items,state,{categories:{any:['food','plant'],exclude:['plant']}}).matched,2);
  assert.equal(filterSemanticItems(items,state,{categories:['vehicle']}).matched,0);
  assert.deepEqual(filterSemanticItems(items,state,{categories:['food']},{scope:'page',page:2,pageSize:1}).items.map(x=>x.id),['food-model']);
  assert.equal(filterSemanticItems(items,state,{categories:['food']},{scope:'catalog'}).items.length,items.length);
});
test('auditable export/import binds identity, and rollback restores earlier revision',()=>{
  const state=createAnnotationState(identity);reconcileInputs(state,items);
  const before=state.revision;
  setSemanticOverride(state,'food-icon','category','food');
  const backup=exportAnnotations(state);
  assert.throws(()=>importAnnotations(state,{...backup,identity:{projectId:'other',datasetId:'set-1'}},items),/mismatch/);
  const restored=createAnnotationState(identity);reconcileInputs(restored,items);
  importAnnotations(restored,backup,items);
  assert.equal(semanticMatches(items[0],restored,{categories:['food']}),true);
  rollbackAnnotations(state,before);
  assert.equal(semanticMatches(items[0],state,{categories:['food']}),false);
});
test('merge keeps local locked correction and rejection; local restore keeps history',()=>{
  const local=createAnnotationState(identity),external=createAnnotationState(identity);
  reconcileInputs(local,items);reconcileInputs(external,items);
  setSemanticOverride(local,'food-icon','category','plant',{locked:true});
  const suggestion=importProposals(local,proposals(local,[['plant','category','food']]),items).accepted[0];
  reviewProposal(local,suggestion,'reject',{locked:true});
  setSemanticOverride(external,'food-icon','category','food',{locked:true});
  const proposed=importProposals(external,proposals(external,[['plant','category','food']]),items).accepted[0];
  reviewProposal(external,proposed,'accept');
  const backup=exportAnnotations(external),revision=local.revision;
  importAnnotations(local,backup,items,{mode:'merge'});
  assert.equal(semanticMatches(items[0],local,{categories:['plant']}),true);
  assert.equal(semanticMatches(items[0],local,{categories:['food']}),false);
  assert.equal(semanticMatches(items[2],local,{categories:['food']}),false);
  assert.equal(local.entries.plant.proposals.some(p=>p.status==='accepted'),false);
  const saved=exportAnnotations(local);
  const restored=restoreAnnotationState(saved,identity,items);
  assert.equal(restored.revision,saved.revision);
  assert.equal(restored.history.length,saved.history.length);
  assert.throws(()=>restoreAnnotationState({...saved,history:[{revision:999,entries:{}}]},identity,items),/checkpoint/);
  rollbackAnnotations(restored,revision);
  assert.equal(semanticMatches(items[0],restored,{categories:['plant']}),true);
});
test('locked multi-value acceptance survives input changes without collapsing category or tags',()=>{
  const state=createAnnotationState(identity);reconcileInputs(state,items);
  const payload=proposals(state,[['food-icon','category','food'],['food-icon','category','plant'],['food-icon','tag','edible'],['food-icon','tag','collectible']]);
  const ids=importProposals(state,payload,items).accepted;
  const before=state.revision;
  reviewProposals(state,ids,'accept',{locked:true});
  assert.equal(state.revision,before+1);
  assert.deepEqual(effectiveSemantics(items[0],state).directCategories,['food','plant']);
  assert.deepEqual(effectiveSemantics(items[0],state).tags,['edible','collectible']);
  const changed=items.map(item=>item.id==='food-icon'?{...item,imageUrl:'new-icon.png'}:item);
  reconcileInputs(state,changed);
  assert.deepEqual(effectiveSemantics(changed[0],state).directCategories,['food','plant']);
  assert.deepEqual(effectiveSemantics(changed[0],state).tags,['edible','collectible']);
  assert.equal(effectiveSemantics(changed[0],state).needsReview,true);
  const next=state.revision;
  setSemanticOverrides(state,['food-icon','food-model'],'tag','ui');
  assert.equal(state.revision,next+1);
  assert.equal(semanticMatches(changed[0],state,{tags:['ui']}),true);
});
test('backup import rejects nonboolean locks and forged input fingerprint encodings',()=>{
  const state=createAnnotationState(identity);reconcileInputs(state,items);
  const id=importProposals(state,proposals(state,[['food-icon','category','food']]),items).accepted[0];
  reviewProposal(state,id,'accept',{locked:true});
  const badLock=exportAnnotations(state);badLock.entries['food-icon'].proposals[0].locked='true';
  assert.throws(()=>importAnnotations(state,badLock,items),/proposal lock/);
  assert.throws(()=>restoreAnnotationState(badLock,identity,items),/proposal lock/);
  const badFingerprint=exportAnnotations(state);badFingerprint.entries['food-icon'].proposals[0].inputFingerprint='hash:fake';
  assert.throws(()=>importAnnotations(state,badFingerprint,items),/backup proposal/);
  assert.throws(()=>restoreAnnotationState(badFingerprint,identity,items),/backup proposal/);
});
