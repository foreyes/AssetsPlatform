import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogueSummary, activeConditions, clearCondition } from '../apps/reviewer/shared/catalogue-summary.mjs';
import { declaredDimension, imageObjectPreviewLabel } from '../apps/reviewer/shared/preview-status.mjs';
import { createWorkbench } from '../apps/reviewer/shared/workbench.mjs';
const objects=[{id:'image',isObject:true,imageUrl:'synthetic.png',previewUrl:'thumb.png'},{id:'model',isObject:true,modelUrl:'synthetic.glb'}];
const resources=[{id:'a',type:'mesh'},{id:'b',type:'material'},{id:'c',type:'texture'}];
test('fixed two object / three resource catalogue does not change counts at zero matches or across pages',()=>{
 const config={projectId:'synthetic',datasetId:'v1'};
 const workbench=createWorkbench({});
 const first=catalogueSummary({config,objects,resources,matched:objects,page:workbench.pageSlice(objects),state:{}});
 assert.equal(first.objects,2);assert.equal(first.resources,3);assert.equal(first.modelEntrances,1);assert.equal(first.range,'1–2');assert.equal(first.coverage,null);
 const zero=catalogueSummary({config,objects,resources,matched:[],page:workbench.pageSlice([]),state:{query:'not present'}});
 assert.equal(zero.matched,0);assert.equal(zero.objects,2);assert.equal(zero.resources,3);assert.equal(zero.range,'0–0');assert.deepEqual({...zero.byType},{mesh:1,material:1,texture:1});
 assert.equal(catalogueSummary({config:{projectId:'second',datasetId:'v2'}}).projectId,'second');
 const many=Array.from({length:22},(_,i)=>({id:String(i)}));const page=workbench.pageSlice(many,2);
 assert.equal(catalogueSummary({config,objects:many,matched:many,page}).range,'21–22');
});
test('coverage only uses explicit declarations and distinguishes overlapping children',()=>{
 const summary=catalogueSummary({config:{},objects:[{id:'a',coverage:{role:'root',contains:['c']}},{id:'b',coverage:{role:'root',contains:['c']}},{id:'c',coverage:{role:'child'}},{id:'d',modelUrl:'d.glb'}]});
 assert.deepEqual(summary.coverage,{declared:3,unknown:1,contains:2,unresolved:0,overlaps:1});
});
test('each activity condition has an independently clearable keyboard button data key',()=>{
 const state={query:'food',type:'texture',category:'food',review:'pending',preview:'yes',animation:'references',facets:{source:'demo',renderer:'all'},semantic:{dimension:['2D'],category:[]},page:3};
 const conditions=activeConditions(state);assert.equal(conditions.length,8);
 for(const condition of conditions)clearCondition(state,condition.key);
 assert.equal(activeConditions(state).length,0);assert.equal(state.page,1);
});
test('standalone 2D original is not confused with thumbnail, technical texture, or 3D',()=>{
 assert.equal(declaredDimension(objects[0]),'2D');assert.match(imageObjectPreviewLabel(objects[0]),/独立 2D 原图/);
 assert.match(imageObjectPreviewLabel({isObject:true,dimension:'2D',previewUrl:'thumb.png'}),/仅缩略图/);
 assert.match(imageObjectPreviewLabel({isObject:true,dimension:'unknown'}),/尚无完整预览/);
 assert.equal(imageObjectPreviewLabel(objects[1]),null);
 assert.equal(declaredDimension({type:'texture',imageUrl:'shared.png'}),'unknown');
 assert.equal(imageObjectPreviewLabel({type:'texture',imageUrl:'shared.png'}),null);
 assert.equal(declaredDimension({isObject:true,modelUrl:'model.glb',textureLinks:['shared.png']}),'3D');
 assert.equal(declaredDimension({isObject:true,dimension:'mixed',modelUrl:'a.glb',imageUrl:'b.png'}),'mixed');
});

// Run the actual UI functions with synthetic records, without claiming browser image/GPU QA.
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../apps/reviewer/app.mjs',import.meta.url),'utf8');
function uiFunctions(){
 const context=vm.createContext({config:{presentation:'indexed-source'},resources:[],objectNames:{},objectCategory:x=>x.category||'other',imageObjectPreviewLabel,icons:{},esc:String,assetURL:()=>'',neutralFallbacks:()=>[]});
 for(const [start,end]of [['function normalizeObject(','function allRelatedIds('],['function hasPreview(','function facetMatches('],['function previewLabel(','function imageHTML(']])vm.runInContext(app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start))),context);
 return context;
}
test('actual object normalization and default UI status preserve image originals, explicit labels and 3D paths',()=>{
 const ui=uiFunctions();
 const image=ui.normalizeObject({id:'synthetic-image',name:'Image',imageUrl:'original.png',previewUrl:'thumb.png'});
 assert.equal(image.originalUrl,'original.png');assert.equal(ui.hasPreview(image),true);assert.match(ui.previewLabel(image),/独立 2D 原图/);
 assert.equal(ui.hasPreview({isObject:true,imageUrl:'original.png'}),true);
 assert.match(ui.previewLabel({isObject:true,previewUrl:'thumb.png'}),/仅缩略图/);
 assert.match(ui.previewLabel({isObject:true,modelUrl:'model.glb'}),/静态预览/);
 assert.equal(ui.previewLabel({...image,previewStatusLabel:'Declared custom status'}),'Declared custom status');
 assert.equal(ui.previewLabel({isObject:true,modelUrl:'model.glb',previewStatusLabel:'Declared model status'}),'Declared model status');
});
test('semantic selector chips expose operators, unknown animation and independent removal',()=>{
 const state={semantic:{categories:{any:['food','plant'],exclude:['firearm']},dimensions:{all:['2D']},animation:{sourceTracks:null,skeletonPresent:false}},facets:{},page:3};
 const conditions=activeConditions(state);assert.equal(conditions.length,5);
 assert.equal(conditions.find(c=>c.key==='semantic:animation:sourceTracks').value,'未知');
 clearCondition(state,'semantic:categories:exclude');assert.deepEqual(state.semantic.categories,{any:['food','plant']});assert.equal(state.page,1);
 for(const condition of activeConditions(state))clearCondition(state,condition.key);
 assert.deepEqual(state.semantic,{});
});
test('malformed or duplicate optional coverage links do not crash or inflate parent counts',()=>{
 const result=catalogueSummary({config:{},objects:[{id:'a',coverage:{role:'root',contains:'not-an-array'}},{id:'b',coverage:{role:'root',contains:['c','c',null]}},{id:'c',coverage:{role:'child'}}]});
 assert.equal(result.coverage.contains,1);assert.equal(result.coverage.overlaps,0);
});

test('coverage never counts dangling or self references as closed containment',()=>{
 const summary=catalogueSummary({config:{},objects:[{id:'root',coverage:{role:'root',contains:['missing','root','child']}},{id:'child',coverage:{role:'child'}}]});
 assert.equal(summary.coverage.contains,1);assert.equal(summary.coverage.unresolved,2);assert.equal(summary.coverage.overlaps,0);
});
