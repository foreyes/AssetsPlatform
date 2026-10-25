import {createPreviewQueue} from './shared/preview-queue.mjs';
import {sharedRendererPool,subscribeContext} from './render-runtime.js';
import {loadModelResource,prepareModelResource,retireModel,automaticPreviewReason} from './model-resource.js';
import {createRenderStage,DEFAULT_CAMERA} from './render-stage.js';
import {ENTITY_CAPABILITIES,freezeSnapshot} from './entity-render-profiles.js';
import {checkAbort} from './render-pool.js';
export const CARD_RENDER=Object.freeze({width:320,height:200,dpr:1,maxEntries:32,maxVisible:20,maxRasterBytes:32*1024*1024});
const blobLimit=CARD_RENDER.width*CARD_RENDER.height*4+65536;
export const OWNED_RASTER_BOUND=(CARD_RENDER.maxEntries*(CARD_RENDER.width*CARD_RENDER.height*4+blobLimit))+(CARD_RENDER.maxVisible+2)*CARD_RENDER.width*CARD_RENDER.height*4;
if(OWNED_RASTER_BOUND>CARD_RENDER.maxRasterBytes)throw Error('Raster cache exceeds declared bound');
export function thumbnailIdentity(asset,profile,{width=CARD_RENDER.width,height=CARD_RENDER.height,dpr=CARD_RENDER.dpr,camera=DEFAULT_CAMERA,pose={mode:'gltf-default-static',animationApplied:false}}={}){
 const sha=asset.preview_sha256||asset.sha256;if(!/^[a-f0-9]{64}$/.test(sha||''))throw Error('Thumbnail requires an immutable model SHA');
 return JSON.stringify({schema:'entity-realtime-request/v1',modelSHA256:sha,backend:ENTITY_CAPABILITIES,profile,camera,pose,time:0,width,height,dpr,renderTarget:{format:'rgba8-default-framebuffer',dynamicRange:'ldr',colorSpace:'srgb'}});
}
export function copyFrame(renderer,{signal,document:doc=globalThis.document}={}){
 checkAbort(signal);const copy=doc.createElement('canvas');copy.width=renderer.domElement.width;copy.height=renderer.domElement.height;
 try{const context=copy.getContext('2d');if(!context)throw Error('浏览器无法复制实时预览帧');context.drawImage(renderer.domElement,0,0);checkAbort(signal);}catch(error){copy.width=0;copy.height=0;throw error;}
 return new Promise((resolve,reject)=>{let done=false;const finish=(error,blob)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);copy.width=0;copy.height=0;error?reject(error):resolve(blob);};
  const cancel=()=>finish(new DOMException('Preview cancelled','AbortError'));const timer=setTimeout(()=>finish(Error('实时预览帧编码超时')),10000);signal?.addEventListener('abort',cancel,{once:true});
  try{copy.toBlob(blob=>{if(!blob)finish(Error('实时预览帧编码失败'));else if(blob.size>blobLimit)finish(Error('实时预览帧超过缓存预算'));else finish(null,blob);},'image/png');}catch(error){finish(error);}
 });
}
const cleanupOwners=new Set();
function cleanupOwner(owner){
 const errors=[];
 if(owner.stage)try{owner.stage.dispose();owner.stage=null;}catch(error){errors.push(error);}
 if(owner.gltf)try{retireModel(owner.gltf);owner.gltf=null;}catch(error){errors.push(error);}
 // Keep the exclusive lease while any parsed/stage resource is still owned.
 if(!owner.stage&&!owner.gltf&&owner.lease)try{owner.lease.release();owner.lease=null;}catch(error){errors.push(error);}
 if(!owner.stage&&!owner.gltf&&!owner.lease)cleanupOwners.delete(owner);
 return errors;
}
export function retryThumbnailCleanup(){const errors=[];for(const owner of [...cleanupOwners])errors.push(...cleanupOwner(owner));return errors;}
export const thumbnailCleanupPending=()=>cleanupOwners.size;
export async function renderThumbnail(asset,{profile,signal,pool=sharedRendererPool,loadModel=loadModelResource,stageFactory=createRenderStage,capture=copyFrame,onSnapshot=()=>{}}={}){
 const reason=automaticPreviewReason(asset);if(reason)throw Error(reason);
 retryThumbnailCleanup();if(cleanupOwners.size)throw Error('上一帧资源清理未完成，暂停新模型以维持内存预算');
 const lease=await pool.acquire({signal,priority:0});let gltf,stage,result,error;
 try{
  gltf=await loadModel(asset,{signal:lease.signal,automatic:true});checkAbort(lease.signal);
  stage=stageFactory(gltf,asset,{lease,profile,width:CARD_RENDER.width,height:CARD_RENDER.height,dpr:CARD_RENDER.dpr});
  const snapshot=stage.draw();const blob=await capture(lease.renderer,{signal:lease.signal});checkAbort(lease.signal);if(!lease.valid)throw Error('WebGL frame epoch changed');
  result={blob,snapshot:freezeSnapshot(snapshot)};
 }catch(e){error=e;if(e?.stageForCleanup)stage=e.stageForCleanup;}finally{
  const owner={stage,gltf,lease};cleanupOwners.add(owner);const errors=cleanupOwner(owner);
  if(errors.length)error=new AggregateError([...(error?[error]:[]),...errors],'Thumbnail cleanup incomplete');
 }
 if(error)throw error;checkAbort(signal);checkAbort(lease.signal);if(pool.stats?.epoch!==undefined&&pool.stats.epoch!==lease.epoch)throw Error('WebGL context epoch changed');onSnapshot(result.snapshot);return result.blob;
}
export function createThumbnailQueue({onInvalidate=()=>{},render=renderThumbnail,prepare=render===renderThumbnail?prepareModelResource:null,makeURL,revokeURL}={}){
 let queue,snapshots=new Map(),pendingSnapshots=new Map(),closed=false;
 const make=()=>createPreviewQueue({maxEntries:CARD_RENDER.maxEntries,makeURL,revokeURL,rendererFactory:()=>({...(prepare?{prepare(_url,options){return prepare(options.asset,options);}}:{}),async render(_url,options){let snapshot;const blob=await render(options.asset,{...options,onSnapshot(value){snapshot=value;}});checkAbort(options.signal);pendingSnapshots.set(options.identity,snapshot);return blob;},dispose(){}})});
 queue=make();const unsubscribe=subscribeContext(()=>{queue.dispose();snapshots.clear();pendingSnapshots.clear();if(!closed)queue=make();onInvalidate();});
 return {
  request(asset,profile,callback){asset=freezeSnapshot(structuredClone(asset));profile=freezeSnapshot(structuredClone(profile));const identity=thumbnailIdentity(asset,profile);queue.request(identity,asset.preview_uri,{asset,profile,identity},result=>{if(result.status==='ready'){const snapshot=pendingSnapshots.get(identity)||snapshots.get(identity);pendingSnapshots.delete(identity);snapshots.delete(identity);snapshots.set(identity,snapshot);while(snapshots.size>CARD_RENDER.maxEntries)snapshots.delete(snapshots.keys().next().value);}callback({...result,identity,snapshot:snapshots.get(identity)||null});});},
  retain(keys){queue.retain(keys);},
  cancel(){queue.cancel();pendingSnapshots.clear();},dispose(){if(closed)return;closed=true;unsubscribe();queue.dispose();snapshots.clear();pendingSnapshots.clear();},
  get stats(){return {...queue.stats,maxVisible:CARD_RENDER.maxVisible,maximumOwnedRasterBytes:OWNED_RASTER_BOUND,webglContexts:sharedRendererPool.stats.contexts};},
 };
}
