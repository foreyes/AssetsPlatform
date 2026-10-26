import test from 'node:test';
import assert from 'node:assert/strict';
import {createSemanticWorkbench,semanticStorageKey,scopeItems,scopedAnnotations,semanticViewScope} from '../shared/semantic-workbench.mjs';
const identity={projectId:'synthetic',datasetId:'set-1'};
const items=Array.from({length:45},(_,i)=>({id:`asset-${i}`,name:`Synthetic ${i}`,isObject:true,imageUrl:'synthetic.png'}));
function storage(){const map=new Map();return {map,getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};}
test('bulk correction is one reversible checkpoint, round trips storage and keeps dataset identity isolated',()=>{
 const store=storage(),m=createSemanticWorkbench({identity,items,storage:store}),before=m.state.revision;
 m.correct(items,'category','food',true);
 assert.equal(m.state.revision,before+1);assert.equal(m.effective(items[44]).directCategories[0],'food');
 const restored=createSemanticWorkbench({identity,items,storage:store});assert.equal(restored.state.revision,m.state.revision);assert.equal(restored.effective(items[44]).directCategories[0],'food');
 restored.rollback(before);assert.deepEqual(restored.effective(items[44]).directCategories,[]);
 const other=createSemanticWorkbench({identity:{...identity,datasetId:'set-2'},items,storage:store});assert.deepEqual(other.effective(items[0]).directCategories,[]);
 assert.notEqual(semanticStorageKey(identity),semanticStorageKey({projectId:'synthetic:set-1',datasetId:'other'}));
});
test('invalid batch correction and wrong identity import leave in-memory and stored bytes unchanged',()=>{
 const store=storage(),m=createSemanticWorkbench({identity,items,storage:store});m.correct([items[0]],'tag','edible',true);
 const before=JSON.stringify(m.state),bytes=store.getItem(semanticStorageKey(identity));
 assert.throws(()=>m.correct([items[1],{id:'unknown'}],'category','food',true),/unknown asset/);
 assert.equal(JSON.stringify(m.state),before);assert.equal(store.getItem(semanticStorageKey(identity)),bytes);
 const payload=m.export(items);payload.identity.datasetId='other';assert.throws(()=>m.import(payload),/identity/);assert.equal(JSON.stringify(m.state),before);
});
test('scope export excludes unrelated assets and all hidden history; zero page scope stays empty',()=>{
 const m=createSemanticWorkbench({identity,items,storage:storage()});m.correct(items,'category','food',true);
 const result=m.export([items[0]]);assert.deepEqual(Object.keys(result.entries),['asset-0']);assert.deepEqual(result.history,[]);
 const scopes={catalog:items,matched:items.slice(0,25),page:items.slice(20,25)};
 assert.equal(scopeItems('catalog',scopes).length,45);assert.equal(scopeItems('matched',scopes).length,25);assert.equal(scopeItems('page',scopes).length,5);
 assert.deepEqual(scopeItems('page',{...scopes,page:[]}),[]);assert.throws(()=>scopeItems('wrong',scopes));
});
test('quota failures retain edits in memory with warning; malformed saved state is preserved rather than overwritten',()=>{
 const fail={getItem:()=>null,setItem:()=>{throw Error('quota');}},m=createSemanticWorkbench({identity,items,storage:fail});
 m.correct([items[0]],'category','food',true);assert.match(m.warning,/quota/);assert.deepEqual(m.effective(items[0]).directCategories,['food']);
 const saved=storage();saved.setItem(semanticStorageKey(identity),'{bad');const broken=createSemanticWorkbench({identity,items,storage:saved});
 assert.match(broken.warning,/未载入/);broken.correct([items[0]],'category','food',true);assert.equal(saved.getItem(semanticStorageKey(identity)),'{bad');assert.match(broken.warning,/未覆盖/);
});

test('semantic batch scopes intersect legacy selected/reviewed views with the active dataset',()=>{
 const other={id:'other-dataset-asset'},scope=semanticViewScope(items,[items[0],other],[other]);
 assert.deepEqual(scope.matched,[items[0]]);assert.deepEqual(scope.page,[]);assert.equal(scope.catalog.length,45);
});

test('active semantic queries exclude foreign datasets while empty queries preserve legacy views',()=>{
 const model=createSemanticWorkbench({identity,items,storage:storage()}),foreign={id:'foreign',isObject:true,imageUrl:'other.png'};
 assert.equal(model.matches(foreign,{}),true);assert.equal(model.matches(foreign,{dimensions:['2D']}),false);assert.equal(model.matches(foreign,{unannotated:true}),false);
 assert.equal(model.matches(items[0],{dimensions:['2D']}),true);
});
