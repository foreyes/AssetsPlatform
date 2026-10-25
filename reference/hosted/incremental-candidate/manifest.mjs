import {createResourceResolver} from '../asset-source/shared/resource-url.mjs';
import {validateSelfContainedGLB,enforceThumbnailBudget,retireModel} from '../asset-source/model-resource.js';
import {GLTFLoader} from '../asset-source/vendor/loaders/GLTFLoader.js';
import {Texture} from '../asset-source/vendor/three.module.js';
export const PROJECTS=Object.freeze(['HamstersAway','CozyIsland','ParadiseMarsh','Sulfur']);
export const LIMITS=Object.freeze({files:2048,fileBytes:1048576,totalBytes:268435456,blockBytes:32768,manifestBytes:524288,jsonFiles:8});
const HEX=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9_.-]{1,128}$/;
export const fail=code=>{throw Error('ingest-'+code)};
export const exact=(o,keys)=>{if(!o||Array.isArray(o)||typeof o!=='object'||Object.keys(o).some(k=>!keys.includes(k))||keys.some(k=>!(k in o)))fail('schema')};
export const canonical=o=>JSON.stringify(sort(o));
function sort(o){if(Array.isArray(o))return o.map(sort);if(o&&typeof o==='object')return Object.fromEntries(Object.keys(o).sort().map(k=>[k,sort(o[k])]));if(typeof o==='number'&&!Number.isFinite(o))fail('schema');return o}
export const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
export const encode=o=>new TextEncoder().encode(canonical(o));
export function scope(projectId,datasetId){if(!PROJECTS.includes(projectId)||!/^[A-Za-z0-9_-]{1,64}$/.test(datasetId)||['.','..'].includes(datasetId))fail('scope');return `${projectId}/${datasetId}`}
export function path(value){if(typeof value!=='string'||!value||value.length>512||value!==value.normalize('NFC')||!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value)||value.split('/').some(x=>!x||x==='.'||x==='..'||x.startsWith('.')||x!==x.trim()||x.endsWith('.')||/^\.(?:git|env)|^(?:credentials|secrets\.json|id_rsa|id_ed25519)$/i.test(x)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)))fail('path');return value}
export const format=p=>p.split('.').at(-1).toLowerCase();
export const mime=p=>({glb:'model/gltf-binary',png:'image/png',json:'application/json'})[format(p)]||fail('format');
export async function validateManifest(m){exact(m,['schema','projectId','datasetId','adapter','animation','files']);scope(m.projectId,m.datasetId);if(m.schema!=='entity-incremental-indexed/1'||m.adapter!=='indexed-v1'||m.animation!=='metadata-only'||!Array.isArray(m.files)||!m.files.length||m.files.length>LIMITS.files||encode(m).length>LIMITS.manifestBytes)fail('schema');const ids=new Set(),paths=new Set(),hashes=new Map();let total=0,jsons=0;for(const f of m.files){exact(f,['id','path','sha256','bytes','metadata','dependencies','blocks','sourceId','identityKind','dependencyDetection','revision']);path(f.path);if(['project-config-v1.json','project-config-policy-v2.json'].includes(f.path.toLowerCase()))fail('path');mime(f.path);if(f.path.split('.').at(-1)!==format(f.path))fail('format');if(format(f.path)==='json')jsons++;if(!ID.test(f.id)||ids.has(f.id)||paths.has(f.path.toLowerCase())||!HEX.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>LIMITS.fileBytes)fail('schema');if(f.sourceId!==null)checkJSON(f.sourceId);if((f.sourceId!==null&&(typeof f.sourceId!=='string'||!f.sourceId||f.sourceId.length>512||/[\x00-\x1f]/.test(f.sourceId)))||!['stable-source','path-bound'].includes(f.identityKind)||!['declared-and-gltf-uris','declared-only-opaque'].includes(f.dependencyDetection)||!ID.test(f.revision))fail('metadata');exactMetadata(f.metadata);if(!Array.isArray(f.dependencies)||f.dependencies.some(d=>typeof d!=='string'||d===f.id)||new Set(f.dependencies).size!==f.dependencies.length)fail('dependency');if(!Array.isArray(f.blocks)||f.blocks.length!==Math.ceil(f.bytes/LIMITS.blockBytes))fail('blocks');let n=0;for(const b of f.blocks){exact(b,['sha256','bytes']);if(!HEX.test(b.sha256)||b.bytes!==Math.min(LIMITS.blockBytes,f.bytes-n))fail('blocks');n+=b.bytes}if(hashes.has(f.sha256)&&(hashes.get(f.sha256).bytes!==f.bytes||format(hashes.get(f.sha256).path)!==format(f.path)||canonical(hashes.get(f.sha256).blocks)!==canonical(f.blocks)))fail('conflict');hashes.set(f.sha256,f);ids.add(f.id);paths.add(f.path.toLowerCase());total+=f.bytes;}if(total>LIMITS.totalBytes||jsons>LIMITS.jsonFiles)fail('budget');for(const f of m.files)for(const id of f.dependencies)if(!ids.has(id))fail('dependency');for(const p of ['assets/catalog.json','assets/objects-catalog.json','assets/render-profiles.json','assets/canopy-rules.json'])if(!m.files.some(f=>f.path===p))fail('metadata-missing');const sha256=await hash(encode(m));return {manifest:m,sha256,version:'v-'+sha256,scope:scope(m.projectId,m.datasetId),totalBytes:total,unique:[...hashes.values()]}}
function exactMetadata(m){checkJSON(m);if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!['mime','assetType','game','label'].includes(k))||Object.values(m).some(v=>typeof v!=='string'||v.length>512||/[\x00-\x1f]/.test(v)))fail('metadata')}
export async function validateContent(file,bytes){if(format(file.path)==='glb'){try{const b=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);const j=validateSelfContainedGLB(b);checkJSONText(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(b,20,new DataView(b).getUint32(12,true))));if(j.asset?.version!=='2.0'||!Array.isArray(j.scenes)||!j.scenes.length||!Array.isArray(j.nodes)||!j.nodes.length||!Array.isArray(j.meshes)||!j.meshes.length||!j.nodes.some(n=>Number.isSafeInteger(n.mesh)&&j.meshes[n.mesh]?.primitives?.length))fail('model');if((j.animations||[]).length)fail('animation');enforceThumbnailBudget(b,j);await verifyStaticGLB(b,j)}catch(e){if(['ingest-animation','ingest-private-metadata'].includes(e.message))throw e;fail('model')}}else if(format(file.path)==='png'){await validatePNG(bytes)}else {try{checkJSONText(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch(e){if(e.message==='ingest-private-metadata')throw e;fail('json')}}}
export function rootURL(v){return `/api/review-assets/${v.manifest.projectId}/${v.manifest.datasetId}/${v.version}/`}
export function validateCatalogs(v,documents){const get=p=>{if(!documents.has(p))fail('metadata-missing');return structuredClone(documents.get(p))};const catalog=get('assets/catalog.json'),objects=get('assets/objects-catalog.json');if(catalog.version!==1||!Array.isArray(catalog.assets)||!catalog.assets.length||catalog.assets.length>LIMITS.files||objects.version!==2||!Array.isArray(objects.objects)||!objects.objects.length||objects.objects.length>LIMITS.files||catalog.assetShards)fail('catalog');const files=new Map(v.manifest.files.map(f=>[f.path,f])),root=rootURL(v),resolver=createResourceResolver({projectId:v.manifest.projectId,datasetId:v.manifest.datasetId,assetRoot:root,origin:'https://ingest.invalid',dataKind:'indexed'});const ids=new Set();for(const list of [catalog.assets,objects.objects])for(const r of list){if(r?.modelAsset||r?.delivery||r?.transport||r?.resourceBaseUrl)fail('catalog');if(!r||typeof r.id!=='string'||ids.has(r.id)||typeof r.sourceId!=='string'||!r.sourceId||typeof r.name!=='string'||r.name.length>512)fail('catalog');ids.add(r.id)}const URL_KEYS=new Set(['modelUrl','imageUrl','previewUrl','thumbnailUrl','originalUrl','dataUrl','profilesUrl','metadataUrl']);function walk(o){if(!o||typeof o!=='object')return;for(const[k,value]of Object.entries(o)){if((k==='url'||/(?:Url|URL|Uri|URI)$/.test(k))&&typeof value==='string'){if(!URL_KEYS.has(k))fail('reference');let target;try{target=new URL(resolver.resolve(value))}catch{fail('reference')}const p=target.pathname.slice(root.length);if(!files.has(p)||target.hash)fail('dependency');if(k==='modelUrl'&&format(p)!=='glb')fail('format');if(['imageUrl','thumbnailUrl'].includes(k)&&format(p)!=='png')fail('format')}else if(value&&typeof value==='object')walk(value)}}for(const d of documents.values())walk(d);if(objects.objects.some(o=>o.playableClipIds||o.animationPlayable)||catalog.assets.some(o=>o.type==='animation'))fail('animation');const material=get('assets/canopy-rules.json');if(material.version!==1||!Array.isArray(material.flatCanopySourceMaterialIds))fail('catalog');const profiles=get('assets/render-profiles.json');if(profiles.schemaVersion!==1||!Array.isArray(profiles.profiles)||profiles.profiles.length)fail('profiles');return {catalog,objects,profiles,material}}

// Apply the same privacy boundary to standalone JSON and the entire GLB JSON
// chunk, including extras at every schema position. Opaque shader evidence is
// allowed; opaque does not mean exempt from private-path/credential screening.
const PRIVATE_KEYS=new Set(['password','passwd','secret','secrets','apikey','accesstoken','refreshtoken','cookie','authorization','sourceroot','privatepath','physicalroot','clientsecret','privatekey','credentials','awssecretaccesskey','awsaccesskeyid','secretaccesskey']);
function privacyText(value){
 let text=value.normalize('NFKC');
 // Decode valid UTF-8 escapes, with an octet fallback so unrelated malformed
 // escapes cannot hide ASCII paths. Repeated encoding is bounded, fail-closed.
 for(let i=0;i<8;i++){
  const decoded=text.replace(/(?:%[0-9a-f]{2})+/gi,encoded=>{
   try{return decodeURIComponent(encoded)}
   catch{return encoded.replace(/%([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)))}
  }).normalize('NFKC').replace(/[\t\r\n]/g,' ').replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g,'');
  if(decoded===text)return text.trim();
  text=decoded;
 }
 if(/%[0-9a-f]{2}/i.test(text))fail('private-metadata');
 return text.trim();
}

