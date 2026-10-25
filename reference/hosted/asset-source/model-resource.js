import {loadBundledClosedGLTFBytes} from './model-bundle-transport.js';
import {LoadingManager} from './vendor/three.module.js';
import {loadClosedGLTFBytes,closedGLTFBlobScope,validateClosedGLTFDocument} from './shared-resource-transport.js';
import {GLTFLoader} from './vendor/loaders/GLTFLoader.js';
import {loadAssetBytes} from './asset-transport.js';
import {applyExactSourceMatrices} from './gltf-static-matrices.js';
import {resolveAssetDelivery} from './asset-delivery.js';
import {checkAbort} from './render-pool.js';
export function validateSelfContainedGLB(buffer){
 const d=new DataView(buffer);if(buffer.byteLength<20||d.getUint32(0,true)!==0x46546c67||d.getUint32(4,true)!==2||d.getUint32(8,true)!==buffer.byteLength)throw Error('GLB 文件头无效');
 const length=d.getUint32(12,true);if(d.getUint32(16,true)!==0x4e4f534a||20+length>buffer.byteLength)throw Error('GLB JSON 无效');
 const json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)));
 for(const r of [...(json.buffers||[]),...(json.images||[])])if(r.uri&&!/^data:(image\/(png|jpeg|webp)|application\/octet-stream);base64,/.test(r.uri))throw Error('仅允许自包含 GLB，外部资源需先由适配层处理');
 return json;
}
const disposedResources=new WeakSet();
export function disposeGLTF(gltf){
 const geometries=new Set(),materials=new Set(),textures=new Set(),images=new Set(),instances=new Set();
 for(const root of gltf.scenes||[gltf.scene])root?.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.isInstancedMesh)instances.add(o);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m);if(o.skeleton?.boneTexture)textures.add(o.skeleton.boneTexture);});
 const errors=[],release=(resource,method)=>{if(disposedResources.has(resource))return;try{method();disposedResources.add(resource);}catch(error){errors.push(error);}};
 for(const m of materials){for(const v of Object.values(m))if(v?.isTexture)textures.add(v);release(m,()=>m.dispose());}
 for(const t of textures){const im=t.source?.data||t.image;if(im)images.add(im);release(t,()=>t.dispose());}
 for(const im of images)if(typeof im.close==='function')release(im,()=>im.close());for(const g of geometries)release(g,()=>g.dispose());
 for(const instance of instances)release(instance,()=>instance.dispose());
 if(errors.length)throw new AggregateError(errors,'GLTF cleanup incomplete; remaining resources retained for retry');
}

