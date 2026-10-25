// Closed glTF is an explicit representation, never a fallback for unavailable GLBs.
// Transport/ownership adapter. Materials, coverage and display-profile parameters are preserved; the build revision changes.
import {createVerifiedResourceCache} from './verified-resource-cache.js';

export const CLOSED_GLTF_REPRESENTATION='closed-gltf/v1';
export const CLOSED_GLTF_LIMITS=Object.freeze({documentBytes:64*1024*1024,totalBytes:256*1024*1024,resources:8192,bufferViews:100000,workers:4});
const SHA=/^[a-f0-9]{64}$/;
const MODEL=/^((?:\/api\/assets\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+|\/__entity_assets\/batch-[a-f0-9]{64}))\/models\/([a-f0-9]{64})\.gltf$/;
const URI=/^\.\.\/resources\/([a-f0-9]{64})\.bin$/;
const allowedExtensions=new Set(['KHR_texture_transform','KHR_materials_unlit','KHR_materials_emissive_strength','KHR_materials_ior','KHR_materials_specular','KHR_materials_clearcoat','KHR_materials_sheen','KHR_materials_transmission','KHR_materials_volume','KHR_materials_iridescence','KHR_materials_anisotropy','KHR_mesh_quantization']);
const positive=n=>Number.isSafeInteger(n)&&n>0;
const cancelled=signal=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');};
export function closedGLTFURL(value){return typeof value==='string'&&!value.includes('..')&&MODEL.exec(value)?.[0]===value?value:null;}

export function resolveClosedGLTFDeclaration(asset){
 const d=asset?.delivery,match=typeof d?.url==='string'&&d.url.match(MODEL);
 if(asset?.format!=='gltf'||d?.status!=='available'||d.kind!==(d.url?.startsWith('/__entity_assets/')?'same-origin-static':'same-origin-api')||d.representation!==CLOSED_GLTF_REPRESENTATION||!match||!closedGLTFURL(d.url))throw Error('Invalid explicit closed glTF delivery');
 const expected=asset.preview_sha256||asset.sha256;
 if(!SHA.test(expected||'')||d.sha256!==expected||match[2]!==expected||!positive(d.bytes)||d.bytes>CLOSED_GLTF_LIMITS.documentBytes||d.transport!=null||asset.transport!=null)throw Error('Closed glTF document hash, length or transport mismatch');
 if(!Array.isArray(d.resources)||d.resources.length>CLOSED_GLTF_LIMITS.resources)throw Error('Invalid closed glTF dependency list');
 const resources=new Map();let total=d.bytes;
 for(const r of d.resources){
  if(typeof r?.sha256!=='string'||r.sha256.length!==64||!SHA.test(r.sha256)||!positive(r.bytes)||r.bytes>CLOSED_GLTF_LIMITS.documentBytes||r.url!==match[1]+'/resources/'+r.sha256+'.bin'||resources.has(r.sha256))throw Error('Invalid, cross-version or duplicate closed glTF dependency');
  total+=r.bytes;if(!Number.isSafeInteger(total)||total>CLOSED_GLTF_LIMITS.totalBytes)throw Error('Closed glTF exceeds total byte budget');
  resources.set(r.sha256,Object.freeze({url:r.url,sha256:r.sha256,bytes:r.bytes}));
 }
 if(d.totalBytes!==total||asset.bytes!==total)throw Error('Closed glTF total byte budget mismatch');
 return {root:Object.freeze({url:d.url,sha256:expected,bytes:d.bytes}),resources,totalBytes:total,base:match[1]};
}

