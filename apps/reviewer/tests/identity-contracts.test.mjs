import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createWorkbench} from '../shared/workbench.mjs';
import {reviewBackupIdentity} from '../shared/review-export.mjs';
import {validateCatalogData,validateProjectDescriptor,validateProjectStorage,loadProject} from '../shared/project-loader.mjs';
import {loadData} from '../adapters/indexed-data.mjs';
import {loadReviewState,saveReviewState} from '../shared/selection-state.mjs';
const config={projectId:'a',datasetId:'verified',label:'A',importFormat:'shared-format',reviewKey:'a-review',renderPreferenceKey:'a-profile',exportPrefix:'A',defaultProfile:'material',importLimitMiB:25};
const wb=createWorkbench(config),ids=new Set(['same']);
const backup=(extra={})=>JSON.stringify({...reviewBackupIdentity(config),reviews:{same:{status:'keep',comment:'hello'},unknown:{status:'skip'}},selected:['same','unknown'],...extra});
test('v2 round trip keeps known reviews and selection',()=>{const actual=wb.parseReviewImport(backup(),ids);assert.equal(actual.reviews.same.status,'keep');assert.deepEqual(actual.selected,['same']);assert.equal(actual.reviews.unknown,undefined)});
for(const extra of [{projectId:'b'},{datasetId:'other'},{projectId:undefined},{datasetId:undefined}])test('v2 rejects missing/mismatched identity '+JSON.stringify(extra),()=>assert.throws(()=>wb.parseReviewImport(backup(extra),ids),/身份/));
test('legacy import requires explicit consent; mismatched declared legacy identity never bypasses',()=>{assert.throws(()=>wb.parseReviewImport(backup({version:1,projectId:undefined,datasetId:undefined}),ids),e=>e.code==='LEGACY_REVIEW_CONFIRMATION_REQUIRED');assert.equal(wb.parseReviewImport(backup({version:1}),ids,{allowLegacy:true}).migratedLegacy,true);assert.throws(()=>wb.parseReviewImport(backup({version:1,projectId:'other'}),ids,{allowLegacy:true}),/身份/)});
test('import rejects malformed and future formats',()=>{for(const value of ['null','[]',backup({version:3}),backup({reviews:[]})])assert.throws(()=>wb.parseReviewImport(value,ids))});
const descriptor=id=>({id,datasetId:'verified',assetRoot:'./',dataKind:'indexed',renderer:{kind:'three',module:'viewer.mjs'},config:{...config,reviewKey:id+'-review',renderPreferenceKey:id+'-profile'}});
test('supplied portable descriptors pass new required-field schema',async()=>{for(const name of ['demo-a','demo-b']){const d=JSON.parse(await fs.readFile(new URL(`../${name}/project-config.json`,import.meta.url)));validateProjectDescriptor(d,{id:d.id},name)}});
test('descriptor gives field context for missing or malformed fields',()=>{for(const field of ['datasetId','assetRoot','renderer','config']){const d=descriptor('a');delete d[field];assert.throws(()=>validateProjectDescriptor(d,{id:'a'},'a.json'),new RegExp('a.json.'+field))}});
test('storage uniqueness includes cross-purpose and per-project collisions',()=>{validateProjectStorage([descriptor('a'),descriptor('b')]);for(const field of ['reviewKey','renderPreferenceKey','selectionStorageKey']){const b=descriptor('b');b.config[field]='a-review';assert.throws(()=>validateProjectStorage([descriptor('a'),b]),/collides/)}});
test('startup rejects another registered project storage collision before persistence',async()=>{const a=descriptor('a'),b=descriptor('b');b.config.reviewKey=a.config.reviewKey;const files={'project-directory.json':{schema:'asset-review-project-directory/1',defaultProject:'a',projects:[{id:'a',config:'a.json'},{id:'b',config:'b.json'}]},'a.json':a,'b.json':b};await assert.rejects(loadProject({location:{href:'http://localhost/',search:''},fetchJSON:async url=>files[new URL(url).pathname.slice(1)]}),/collides/)});
const catalog=()=>({catalog:{version:1,assets:[{id:'mesh',name:'Mesh',modelUrl:'assets/model.glb'}]},objectCatalog:{version:'2026-10-25',objects:[{id:'object',name:'Object',assetId:'mesh'}]}});
test('catalog validates compatible numeric/string versions and disjoint stable IDs',()=>assert.equal(validateCatalogData(catalog()).catalog.assets.length,1));
for(const mutate of [d=>d.catalog.assets.push({...d.catalog.assets[0]}),d=>d.objectCatalog.objects[0].id='mesh',d=>d.catalog.assets[0].id='',d=>d.catalog.assets[0].id=42,d=>d.catalog.assets[0].modelUrl={},d=>delete d.catalog.version,d=>delete d.objectCatalog.objects])test('catalog rejects malformed identity/schema '+mutate.toString(),()=>{const d=catalog();mutate(d);assert.throws(()=>validateCatalogData(d,'project-a'),/project-a\/assets\//)});
test('missing optional canopy rules returns explicit empty rule set',async()=>{const d=catalog();const data=await loadData({config:{assetRoot:'http://localhost/',origin:'http://localhost'},readJSON:async(url,required=true)=>{if(url.endsWith('/catalog.json'))return d.catalog;if(url.endsWith('/objects-catalog.json'))return d.objectCatalog;if(required)throw Error('missing');return null}});assert.deepEqual(data.materialRules,{version:1,flatCanopySourceMaterialIds:[]})});
test('local legacy storage stays readable while new records carry identity',()=>{const values=new Map([['a-review',JSON.stringify({version:1,reviews:{same:{status:'keep'}},selected:['same']})]]),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};assert.equal(loadReviewState(storage,config).reviews.same.status,'keep');saveReviewState(storage,config,{reviews:{same:{status:'keep'}},selected:new Set(['same']),legacySelected:[]});assert.equal(JSON.parse(values.get('a-review')).projectId,'a');assert.equal(loadReviewState(storage,{...config,projectId:'b'}).ok,false)});

import {importReviewBackup} from '../shared/review-import.mjs';
test('legacy migration cancel leaves caller without data; accept prompts exactly once',()=>{let prompts=0;const options={text:backup({version:1}),knownIds:ids,parse:wb.parseReviewImport,config,confirmLegacy:()=>{prompts++;return false}};assert.equal(importReviewBackup(options),null);assert.equal(prompts,1);assert.equal(importReviewBackup({...options,confirmLegacy:()=>true}).reviews.same.status,'keep');assert.equal(importReviewBackup({...options,text:backup(),confirmLegacy:()=>{throw Error('v2 must not prompt')}}).migratedLegacy,false)});
test('shard objects are not silently accepted as arrays',async()=>{await assert.rejects(loadData({config:{assetRoot:'http://localhost/',origin:'http://localhost'},readJSON:async url=>url.endsWith('/catalog.json')?{version:1,assetShards:['assets/shard.json']}:{id:'mesh',name:'Mesh'}}),/shard must be an array/)});

test('successful bootstrap binds stable identity and validates unique storage',async()=>{const a=descriptor('a'),b=descriptor('b'),directory={schema:'asset-review-project-directory/1',defaultProject:'a',projects:[{id:'a',config:'a.json'},{id:'b',config:'b.json'}]};const files={'project-directory.json':directory,'a.json':a,'b.json':b};const loaded=await loadProject({location:{href:'http://localhost/',search:''},fetchJSON:async url=>files[new URL(url).pathname.slice(1)]});assert.equal(loaded.config.projectId,'a');assert.equal(loaded.config.datasetId,'verified')});

test('dataset aliases accept only the identical existing record, before UI merge',()=>{const d=catalog(),base=d.catalog.assets[0];d.datasets={verified:{resources:[base]},adapter:{resources:[{id:'extra',name:'Extra'}]}};validateCatalogData(d);d.datasets.adapter.resources=[{...base,name:'Conflicting alternate'}];assert.throws(()=>validateCatalogData(d),/datasets.adapter.*conflicting/);d.datasets.adapter.resources=[{id:'constructor',name:'Unsafe'}];assert.throws(()=>validateCatalogData(d),/datasets.adapter.*safe/);d.datasets.adapter.resources=[base,base];assert.throws(()=>validateCatalogData(d),/duplicate dataset/)});
test('other project roots derive from descriptors even without directory hints',async()=>{const a=descriptor('a'),b=descriptor('b');b.assetRoot='./b/';const files={'project-directory.json':{defaultProject:'a',projects:[{id:'a',config:'a.json'},{id:'b',config:'b.json'}]},'a.json':a,'b.json':b};const p=await loadProject({location:{href:'http://localhost/',search:''},fetchJSON:async url=>files[new URL(url).pathname.slice(1)]});assert.deepEqual(p.config.registeredProjectRoots,['http://localhost/b/']);assert.throws(()=>p.config.resourceResolver.resolve('/b/assets/other.glb'));assert.equal(p.config.resourceResolver.resolve('/assets/own.glb'),'http://localhost/assets/own.glb');files['project-directory.json'].projects[1].assetRoot='./wrong/';await assert.rejects(loadProject({location:{href:'http://localhost/',search:''},fetchJSON:async url=>files[new URL(url).pathname.slice(1)]}),/root differs/)});
test('default descriptor fetch rejects redirects and is byte bounded',async()=>{const old=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push(options);return new Response(JSON.stringify(String(url).endsWith('project-directory.json')?{defaultProject:'a',projects:[{id:'a',config:'a.json'}]}:descriptor('a')))};try{await loadProject({location:{href:'http://localhost/',search:''}});assert.equal(calls.length,2);assert(calls.every(options=>options.redirect==='error'));globalThis.fetch=async()=>new Response('{}',{headers:{'content-length':String(3*1024*1024)}});await assert.rejects(loadProject({location:{href:'http://localhost/',search:''}}),/budget exceeded/)}finally{globalThis.fetch=old}});

for (const mode of ['public', 'hosted']) test(mode + ' resolver and loader assign decoded paths to the most specific registered root', async () => {
  const folder = mode === 'public' ? new URL('../shared/', import.meta.url) : new URL('../../../reference/hosted/review-frontend/shared/', import.meta.url);
  let source = await fs.readFile(new URL('resource-url.mjs', folder), 'utf8');
  // The private hosted pins are absent here; no supplemental capability is issued.
  source = source.replace(/import .* from '.\/entity-supplemental-pins.mjs';/, 'const supplementalPin=()=>null, supplementalRoot=()=>{throw Error("unregistered")};');
  const resolverURL = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const {createResourceResolver} = await import(resolverURL);
  const roots = ['/', '/b/', '/b/grand/', '/sibling/'];
  for (const current of roots) {
    const resolver = createResourceResolver({assetRoot:'http://localhost'+current, registeredProjectRoots:roots.map(r=>'http://localhost'+r)});
    assert.equal(resolver.resolve('assets/own.glb'), 'http://localhost'+current+'assets/own.glb');
    assert.equal(resolver.resolve('/assets/own.glb'), 'http://localhost'+current+'assets/own.glb');
    assert.equal(resolver.resolve('http://localhost'+current+'assets/own.glb'), 'http://localhost'+current+'assets/own.glb');
    for (const other of roots.filter(r=>r!==current)) assert.throws(()=>resolver.resolve(other+'physical.glb'), /Cross-project|escapes/);
  }
  const parent=createResourceResolver({assetRoot:'http://localhost/',registeredProjectRoots:['http://localhost/b/']});
  assert.throws(()=>parent.resolve('/%62/secret.glb'), /Cross-project/);
  assert.throws(()=>parent.resolve('/B/secret.glb'), /Cross-project/);
  for(const url of ['/b','/b. /secret.glb','/b./secret.glb','/b%2e/secret.glb','/B./secret.glb','/b%20/secret.glb','/LONGPR~1/secret.glb'])assert.throws(()=>parent.resolve(url));
  assert.throws(()=>parent.link('/b'));
  assert.throws(()=>parent.link('/B'));
  for(const url of ['/b::$INDEX_ALLOCATION/secret.glb','/b%3A%3A$INDEX_ALLOCATION/secret.glb','/Q:/b/secret.glb','/Q%3a/b/secret.glb','/Q:discard/b/secret.glb','/0:/b/secret.glb','/%F0%9F%98%80%3Adiscard/b/secret.glb'])assert.throws(()=>parent.resolve(url),/alias/);
  const driveMount=createResourceResolver({assetRoot:'http://localhost/',registeredProjectRoots:['http://localhost/b/'],resourceMounts:[{logicalPrefix:'/alias/',target:'./Q:/'}]});
  // Root projects retain physical-path idempotence; use a child for a real mount.
  const childDriveMount=createResourceResolver({assetRoot:'http://localhost/p/',registeredProjectRoots:['http://localhost/','http://localhost/p/b/'],resourceMounts:[{logicalPrefix:'/alias/',target:'./Q:/'}]});
  assert.throws(()=>childDriveMount.resolve('/alias/b/secret.glb'),/alias/);
  for(const target of ['./Q:discard/','./0:/','./😀:discard/']){
    const mounted=createResourceResolver({assetRoot:'http://localhost/p/',registeredProjectRoots:['http://localhost/','http://localhost/p/b/'],resourceMounts:[{logicalPrefix:'/alias/',target}]});
    assert.throws(()=>mounted.resolve('/alias/b/secret.glb'),/alias/);
  }
  const modules=createResourceResolver({assetRoot:'http://localhost/project/',registeredProjectRoots:['http://localhost/entity/'],dataKind:'entity',nativeModuleBase:'/entity/'});
  assert.equal(modules.resolve('/entity/viewer.js',{kind:'module'}),'http://localhost/entity/viewer.js');
  assert.throws(()=>modules.resolve('/%65ntity/viewer.js',{kind:'module'}));
  assert.throws(()=>driveMount.resolve('/Q:/b/secret.glb'),/alias/);

  const nested=createResourceResolver({assetRoot:'http://localhost/b/',registeredProjectRoots:['http://localhost/','http://localhost/b/grand/']});
  assert.throws(()=>nested.resolve('/%2562/secret.glb'));
  assert.throws(()=>nested.resolve('/b//grand/secret.glb'), /Cross-project/);
  for(const target of ['grand./','grand%20/','GRAND~1/']){
    const mounted=createResourceResolver({assetRoot:'http://localhost/b/',registeredProjectRoots:['http://localhost/','http://localhost/b/grand/'],resourceMounts:[{logicalPrefix:'/alias/',target}]});
    assert.throws(()=>mounted.resolve('/alias/secret.glb'),/alias/);
    assert.throws(()=>mounted.resolve('http://localhost/b/'+target+'secret.glb'),/alias/);
  }
  assert.equal(nested.resolve('/b//assets/own.glb'),'http://localhost/b//assets/own.glb');
  const upper=createResourceResolver({assetRoot:'http://localhost/B/',registeredProjectRoots:['http://localhost/']});
  assert.equal(upper.resolve('own.glb'),'http://localhost/B/own.glb');
  assert.throws(()=>upper.resolve('/b/own.glb'),/Cross-project/);
  const child=createResourceResolver({assetRoot:'http://localhost/b/',registeredProjectRoots:['http://localhost/','http://localhost/sibling/'],resourceMounts:[{logicalPrefix:'/sibling/',target:'assets/'},{logicalPrefix:'/assets/',target:'assets/'}]});
  assert.throws(()=>child.resolve('/sibling/secret.glb'), /Cross-project/);
  assert.equal(child.resolve('/assets/own.glb'),'http://localhost/b/assets/own.glb');
  assert.equal(child.resolve('/%61ssets/part%23one.glb'),'http://localhost/b/assets/part%23one.glb');
  const equal=createResourceResolver({assetRoot:'http://localhost/b/',registeredProjectRoots:['http://localhost/b/']});
  assert.equal(equal.resolve('asset.glb'),'http://localhost/b/asset.glb');
  assert.equal(equal.resolve('literal~1.glb'),'http://localhost/b/literal~1.glb');
  assert.equal(equal.resolve('./literal:name.glb'),'http://localhost/b/literal:name.glb');
  assert.equal(equal.resolve('folder./asset.glb'),'http://localhost/b/folder./asset.glb');
  const encoded=createResourceResolver({
    assetRoot:'http://localhost/%62/',
    registeredProjectRoots:['http://localhost/','http://localhost/b//','http://localhost/b/Data/private/','https://example.test/b/Data/'],
    resourceMounts:[{logicalPrefix:'/assets/',target:'Default/'},{logicalPrefix:'/assets/models/',target:'Data/'}]
  });
  assert.equal(encoded.resolve('/%61ssets/models/item%23one.glb#preview'),'http://localhost/%62/Data/item%23one.glb#preview');
  assert.equal(encoded.resolve('/assets/modelsExtra/item.glb'),'http://localhost/%62/Default/modelsExtra/item.glb');
  assert.equal(encoded.resolve('/b/Data/private-next/item.glb'),'http://localhost/b/Data/private-next/item.glb');
  assert.throws(()=>encoded.resolve('/assets/models/%70rivate/item.glb'),/Cross-project/);
  const ambiguous=createResourceResolver({assetRoot:'http://localhost/b/',registeredProjectRoots:['http://localhost/B/']});
  assert.throws(()=>ambiguous.resolve('own.glb'),/case alias/);
  let loader=await fs.readFile(new URL('project-loader.mjs',folder),'utf8');
  loader=loader.replace(/from '(\.\/[^']+)'/g,(_,relative)=>'from '+JSON.stringify(relative==='./resource-url.mjs'?resolverURL:new URL(relative,folder).href));
  const {loadProject:load}=await import('data:text/javascript;base64,'+Buffer.from(loader).toString('base64'));
  const a=descriptor('a'),b=descriptor('b');b.assetRoot='./b/';
  const files={'project-directory.json':{defaultProject:'b',projects:[{id:'a',config:'a.json'},{id:'b',config:'b.json'}]},'a.json':a,'b.json':b};
  const project=await load({location:{href:'http://localhost/',search:''},fetchJSON:async url=>files[new URL(url).pathname.slice(1)]});
  assert.equal(project.config.resourceResolver.resolve('/assets/own.glb'),'http://localhost/b/assets/own.glb');
  assert.throws(()=>project.config.resourceResolver.resolve('/physical.glb'));
});