function privateKey(key){return PRIVATE_KEYS.has(privacyText(key).replace(/[\s_-]/g,'').toLowerCase())}
function checkJSONText(text){
 const value=JSON.parse(text);
 // JSON.parse discards overwritten members. Inspect every decoded string token
 // in the original valid document, including earlier duplicate keys/values,
 // before accepting the original bytes for immutable storage.
 for(const match of text.matchAll(/"(?:[^"\\]|\\.)*"/gs)){
  const token=JSON.parse(match[0]);
  if(/^\s*:/.test(text.slice(match.index+match[0].length))&&privateKey(token))fail('private-metadata');
  checkJSON(token);
 }
 return value;
}

function checkJSON(value){
 const pending=[value];
 while(pending.length){const item=pending.pop();if(typeof item==='string'){
  const text=privacyText(item);
  // Natural prose punctuation is a boundary; relative path constituents are
  // not. Handle // separately so the colon in an HTTPS URL stays legitimate.
  if(/(?:^|[^\p{L}\p{N}_./\\-])(?:file\s*:|[A-Za-z]:[\\/]|[\\]{2}|[\\/]?(?:~[\\/])|[\\/](?:home|workspace|tmp|Users|root|private|mnt|media|etc|var)(?:[\\/]|$))/iu.test(text)||/(?:^|[\s\"'(<>=\[\]{},;|!?])\/\//.test(text))fail('private-metadata');
 }else if(item&&typeof item==='object')for(const[k,v]of Object.entries(item)){
  if(privateKey(k))fail('private-metadata');
  pending.push(k,v);
 }}return value;
}

const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0}
async function validatePNG(bytes){if(bytes.length<57||bytes[0]!==137||String.fromCharCode(...bytes.slice(1,8))!=='PNG\r\n\x1a\n')fail('image');const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8,width,height,channels,idat=[],ended=false,chunks=0,idatEnded=false,palette=false;while(offset<bytes.length){if(offset+12>bytes.length||++chunks>1024)fail('image');const length=d.getUint32(offset),type=String.fromCharCode(...bytes.slice(offset+4,offset+8)),end=offset+12+length;if(end>bytes.length||crc(bytes.subarray(offset+4,offset+8+length))!==d.getUint32(offset+8+length))fail('image');if(!/^[A-Za-z]{4}$/.test(type)||!['IHDR','IDAT','IEND','PLTE','pHYs','sRGB','gAMA','cHRM'].includes(type))fail('image');if(type==='pHYs'&&length!==9||type==='sRGB'&&length!==1||type==='gAMA'&&length!==4||type==='cHRM'&&length!==32)fail('image');if(idat.length&&type!=='IDAT')idatEnded=true;if(type==='PLTE'){if(palette||idat.length||!length||length%3||length>768)fail('image');palette=true}if(chunks===1){if(type!=='IHDR'||length!==13)fail('image');width=d.getUint32(offset+8);height=d.getUint32(offset+12);channels={0:1,2:3,6:4}[bytes[offset+17]];if(!width||!height||width*height>16777216||bytes[offset+16]!==8||!channels||bytes[offset+18]||bytes[offset+19]||bytes[offset+20])fail('image')}else if(type==='IHDR')fail('image');if(type==='IDAT'){if(idatEnded||!length)fail('image');idat.push(bytes.subarray(offset+8,offset+8+length))}if(type==='IEND'){if(length||end!==bytes.length||!idat.length)fail('image');ended=true;break}offset=end}if(!ended)fail('image');try{const stream=new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate')),reader=stream.getReader(),expected=(width*channels+1)*height;let n=0;for(;;){const c=await reader.read();if(c.done)break;if(n+c.value.length>expected){await reader.cancel();fail('image')}for(let i=0;i<c.value.length;i++)if((n+i)%(width*channels+1)===0&&c.value[i]>4)fail('image');n+=c.value.length}if(n!==expected)fail('image')}catch{fail('image')}}

async function verifyStaticGLB(buffer,j){
 const list=(v,max)=>{if(!Array.isArray(v)||v.length>max)fail('model');return v},ref=(v,a)=>{if(!Number.isSafeInteger(v)||v<0||v>=a.length)fail('model');return a[v]},number=n=>typeof n==='number'&&Number.isFinite(n);
 const nodes=list(j.nodes,4096),meshes=list(j.meshes,2048),scenes=list(j.scenes,32),accessors=list(j.accessors,8192),views=list(j.bufferViews,8192),buffers=list(j.buffers,1);if(buffers.length!==1||buffers[0].uri||!Number.isSafeInteger(buffers[0].byteLength)||buffers[0].byteLength<1||j.skins?.length||j.animations?.length||(j.extensionsUsed||[]).some(x=>x!=='KHR_materials_unlit')||(j.extensionsRequired||[]).some(x=>x!=='KHR_materials_unlit'))fail('model');if(j.scene!==undefined)ref(j.scene,scenes);
 const dv=new DataView(buffer);let at=12,binary;while(at<buffer.byteLength){if(at+8>buffer.byteLength)fail('model');const length=dv.getUint32(at,true),kind=dv.getUint32(at+4,true);if(length%4||at+8+length>buffer.byteLength)fail('model');if(kind!==0x004e4942&&(kind!==0x4e4f534a||at!==12))fail('model');if(kind===0x004e4942){if(binary)fail('model');binary=new Uint8Array(buffer,at+8,length)}at+=8+length}if(!binary||buffers[0].byteLength>binary.length||binary.length-buffers[0].byteLength>3)fail('model');
 for(const v of views){if(v.buffer!==0||!Number.isSafeInteger(v.byteLength)||v.byteLength<1||!Number.isSafeInteger(v.byteOffset??0)||(v.byteOffset??0)<0||(v.byteOffset??0)+v.byteLength>buffers[0].byteLength||v.byteStride!==undefined&&(!Number.isSafeInteger(v.byteStride)||v.byteStride<4||v.byteStride>252||v.byteStride%4))fail('model')}
 const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};let allocated=0;for(const a of accessors){const v=ref(a.bufferView,views),n=components[a.type],size=sizes[a.componentType],off=a.byteOffset??0;if(!n||!size||!Number.isSafeInteger(a.count)||a.count<1||!Number.isSafeInteger(off)||off<0||off%size||a.sparse||off+(a.count-1)*(v.byteStride||n*size)+n*size>v.byteLength)fail('model');allocated+=a.count*n*size;if(allocated>16777216)fail('model');}
 const materials=j.materials||[],textures=j.textures||[],images=j.images||[],samplers=j.samplers||[];list(materials,2048);list(textures,2048);list(images,256);list(samplers,2048);
 for(const m of meshes){list(m.primitives,512);for(const p of m.primitives){if((p.mode??4)!==4||p.targets||!p.attributes||typeof p.attributes!=='object'||Array.isArray(p.attributes))fail('model');const pos=ref(p.attributes.POSITION,accessors);if(pos.type!=='VEC3'||pos.componentType!==5126)fail('model');for(const [key,index]of Object.entries(p.attributes)){if(!['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1','TANGENT','COLOR_0'].includes(key))fail('model');ref(index,accessors)}if(p.indices!==undefined){const a=ref(p.indices,accessors);if(a.type!=='SCALAR'||![5121,5123,5125].includes(a.componentType)||a.count%3)fail('model')}else if(pos.count%3)fail('model');if(p.material!==undefined)ref(p.material,materials)}}
 for(const n of nodes){if(n.mesh!==undefined)ref(n.mesh,meshes);if(n.skin!==undefined)fail('model');if(n.children!==undefined)for(const c of list(n.children,4096))ref(c,nodes);for(const[k,count]of Object.entries({matrix:16,translation:3,rotation:4,scale:3}))if(n[k]!==undefined&&(!Array.isArray(n[k])||n[k].length!==count||!n[k].every(number)))fail('model')}
 const visiting=new Set(),done=new Set();function visit(i,depth=0){ref(i,nodes);if(depth>64||visiting.has(i))fail('model');if(done.has(i))return;visiting.add(i);for(const c of nodes[i].children||[])visit(c,depth+1);visiting.delete(i);done.add(i)}for(let i=0;i<nodes.length;i++)visit(i);for(const s of scenes)for(const n of list(s.nodes||[],4096))ref(n,nodes);
 for(const t of textures){ref(t.source,images);if(t.sampler!==undefined)ref(t.sampler,samplers)}const pngs=[];for(const im of images){if(im.uri||im.mimeType!=='image/png')fail('model');const v=ref(im.bufferView,views),png=binary.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);await validatePNG(png);pngs.push(png)}
 // glTF textureInfo exists at these schema-defined positions, not in extras.
 // extras retains opaque source shader evidence (e.g. floats._UseTexture).
 // Spec: Khronos glTF 2.0 material and material.pbrMetallicRoughness schemas.
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
 const extensions=v=>{if(v?.extensions!==undefined&&(!object(v.extensions)||Object.keys(v.extensions).some(k=>k!=='KHR_materials_unlit')))fail('model')};
 const textureInfo=v=>{if(!object(v))fail('model');extensions(v);ref(v.index,textures);if(v.texCoord!==undefined&&(!Number.isSafeInteger(v.texCoord)||v.texCoord<0||v.texCoord>1))fail('model')};
 for(const m of materials){if(!object(m))fail('model');extensions(m);for(const k of ['normalTexture','occlusionTexture','emissiveTexture'])if(m[k]!==undefined)textureInfo(m[k]);if(m.pbrMetallicRoughness!==undefined){const p=m.pbrMetallicRoughness;if(!object(p))fail('model');extensions(p);for(const k of ['baseColorTexture','metallicRoughnessTexture'])if(p[k]!==undefined)textureInfo(p[k])}}
 // Actual unchanged CPU parser catches remaining supported-profile errors. The
 // image plugin uses already CRC/inflate-validated PNG dimensions, no GPU/DOM.
 const loader=new GLTFLoader();loader.register(()=>({name:'ENTITY_INGEST_VALIDATED_PNG',loadTexture(index){const t=ref(index,textures),png=pngs[t.source],view=new DataView(png.buffer,png.byteOffset,png.byteLength),texture=new Texture();texture.image={width:view.getUint32(16),height:view.getUint32(20)};texture.flipY=false;return Promise.resolve(texture)}}));const g=await loader.parseAsync(buffer,'');try{let count=0;g.scene.traverse(o=>{if(!o.isMesh)return;count++;for(const a of Object.values(o.geometry.attributes))for(const n of a.array)if(!Number.isFinite(n))fail('model');const n=o.geometry.attributes.position?.count;if(o.geometry.index)for(const i of o.geometry.index.array)if(i>=n)fail('model')});if(!count)fail('model')}finally{retireModel(g)}
}