// All interpreted extensions are allowlisted. Opaque extras remain evidence, not URLs.
function inspectExtensions(root){
 const pending=[[root,0]];let visited=0;
 while(pending.length){const [value,depth]=pending.pop();if(!value||typeof value!=='object')continue;
  if(depth>128||++visited>500000)throw Error('Closed glTF structural budget exceeded');
  for(const [key,child]of Object.entries(value)){if(key==='extras')continue;
   if(key==='extensions')for(const name of Object.keys(child||{}))if(!allowedExtensions.has(name))throw Error('Unsupported closed glTF extension: '+name);
   if(child&&typeof child==='object')pending.push([child,depth+1]);
  }
 }
}
// v1 is the exercised static-export subset, not an unrestricted glTF runtime.
// Validate before allocation so a rejected accessor cannot strand a half-built geometry.
function validateStaticGeometry(json){
 const accessors=json.accessors||[],meshes=json.meshes||[],nodes=json.nodes||[],scenes=json.scenes||[];
 if(![accessors,meshes,nodes,scenes].every(Array.isArray)||!scenes.length||!Number.isSafeInteger(json.scene??0)||!scenes[json.scene??0]||(json.skins?.length||json.animations?.length))throw Error('Unsupported closed glTF static scene');
 const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4},bytes={5121:1,5123:2,5125:4,5126:4};let allocation=0;
 for(const a of accessors){const view=json.bufferViews[a?.bufferView],offset=a?.byteOffset??0,size=bytes[a?.componentType],components=width[a?.type];
  if(!view||!Number.isSafeInteger(a.bufferView)||!size||!components||!positive(a.count)||!Number.isSafeInteger(offset)||offset<0||a.sparse!==undefined||(a.normalized!==undefined&&a.normalized!==false)||view.byteStride!==undefined)throw Error('Unsupported closed glTF accessor subset');
  const length=a.count*size*components;allocation+=length;
  if(!Number.isSafeInteger(length)||!Number.isSafeInteger(allocation)||allocation>CLOSED_GLTF_LIMITS.totalBytes||offset+length>view.byteLength||offset%size||(view.byteOffset||0)%size)throw Error('Closed glTF accessor is out of bounds or allocation budget');
  for(const key of ['min','max'])if(a[key]!==undefined&&(!Array.isArray(a[key])||a[key].length!==components||!a[key].every(Number.isFinite)))throw Error('Invalid closed glTF accessor bounds');
 }
 const dimensions={POSITION:[3],NORMAL:[3],TANGENT:[4],TEXCOORD_0:[2],TEXCOORD_1:[2],COLOR_0:[3,4]};
 for(const mesh of meshes){if(!Array.isArray(mesh?.primitives)||!mesh.primitives.length)throw Error('Invalid closed glTF primitive list');for(const p of mesh.primitives){
  if(!p?.attributes||typeof p.attributes!=='object'||Array.isArray(p.attributes)||(p.mode??4)!==4||p.targets!==undefined)throw Error('Unsupported closed glTF primitive subset');
  const position=accessors[p.attributes.POSITION];if(!position)throw Error('Missing closed glTF POSITION');
  for(const [name,index]of Object.entries(p.attributes)){const a=accessors[index];if(!Number.isSafeInteger(index)||!a||a.componentType!==5126||!dimensions[name]?.includes(width[a.type])||a.count!==position.count)throw Error('Invalid closed glTF attribute');}
  const index=p.indices===undefined?null:accessors[p.indices];if(p.indices!==undefined&&(!Number.isSafeInteger(p.indices)||!index||index.type!=='SCALAR'||![5121,5123,5125].includes(index.componentType)))throw Error('Invalid closed glTF indices');
  if((index?.count??position.count)%3!==0)throw Error('Closed glTF triangles have incomplete indices');
  if(p.material!==undefined&&(!Number.isSafeInteger(p.material)||!json.materials?.[p.material]))throw Error('Invalid closed glTF material reference');
 }}
 const indegree=new Uint32Array(nodes.length),edges=nodes.map(n=>{if(!n||typeof n!=='object'||n.skin!==undefined||n.weights!==undefined||!Array.isArray(n.children||[]))throw Error('Unsupported closed glTF node');if(n.mesh!==undefined&&(!Number.isSafeInteger(n.mesh)||!meshes[n.mesh]))throw Error('Invalid closed glTF mesh reference');return n.children||[];});
 for(const children of edges)for(const child of children)if(!Number.isSafeInteger(child)||!nodes[child]||++indegree[child]>1)throw Error('Invalid or shared closed glTF child node');
 const queue=[];indegree.forEach((n,i)=>{if(n===0)queue.push(i);});let visited=0;while(visited<queue.length){for(const child of edges[queue[visited++]])if(--indegree[child]===0)queue.push(child);}if(visited!==nodes.length)throw Error('Closed glTF node cycle');
 for(const scene of scenes)if(!Array.isArray(scene?.nodes)||scene.nodes.some(i=>!Number.isSafeInteger(i)||!nodes[i]))throw Error('Invalid closed glTF scene root');
}
export function validateClosedGLTFDocument(json,declaration){
 if(json?.asset?.version!=='2.0'||!Array.isArray(json.buffers)||json.buffers.length>CLOSED_GLTF_LIMITS.resources||!Array.isArray(json.bufferViews)||json.bufferViews.length>CLOSED_GLTF_LIMITS.bufferViews)throw Error('Invalid closed glTF document');
 for(const names of [json.extensionsUsed||[],json.extensionsRequired||[]]){if(!Array.isArray(names))throw Error('Invalid glTF extension list');for(const name of names)if(!allowedExtensions.has(name))throw Error('Unsupported closed glTF extension: '+name);}
 inspectExtensions(json);const used=new Set();
 for(const b of json.buffers){const match=typeof b?.uri==='string'&&b.uri.match(URI),r=match&&match[0]===b.uri&&declaration.resources.get(match[1]);if(!r||b.byteLength!==r.bytes)throw Error('Unclosed or mismatched glTF buffer');used.add(r.sha256);}
 if(used.size!==declaration.resources.size)throw Error('Orphan closed glTF dependency');
 let viewBytes=0;
 for(const v of json.bufferViews){const b=json.buffers[v?.buffer],offset=v?.byteOffset??0;if(!Number.isSafeInteger(v?.buffer)||!b||!Number.isSafeInteger(offset)||offset<0||!positive(v.byteLength)||offset+v.byteLength>b.byteLength)throw Error('Closed glTF bufferView is out of bounds');viewBytes+=v.byteLength;if(!Number.isSafeInteger(viewBytes)||viewBytes>CLOSED_GLTF_LIMITS.totalBytes)throw Error('Closed glTF decoded view allocation budget exceeded');}
 if(json.images!==undefined&&!Array.isArray(json.images))throw Error('Invalid closed glTF image list');
 for(const im of json.images||[])if(im?.uri!==undefined||!Number.isSafeInteger(im?.bufferView)||!json.bufferViews[im.bufferView]||!/^image\/(png|jpeg|webp)$/.test(im.mimeType))throw Error('Unclosed glTF image');
 validateStaticGeometry(json);
 return json;
}

