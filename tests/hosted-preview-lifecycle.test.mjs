import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const source = new URL('../reference/hosted/', import.meta.url);
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hosted-preview-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const put = (name, text) => writeFile(join(dir, name), text);
  await put('package.json', '{"type":"module"}');
  for (const name of ['render-pool.js', 'viewer-lifecycle.js', 'model-viewer.js', 'model-resource.js', 'thumbnail-runtime.js']) {
    let text = await readFile(new URL('asset-source/' + name, source), 'utf8');
    text = text.replaceAll('./vendor/three.module.js', './three.js').replaceAll('./vendor/loaders/GLTFLoader.js', './loader.js').replaceAll('./shared/preview-queue.mjs', './queue.js');
    await put(name, text);
  }
  await put('three.js', 'export class LoadingManager {}');
  await put('loader.js', 'export class GLTFLoader {}');
  await put('shared-resource-transport.js', 'export const loadClosedGLTFBytes=()=>{},closedGLTFBlobScope=()=>{},validateClosedGLTFDocument=()=>{};');
  await put('asset-transport.js', 'export const loadAssetBytes=()=>{};');
  await put('gltf-static-matrices.js', 'export const applyExactSourceMatrices=()=>{};');
  await put('asset-delivery.js', "export const resolveAssetDelivery=asset=>({status:asset.unavailable?'unavailable':'available',asset});");
  await put('model-bundle-transport.js', 'export let downloads=0;export async function loadBundledClosedGLTFBytes(){downloads++;return {buffers:new Map()};}');
  await put('entity-render-profiles.js', "export const DEFAULT_PROFILE='source',ENTITY_CAPABILITIES={};export const profileById=id=>({id}),freezeSnapshot=x=>x;");
  await put('render-runtime.js', `import {createRendererPool} from './render-pool.js';export const sharedRendererPool=createRendererPool({create:()=>({})});const listeners=new Set();export const subscribeContext=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};export function context(lost){sharedRendererPool.setLost(lost);for(const fn of listeners)fn(lost?'lost':'restored');}`);
  await put('render-stage.js', `export const DEFAULT_CAMERA={};export function createRenderStage(gltf,asset,options){options.controlsFactory?.({},{ });return {dispose(){gltf.stageDisposed=true},getSnapshot:()=>({asset}),getPreviewKey:()=>asset.id,reset(){},resize(){},setProfile(){}};}`);
  await put('queue.js', 'export function createPreviewQueue({rendererFactory}){const renderer=rendererFactory();return {request(id,url,options,callback){renderer.prepare(url,options).then(()=>callback({status:"ready"}),error=>callback({status:"error",error}));},dispose(){},retain(){},cancel(){}};}');
  let adapter = await readFile(new URL('review-frontend/adapters/entity-viewer.mjs', source), 'utf8');
  const start = adapter.indexOf('async function runtime()');
  adapter = adapter.slice(0,start) + "async function runtime(){return import('./fixture-runtime.js');}\n" + adapter.slice(adapter.indexOf('function abortError()', start));
  await put('entity-viewer.mjs', adapter);
  await put('fixture-runtime.js', `import {createModelViewer as createNative} from './model-viewer.js';export function createModelViewer(host,options){return createNative(host,{...options,loadModel:async()=>({scene:{traverse(){}}})});}export * from './model-resource.js';export * from './render-runtime.js';export * from './render-stage.js';export * from './entity-render-profiles.js';export * from './thumbnail-runtime.js';export * from './asset-delivery.js';export class OrbitControls{addEventListener(){}removeEventListener(){}}`);
  return name => import(pathToFileURL(join(dir,name)).href);
}
const asset = overrides => ({id:'model',format:'gltf',bytes:100,sha256:'a'.repeat(64),...overrides});

test('automatic preparation rejects known budgets before graph download through both card entries', async t => {
  const load = await fixture(t), resources = await load('model-resource.js'), transport = await load('model-bundle-transport.js');
  const {createThumbnailRenderer} = await load('entity-viewer.mjs');
  const {createThumbnailQueue} = await load('thumbnail-runtime.js');
  const renderer = createThumbnailRenderer(), queue = createThumbnailQueue();
  t.after(()=>{renderer.dispose();queue.dispose();});
  for (const overrides of [{bytes:9*1024*1024},{evidence:{visiblePrimitiveCount:513}},{evidence:{visibleTriangleCount:500001}},{bytes:undefined},{unavailable:true}]) {
    const model = asset(overrides), reason = resources.automaticPreviewReason(model);
    await assert.rejects(renderer.prepare(model), {message:reason});
    const result = await new Promise(resolve=>queue.request(model,{},resolve));
    assert.equal(result.status,'error');assert.equal(result.error.message,reason);
  }
  assert.equal(transport.downloads,0);
  await renderer.prepare(asset());assert.equal(transport.downloads,1);
  await resources.prepareModelResource(asset({bytes:9*1024*1024}));assert.equal(transport.downloads,2);
});