const orphaned=new Set();
export function retryOrphanedModels(){for(const gltf of [...orphaned])try{disposeGLTF(gltf);orphaned.delete(gltf);}catch{}}
export function retireModel(gltf){if(!gltf)return;orphaned.add(gltf);disposeGLTF(gltf);orphaned.delete(gltf);}
export const THUMBNAIL_LIMITS=Object.freeze({modelBytes:8*1024*1024,draws:512,triangles:500000,textureBytes:64*1024*1024,geometryBytes:64*1024*1024});
export function automaticPreviewReason(asset){
 const delivery=resolveAssetDelivery(asset);if(delivery.status!=='available')return '资源供应未配置，不能加载此模型';
 if(!Number.isSafeInteger(asset.bytes)||asset.bytes<1)return '模型字节预算未声明；打开详情后按需加载';
 if(asset.bytes>THUMBNAIL_LIMITS.modelBytes||asset.evidence?.visiblePrimitiveCount>THUMBNAIL_LIMITS.draws||asset.evidence?.visibleTriangleCount>THUMBNAIL_LIMITS.triangles)return '复杂模型：打开详情后按需渲染';
 return null;
}
export function inspectGLBBudget(buffer,json=validateSelfContainedGLB(buffer)){
 const view=new DataView(buffer);let offset=12,binary=null;
 while(offset+8<=buffer.byteLength){const length=view.getUint32(offset,true),kind=view.getUint32(offset+4,true);if(offset+8+length>buffer.byteLength)throw Error('GLB chunk 越界');if(kind===0x004e4942)binary=new Uint8Array(buffer,offset+8,length);offset+=8+length;}
 return inspectBudget(json,buffer.byteLength,b=>{if(b.buffer!==0||!binary||(b.byteOffset||0)+b.byteLength>binary.length)throw Error('GLB image buffer 无效');return binary.subarray(b.byteOffset||0,(b.byteOffset||0)+b.byteLength);});
}
function inspectBudget(json,modelBytes,readView){
 if((json.extensionsUsed||[]).includes('EXT_mesh_gpu_instancing')||(json.nodes||[]).some(n=>n.extensions?.EXT_mesh_gpu_instancing))throw Error('自动预览不支持实例化模型；请在详情按需加载');
 let draws=0,triangles=0,textureBytes=0;
 for(const n of json.nodes||[])if(n.mesh!==undefined){const mesh=json.meshes?.[n.mesh];if(!mesh)throw Error('GLB mesh index 无效');for(const p of mesh.primitives||[]){draws++;const count=json.accessors?.[p.indices]?.count||json.accessors?.[p.attributes?.POSITION]?.count||0;triangles+=Math.ceil(count/3);}}
 const dimensions=[];
 for(const im of json.images||[]){
  let data;
  if(im.bufferView!==undefined){const b=json.bufferViews?.[im.bufferView];if(!b)throw Error('模型 image buffer 无效');data=readView(b);}
  else if(typeof im.uri==='string'&&im.uri.startsWith('data:image/png;base64,')){const decoded=atob(im.uri.split(',')[1]);data=Uint8Array.from(decoded,c=>c.charCodeAt(0));}
  if(!data||data.length<24||data[0]!==137||String.fromCharCode(...data.subarray(1,4))!=='PNG')throw Error('自动预览无法预检纹理内存；请在详情按需加载');
  const v=new DataView(data.buffer,data.byteOffset,data.byteLength),w=v.getUint32(16),h=v.getUint32(20);if(!w||!h||w>16384||h>16384)throw Error('纹理尺寸超过自动预览预算');dimensions.push(Math.ceil(w*h*4*4/3));
 }
 for(const t of json.textures||[]){const size=dimensions[t.source];if(size===undefined)throw Error('无法预检纹理扩展；请在详情按需加载');textureBytes+=size;}
 // GLTFLoader copies each distinct bufferView even when transport payloads share a SHA.
 const geometryBytes=Math.max((json.bufferViews||[]).reduce((n,b)=>n+(b.byteLength||0),0),(json.buffers||[]).reduce((n,b)=>n+(b.byteLength||0),0));
 return {modelBytes,draws,triangles,textureBytes,geometryBytes};
}
function enforceUsage(usage){for(const [key,max]of Object.entries(THUMBNAIL_LIMITS))if(usage[key]>max)throw Error('自动预览超过 '+key+' 预算；请在详情按需加载');return usage;}
export function enforceThumbnailBudget(buffer,json){return enforceUsage(inspectGLBBudget(buffer,json));}
export function inspectClosedGLTFBudget(bundle){return inspectBudget(bundle.json,bundle.totalBytes,v=>{const b=bundle.json.buffers[v.buffer],sha=b.uri.slice('../resources/'.length,-4),bytes=bundle.buffers.get(sha);if(!bytes)throw Error('模型 buffer 缺失');return new Uint8Array(bytes,v.byteOffset||0,v.byteLength);});}
const orphanedBlobScopes=new Set();
export function retryOrphanedBlobScopes(){for(const scope of [...orphanedBlobScopes])try{scope.dispose();orphanedBlobScopes.delete(scope);}catch{}}
function trackParserOwnership(loader){
 const tasks=new Set(),observed=new Set(),values=new Set(),parsers=new Set(),errors=[];
 const remember=value=>{if(Array.isArray(value))value.forEach(remember);else if(value)values.add(value);};
 const watch=value=>{if(value?.then){if(!observed.has(value)){observed.add(value);tasks.add(Promise.resolve(value).then(remember,error=>errors.push(error)));}}else remember(value);};
 loader.register?.(parser=>{parsers.add(parser);
  for(const name of ['getDependency','loadGeometries','loadImageSource']){const original=parser[name];if(typeof original!=='function')continue;parser[name]=function(...args){try{const result=original.apply(this,args);watch(result);return result;}finally{remember(this.cache?.DefaultMaterial);for(const item of Object.values(this.primitiveCache||{}))watch(item.promise);}};}
  const add=parser.cache?.add;if(typeof add==='function')parser.cache.add=function(key,value){watch(value);return add.call(this,key,value);};
  const assign=parser.assignFinalMaterial;if(typeof assign==='function')parser.assignFinalMaterial=function(mesh){remember(mesh);return assign.call(this,mesh);};
  const images=parser.textureLoader,loadImage=images?.load;if(typeof loadImage==='function')images.load=function(url,onLoad,onProgress,onError){return loadImage.call(this,url,image=>{if(image?.isTexture)remember(image);else if(typeof image?.close==='function')remember({isTexture:true,image,dispose(){}});onLoad(image);},onProgress,onError);};
  return{name:'ENTITY_closed_resource_owner'};
 });
 return {errors,async settle(){let count;do{for(const parser of parsers)remember(parser.cache?.DefaultMaterial);count=tasks.size;await Promise.all([...tasks]);}while(count!==tasks.size);},
  retire(){const roots=[...values].filter(v=>v?.isObject3D),materials=[...values].filter(v=>v?.isMaterial),textures=[...values].filter(v=>v?.isTexture),geometries=[...values].filter(v=>v?.isBufferGeometry);const carrier={dispose(){}};textures.forEach((t,i)=>carrier['texture'+i]=t);roots.push({traverse(fn){fn({material:[...materials,carrier]});for(const geometry of geometries)fn({geometry});}});retireModel({scenes:roots});},
 };
}
export async function parseClosedGLTFBundle(bundle,{loaderFactory=manager=>new GLTFLoader(manager),scopeFactory=closedGLTFBlobScope}={}){
 validateClosedGLTFDocument(bundle.json,{resources:new Map([...bundle.buffers].map(([sha256,bytes])=>[sha256,{sha256,bytes:bytes.byteLength}]))});
 const scope=scopeFactory(bundle),manager=new LoadingManager(),errors=[];manager.setURLModifier(uri=>scope.resolve(uri));manager.onError=uri=>errors.push(Error('Closed glTF dependency failed: '+uri));let gltf,error,ownership;
 try{const loader=loaderFactory(manager);ownership=trackParserOwnership(loader);gltf=await loader.parseAsync(bundle.json,'');await ownership.settle();if(errors.length||ownership.errors.length)throw new AggregateError([...errors,...ownership.errors],'Closed glTF image or buffer failed');}catch(e){error=e;await ownership?.settle();}
 finally{manager.setURLModifier(()=>{throw Error('Closed glTF parser scope has ended');});orphanedBlobScopes.add(scope);try{scope.dispose();orphanedBlobScopes.delete(scope);}catch(cleanup){error=new AggregateError([...(error?[error]:[]),cleanup],'Closed glTF Blob cleanup retained for retry');}}
 if(error){const failures=[error];if(gltf)try{retireModel(gltf);}catch(cleanup){failures.push(cleanup);}try{ownership?.retire();}catch(cleanup){failures.push(cleanup);}if(failures.length>1)throw new AggregateError(failures,'Closed glTF parse cleanup retained for retry');throw error;}return gltf;
}
export async function loadModelResource(asset,{signal,automatic=false,fetcher,cache,parse=bytes=>new GLTFLoader().parseAsync(bytes,''),parseGraph=parseClosedGLTFBundle}={}){
 retryOrphanedModels();retryOrphanedBlobScopes();if(orphaned.size||orphanedBlobScopes.size)throw Error('上一模型清理尚未完成，暂停新解析');if(automatic){const reason=automaticPreviewReason(asset);if(reason)throw Error(reason);}
 let gltf,bundle,json,sha256;
 try{
  if(asset.format==='gltf'){bundle=await loadBundledClosedGLTFBytes(asset,{signal,fetcher,cache});json=bundle.json;sha256=bundle.sha256;if(automatic)enforceUsage(inspectClosedGLTFBudget(bundle));checkAbort(signal);gltf=await parseGraph(bundle);}
  else{const result=await loadAssetBytes(asset,{signal,fetcher});json=validateSelfContainedGLB(result.bytes);sha256=result.sha256;if(automatic)enforceThumbnailBudget(result.bytes,json);checkAbort(signal);gltf=await parse(result.bytes);}
  checkAbort(signal);applyExactSourceMatrices(gltf,json);gltf.previewSHA256=sha256;return gltf;
 }catch(error){if(gltf)try{retireModel(gltf);}catch(cleanup){throw new AggregateError([error,cleanup],'Model setup failed; cleanup retained for retry');}throw error;}
 finally{bundle?.buffers.clear();}
}

// Only bytes are prepared concurrently. GLTF parsing remains inside the GPU lease.
export async function prepareModelResource(asset,{signal}={}){if(asset.format!=='gltf')return;const bundle=await loadBundledClosedGLTFBytes(asset,{signal});bundle.buffers.clear();checkAbort(signal);}