// The browser uses one cache for both list and detail requests. Injected transports get
// their own cache unless the caller deliberately supplies a shared one (offline QA).
let sharedCache;
export function sharedResourceCache(){return sharedCache??=createVerifiedResourceCache();}
export async function loadClosedGLTFBytes(asset,{signal,fetcher,cache}={}){
 cancelled(signal);const declaration=resolveClosedGLTFDeclaration(asset),owned=!cache&&!!fetcher;
 cache??=fetcher?createVerifiedResourceCache({fetcher}):sharedResourceCache();
 const controller=new AbortController(),relay=()=>controller.abort();signal?.addEventListener('abort',relay,{once:true});
 const buffers=new Map();let succeeded=false;
 try{
  cancelled(signal);const document=await cache.get(declaration.root,{signal:controller.signal});cancelled(signal);
  const json=validateClosedGLTFDocument(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(document)),declaration);
  const list=[...declaration.resources.values()];let next=0;
  await Promise.all(Array.from({length:Math.min(CLOSED_GLTF_LIMITS.workers,list.length)},async()=>{while(next<list.length){cancelled(controller.signal);const r=list[next++],bytes=await cache.get(r,{signal:controller.signal});cancelled(controller.signal);buffers.set(r.sha256,bytes);}}));
  cancelled(signal);succeeded=true;return {json,buffers,sha256:declaration.root.sha256,totalBytes:declaration.totalBytes,declaration};
 }finally{
  if(!succeeded){controller.abort();buffers.clear();}
  signal?.removeEventListener('abort',relay);if(owned)cache.dispose();
 }
}

// Buffer URIs resolve to verified local Blobs. GLTFLoader also creates local image
// Blobs from verified bufferViews; image URI declarations were rejected above.
// Take ownership of those URLs too, including the loader's image-failure path.
export function closedGLTFBlobScope(bundle,{makeURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}={}){
 const urls=new Map(),ownedURLs=new Set();let closed=false;
 return {
  resolve(uri){if(closed)throw Error('Closed glTF Blob scope already released');if(typeof uri==='string'&&uri.startsWith('blob:')){ownedURLs.add(uri);return uri;}const match=typeof uri==='string'&&uri.match(URI),bytes=match&&match[0]===uri&&bundle.buffers.get(match[1]);if(!bytes)throw Error('GLTFLoader requested an undeclared URL');let url=urls.get(match[1]);if(!url){url=makeURL(new Blob([bytes],{type:'application/octet-stream'}));urls.set(match[1],url);ownedURLs.add(url);}return url;},
  dispose(){closed=true;const errors=[];for(const url of ownedURLs)try{revokeURL(url);ownedURLs.delete(url);}catch(error){errors.push(error);}if(!ownedURLs.size)urls.clear();if(errors.length)throw new AggregateError(errors,'Closed glTF Blob cleanup incomplete');},
  get pending(){return ownedURLs.size;},
 };
}