test('context loss retires ready detail, clears snapshots and permits a restored lease', async t => {
  const load=await fixture(t), {createModelViewer}=await load('model-viewer.js'), {sharedRendererPool:pool,context}=await load('render-runtime.js');
  let retired=0;const errors=[];
  const viewer=createModelViewer({}, {loadModel:async()=>({scene:{traverse(){retired++;}}}),onError:error=>errors.push(error)});
  assert.equal(await viewer.open(asset()),true);assert(viewer.getSnapshot());
  context(true);
  assert.equal(viewer.active,false);assert.equal(viewer.getSnapshot(),null);assert.equal(viewer.getPreviewKey(),null);
  assert.equal(pool.stats.active,false);assert.equal(retired,1);assert.equal(errors[0].code,'WEBGL_CONTEXT_LOST');
  context(false);assert.equal(await viewer.open(asset()),true);viewer.close();assert.equal(pool.stats.active,false);
});

test('context loss during parse holds lease until late model cleanup; queued retry cannot overtake it', async t => {
  const load=await fixture(t), {createModelViewer}=await load('model-viewer.js'), {sharedRendererPool:pool,context}=await load('render-runtime.js');
  const parsed=gate(),started=gate();let disposed=0,stages=0;
  const viewer=createModelViewer({}, {loadModel:()=>{started.resolve();return parsed.promise;},stageFactory:()=>{stages++;return {dispose(){}};}});
  const opening=viewer.open(asset());await started.promise;context(true);context(false);
  let acquired=false;const next=pool.acquire().then(lease=>{acquired=true;assert.equal(disposed,1);lease.release();});
  await Promise.resolve();assert.equal(acquired,false);assert.equal(pool.stats.active,true);
  parsed.resolve({scene:{traverse(){disposed++;}}});assert.equal(await opening,false);await next;assert.equal(stages,0);assert.equal(viewer.pendingLoads,0);
});

test('adapter clears ready and old snapshot on loss, reports UI error and rebuilds after restoration', async t => {
  const load=await fixture(t), {createViewer}=await load('entity-viewer.mjs'), {context,sharedRendererPool:pool}=await load('render-runtime.js');
  const previous=globalThis.document;
  globalThis.document={createElement:()=>({dataset:{},setAttribute(){},remove(){}})};
  t.after(()=>{globalThis.document=previous;});
  const host={replaceChildren(){}}, errors=[];
  const viewer=await createViewer(host,asset(),{onError:error=>errors.push(error)});
  assert.equal(viewer.ready,true);assert(viewer.getSnapshot());context(true);
  assert.equal(viewer.ready,false);assert.equal(viewer.getSnapshot(),null);assert.equal(viewer.getCamera(),null);assert.equal(errors[0].code,'WEBGL_CONTEXT_LOST');
  await assert.rejects(createViewer(host,asset()),{code:'WEBGL_CONTEXT_LOST'});
  context(false);const rebuilt=await createViewer(host,asset());assert.equal(rebuilt.ready,true);rebuilt.dispose();assert.equal(pool.stats.active,false);
});

test('hosted UI exposes loss and retries only the current detail request', async () => {
  const app=await readFile(new URL('review-frontend/shared/app.mjs',source),'utf8');
  const start=app.indexOf('  const onViewerError ='),end=app.indexOf('  try {\n    const modelUrl',start);
  const nodes=new Map(), $=id=>{if(!nodes.has(id))nodes.set(id,{append:button=>buttons.push(button)});return nodes.get(id);};
  const buttons=[], abort=new AbortController();let retries=0,pauses=0;
  const build=new Function('$','document','stageA','abort','pausePlayback','startViewers',`let request=1,viewerRequest=1;${app.slice(start,end)}return {onViewerError,stale(){viewerRequest++}};`);
  const ui=build($,{createElement:()=>({})},{append:()=>assert.fail('Retry must be outside clipped stage')},abort,()=>pauses++,()=>retries++);
  ui.onViewerError({code:'WEBGL_CONTEXT_LOST',message:'context lost'});
  assert.equal($('#preview-caption').textContent,'context lost');assert.equal($('#animation-controls').hidden,true);assert.equal(pauses,1);
  $('#retry-preview').onclick();assert.equal(retries,1);ui.stale();$('#retry-preview').onclick();assert.equal(retries,1);
  ui.onViewerError({code:'WEBGL_CONTEXT_LOST'});assert.equal($('#retry-preview').hidden,false);
});

test('detail waiting for the renderer receives a retryable loss without releasing the active owner', async t => {
  const load=await fixture(t), {createModelViewer}=await load('model-viewer.js'), {sharedRendererPool:pool,context}=await load('render-runtime.js');
  const active=await pool.acquire(),errors=[];
  const viewer=createModelViewer({}, {onError:error=>errors.push(error)});
  const opening=viewer.open(asset());context(true);
  assert.equal(await opening,false);assert.equal(errors[0].code,'WEBGL_CONTEXT_LOST');assert.equal(pool.stats.active,true);
  active.release();context(false);assert.equal(pool.stats.active,false);
});
