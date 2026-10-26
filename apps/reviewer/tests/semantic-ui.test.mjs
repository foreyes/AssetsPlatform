import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSemanticUI} from '../shared/semantic-ui.mjs';
import {semanticStorageKey,semanticViewScope} from '../shared/semantic-workbench.mjs';
import {createAnnotationState,reconcileInputs,importProposals,reviewProposal,exportAnnotations,inputFingerprint} from '../shared/semantic-annotations.mjs';

class Node {
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attributes={};this.textContent='';this.selected=false;this.checked=false;this.multiple=false;this._value=undefined;}
  append(...nodes){this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(k,v){this.attributes[k]=v;if(k==='value')this._value=v;}
  get options(){return this.children.filter(n=>n.tagName==='option');}
  get selectedOptions(){const chosen=this.options.filter(n=>n.selected);return chosen.length?chosen:this.multiple?[]:this.options.slice(0,1);}
  get value(){return this._value===undefined?this.selectedOptions[0]?.value||'':this._value;}
  set value(value){this._value=value;if(this.tagName==='select'&&!this.multiple)for(const option of this.options)option.selected=option.value===value;}
}
const document={createElement(tag){return new Node(tag,this);}};
const walk=(root,predicate)=>[root,...root.children.flatMap(child=>walk(child,predicate))].filter(predicate);
const byLabel=(root,label)=>walk(root,n=>n.attributes['aria-label']===label)[0];
const byButton=(root,label)=>walk(root,n=>n.tagName==='button'&&n.textContent===label)[0];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const identity={projectId:'test-project',datasetId:'test-data'};
const items=[
  {id:'a',name:'Apple image',isObject:true,originalUrl:'a.png'},
  {id:'b',name:'Bread model',isObject:true,modelUrl:'b.glb'},
  {id:'c',name:'Clover',isObject:true,modelUrl:'c.glb'}
];
function fixture(confirmAction=()=>true){
  const host=new Node('div',document),map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
  const notifications=[],downloads=[];let query={},changes=0,scope={catalog:items,matched:items.slice(0,2),page:items.slice(0,1)};
  const ui=mountSemanticUI({host,identity,items,storage,getScope:()=>scope,getQuery:()=>query,setQuery:q=>{query=q;},onChange:()=>{changes++;},download:(...args)=>downloads.push(args),notify:m=>notifications.push(m),confirmAction});
  return {host,ui,map,notifications,downloads,get query(){return query;},get changes(){return changes;},setScope:s=>scope=s};
}
test('actual controls respect cancel, page/matched/catalog scopes and scoped export',()=>{
  let allow=false;const f=fixture(()=>allow),scope=byLabel(f.host,'批量与导出范围');
  const action=byButton(f.host,'对范围应用人工纠正');
  action.onclick();assert.equal(f.ui.model.effective(items[0]).directCategories.length,0);
  allow=true;const field=byLabel(f.host,'人工纠正字段'),value=byLabel(f.host,'人工纠正值');
  field.value='category';field.onchange();value.value='food';
  action.onclick();assert.deepEqual(f.ui.model.effective(items[0]).directCategories,['food']);
  assert.deepEqual(f.ui.model.effective(items[1]).directCategories,[]);
  scope.value='matched';scope.onchange();action.onclick();assert.deepEqual(f.ui.model.effective(items[1]).directCategories,['food']);
  scope.value='catalog';scope.onchange();action.onclick();assert.deepEqual(f.ui.model.effective(items[2]).directCategories,['food']);
  scope.value='page';scope.onchange();byButton(f.host,'导出范围标注侧车').onclick();
  const backup=JSON.parse(f.downloads.at(-1)[1]);assert.deepEqual(Object.keys(backup.entries),['a']);assert.deepEqual(backup.history,[]);
  assert.ok(f.map.get(semanticStorageKey(identity)));
});
test('filter widgets produce same-dimension OR, cross-dimension AND and explicit exclusion',()=>{
  const f=fixture(),categories=byLabel(f.host,'内容分类'),dimensions=byLabel(f.host,'表现维度');
  for(const option of categories.options)if(['food','plant'].includes(option.value))option.selected=true;
  categories.onchange();assert.deepEqual(f.query.categories,{any:['plant','food']});
  for(const option of dimensions.options)if(option.value==='2D')option.selected=true;
  dimensions.onchange();assert.deepEqual(f.query.dimensions,{any:['2D']});
  const mode=byLabel(f.host,'内容分类匹配方式');mode.value='exclude';mode.onchange();
  assert.deepEqual(f.query.categories,{exclude:['plant','food']});
  const animation=byLabel(f.host,'源轨道');animation.value='unknown';animation.onchange();assert.equal(f.query.animation.sourceTracks,null);
  assert.ok(f.changes>=4);
});
test('file read is invalidated by dispose or newer selection; no late import or storage write',async()=>{
  const f=fixture(),file=byLabel(f.host,'导入语义候选或标注 JSON');
  let resolve;const pending=new Promise(done=>{resolve=done;});
  const payload={identity,ruleVersion:f.ui.model.state.ruleVersion,proposals:[{assetId:'a',field:'category',value:'food',inputFingerprint:inputFingerprint(items[0]),method:'local',version:'1',evidence:[{source:'test',reference:'image/a'}]}]};
  file.files=[{size:100,text:()=>pending}];const process=file.onchange();
  f.ui.dispose();resolve(JSON.stringify(payload));await process;await tick();
  assert.equal(f.ui.model.state.entries.a.proposals.length,0);
  assert.equal(f.map.has(semanticStorageKey(identity)),false);
  assert.deepEqual(f.host.children,[]);
});
test('later file selection wins over an older pending read',async()=>{
  const f=fixture(),file=byLabel(f.host,'导入语义候选或标注 JSON');
  let resolveOld;const old=new Promise(done=>{resolveOld=done;});
  const candidate=value=>({identity,ruleVersion:f.ui.model.state.ruleVersion,proposals:[{assetId:'a',field:'category',value,inputFingerprint:inputFingerprint(items[0]),method:'local',version:'1',evidence:[{source:'test',reference:'a'}]}]});
  file.files=[{size:100,text:()=>old}];const first=file.onchange();
  file.files=[{size:100,text:async()=>JSON.stringify(candidate('food'))}];await file.onchange();
  resolveOld(JSON.stringify(candidate('plant')));await first;
  assert.deepEqual(f.ui.model.state.entries.a.proposals.map(p=>p.value),['food']);
});
test('out-of-dataset IDs are omitted from page and matched operation sets',()=>{
  const foreign={id:'foreign',name:'Other dataset'};
  const f=fixture(),scope=byLabel(f.host,'批量与导出范围');
  f.setScope(semanticViewScope(items,[items[0],foreign],[foreign]));
  scope.value='page';scope.onchange();byButton(f.host,'导出范围标注侧车').onclick();
  assert.deepEqual(Object.keys(JSON.parse(f.downloads.at(-1)[1]).entries),[]);
  scope.value='matched';scope.onchange();byButton(f.host,'导出范围标注侧车').onclick();
  assert.deepEqual(Object.keys(JSON.parse(f.downloads.at(-1)[1]).entries),['a']);
});
test('JSON candidate import stays pending until human review; default locked batch preserves multiple tags',async()=>{
  const f=fixture(),file=byLabel(f.host,'导入语义候选或标注 JSON');
  const payload={identity,ruleVersion:f.ui.model.state.ruleVersion,proposals:[
    {assetId:'a',field:'tag',value:'edible',inputFingerprint:inputFingerprint(items[0]),method:'local',version:'1',evidence:[{source:'test',reference:'image/a'}]},
    {assetId:'a',field:'tag',value:'collectible',inputFingerprint:inputFingerprint(items[0]),method:'local',version:'1',evidence:[{source:'test',reference:'image/a'}]}
  ]};
  file.files=[{size:100,text:async()=>JSON.stringify(payload)}];await file.onchange();
  assert.deepEqual(f.ui.model.effective(items[0]).tags,[]);
  assert.equal(f.ui.model.state.entries.a.proposals.length,2);
  const before=f.ui.model.state.revision;
  byButton(f.host,'批量接受待审候选').onclick();
  assert.equal(f.ui.model.state.revision,before+1);
  assert.deepEqual(f.ui.model.effective(items[0]).tags,['edible','collectible']);
  assert.equal(f.ui.model.state.entries.a.proposals.every(p=>p.locked),true);
  assert.match(f.notifications[0],/语义导入完成/);
});
test('backup sidecar prevalidates before prompting; cancel is inert and confirmation restores human decision',async()=>{
  let allow=false,prompts=[];const f=fixture(message=>{prompts.push(message);return allow;}),file=byLabel(f.host,'导入语义候选或标注 JSON');
  const source=createAnnotationState(identity);reconcileInputs(source,items);
  const proposal={identity,ruleVersion:source.ruleVersion,proposals:[{assetId:'a',field:'category',value:'food',inputFingerprint:inputFingerprint(items[0]),method:'local',version:'1',evidence:[{source:'test',reference:'a'}]}]};
  reviewProposal(source,importProposals(source,proposal,items).accepted[0],'accept',{locked:true});
  const backup=exportAnnotations(source),before=JSON.stringify(f.ui.model.state);
  file.files=[{name:'bad.json',size:100,text:async()=>JSON.stringify({...backup,identity:{...identity,datasetId:'wrong'}})}];await file.onchange();
  assert.equal(prompts.length,0);assert.equal(JSON.stringify(f.ui.model.state),before);
  file.files=[{name:'trusted.json',size:100,text:async()=>JSON.stringify(backup)}];await file.onchange();
  assert.equal(prompts.length,1);assert.match(prompts[0],/trusted.json/);assert.match(prompts[0],/可信人工备份/);
  assert.equal(JSON.stringify(f.ui.model.state),before);assert.equal(f.map.has(semanticStorageKey(identity)),false);
  allow=true;file.files=[{name:'trusted.json',size:100,text:async()=>JSON.stringify(backup)}];await file.onchange();
  assert.deepEqual(f.ui.model.effective(items[0]).directCategories,['food']);
  assert.equal(f.ui.model.state.entries.a.proposals[0].locked,true);
  assert.ok(f.map.has(semanticStorageKey(identity)));
});
