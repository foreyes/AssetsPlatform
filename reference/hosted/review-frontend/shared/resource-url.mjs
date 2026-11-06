// One project-scoped logical resource resolver. Data/model URLs are never
// external fetch proxies; source/Drive download links are a separate capability.
import {supplementalPin,supplementalRoot} from './entity-supplemental-pins.mjs';
const ORIGIN_FALLBACK='http://localhost';
const abort=()=>new DOMException('Project resource request cancelled','AbortError');
// Compare decoded URL paths, matching the static servers' encoded aliases.
const canonicalPath=value=>decodeURIComponent(value).replace(/\/+/g,'/');
const beneath=(path,prefix,directory)=>path.startsWith(prefix)||path===directory;
function rootPath(url){
 const prefix=canonicalPath(url.pathname),foldedPrefix=prefix.toLowerCase();
 return {prefix,directory:prefix.slice(0,-1),foldedPrefix,foldedDirectory:foldedPrefix.slice(0,-1)};
}
function safeReference(value){
 if(typeof value!=='string'||!value||/[\\\0-\x20\x7f]/.test(value)||value.startsWith('//'))throw Error('Unsafe resource reference');
 const beforeFragment=value.split('#',1)[0],path=beforeFragment.replace(/^https?:\/\/[^/]+/i,'').split('?',1)[0];
 let decoded=path;for(let n=0;n<3;n++){if(/%2f|%5c/i.test(decoded))throw Error('Encoded resource separators are not permitted');let next;try{next=decodeURIComponent(decoded)}catch{throw Error('Invalid resource path encoding')}if(next===decoded)break;decoded=next;}
 if(/[\\\0-\x1f\x7f]/.test(decoded)||decoded.split('/').includes('..')||/%(?:2e|2f|5c|25)/i.test(decoded))throw Error('Resource path traversal is not permitted');
 if(/%2f|%5c/i.test(path))throw Error('Encoded resource separators are not permitted');
}
function directory(value,base){safeReference(value);const u=new URL(value,base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||!u.pathname.endsWith('/'))throw Error('Registered resource directory required');return u;}
export function validateResourceReference(value){safeReference(value);return value}
export function resolveResourceRoot(value,base){return directory(value,base).href}
export function createResourceResolver({projectId='legacy',datasetId='verified',assetRoot,origin,resourceMounts,externalOrigins=[],registeredProjectRoots=[],nativeModuleBase,dataKind='indexed'}={}){
 const fallback=origin||globalThis.location?.origin||ORIGIN_FALLBACK,root=directory(assetRoot||'./',fallback+'/'),site=root.origin;if(origin&&new URL(origin).origin!==site)throw Error('Project assetRoot must remain on the registered site');
 const external=new Set(externalOrigins.map(value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Exact HTTPS external origin required');return u.origin}));
 const ownRoot=rootPath(root);
 const otherRoots=registeredProjectRoots.map(value=>directory(value,root)).filter(u=>u.origin===site&&u.href!==root.href).map(rootPath);
 const roots=[ownRoot,...otherRoots].sort((a,b)=>b.prefix.length-a.prefix.length);
 const hasOtherRoot=otherRoots.some(other=>other.prefix!==ownRoot.prefix);
 // Case folding can deny an alias on Windows, but must never grant a path
 // outside the exact root on case-sensitive hosts. Ambiguous roots fail closed.
 function checkedOwner(pathname){
  // Apply to both declarations and resolved mounts; neither may grant an alias.
  if(hasOtherRoot&&pathname.split('/').some(part=>part.includes(':')||/[. ]$/.test(part)||/~[0-9]+(?:\.|$)/i.test(part)))throw Error('Ambiguous filesystem resource alias denied');
  const folded=pathname.toLowerCase();
  let exact,hasCaseAlias=false;
  for(const candidate of roots){
   if(exact&&candidate.prefix.length<exact.prefix.length)break;
   if(beneath(pathname,candidate.prefix,candidate.directory))exact??=candidate;
   else if(beneath(folded,candidate.foldedPrefix,candidate.foldedDirectory))hasCaseAlias=true;
  }
  if(hasCaseAlias)throw Error('Cross-project case alias denied');
  return exact;
 }
 const specs=resourceMounts||[{logicalPrefix:dataKind==='entity'?'/entity/':'/assets/',target:dataKind==='entity'?'./':'assets/'}];
 const mounts=specs.map(spec=>{
  if(!spec||typeof spec.logicalPrefix!=='string'||!/^\/(?:[A-Za-z0-9._-]+\/)+$/.test(spec.logicalPrefix)||spec.logicalPrefix.split('/').includes('..'))throw Error('Registered logical resource prefix required');
  const prefix=spec.logicalPrefix,target=directory(spec.target||'./',root);
  if(target.origin!==site||!beneath(canonicalPath(target.pathname),ownRoot.prefix,ownRoot.directory))throw Error('Resource mount escapes project root');
  return {prefix,target,segments:prefix.split('/').length-1};
 }).sort((a,b)=>b.prefix.length-a.prefix.length);
 const native=new Set(),supplemental=new Map(),nativeModule=dataKind==='entity'&&nativeModuleBase?directory(nativeModuleBase,root):null;
 if(nativeModule&&nativeModule.origin!==site)throw Error('Native module base must remain on registered site');
 function externalLink(value){safeReference(value);const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||!external.has(url.origin))throw Error('External source/download origin is not registered');return value;}
 function resolve(value,{kind='asset'}={}){
  if(value==null||value==='')return value;safeReference(value);
  if(!['asset','dependency','evidence','download','external-source','module','native'].includes(kind))throw Error('Unknown resource reference kind');
  if(kind==='external-source')return externalLink(value);
  if(/^[a-z][a-z0-9+.-]*:/i.test(value)&&!/^https?:/i.test(value))throw Error('Unknown resource protocol');
  const raw=new URL(value,root);if(raw.username||raw.password||raw.search&&kind!=='download')throw Error('Resource credentials/query are not permitted');
  if(raw.origin!==site){if(kind==='download')return externalLink(value);throw Error('External asset fetch is not permitted');}
  if(raw.search)throw Error('Local resource query is not permitted');
  if(kind==='native'){if(!native.has(raw.pathname)||raw.hash)throw Error('Unregistered native resource declaration');return raw.href;}
  if(kind==='module'&&nativeModule&&raw.pathname.startsWith(nativeModule.pathname)){if(raw.hash||!(/\.(?:mjs|js)$/.test(raw.pathname)))throw Error('Registered native JavaScript module required');return raw.href;}
  const rawPath=canonicalPath(raw.pathname),sourceOwner=checkedOwner(rawPath);
  // Ancestor-owned logical aliases may be mounted into a child; sibling and
  // descendant physical roots must be rejected before applying any mount.
  if(sourceOwner&&sourceOwner.prefix!==ownRoot.prefix&&!beneath(ownRoot.prefix,sourceOwner.prefix,sourceOwner.directory))throw Error('Cross-project source path denied');
  // Already-resolved URLs within this project are idempotent. Logical absolute
  // prefixes are mapped only when they are outside its physical public root.
  if(beneath(rawPath,ownRoot.prefix,ownRoot.directory)){
   if(sourceOwner?.prefix!==ownRoot.prefix)throw Error('Cross-project resource access denied');
   return raw.href;
  }
  const mapping=mounts.find(m=>rawPath.startsWith(m.prefix));
  if(!mapping)throw Error('Resource escapes the registered project root');
  const suffix=raw.pathname.replace(/\/+/g,'/').split('/').slice(mapping.segments).join('/');
  const target=new URL(suffix+raw.hash,mapping.target),targetPath=canonicalPath(target.pathname),targetOwner=checkedOwner(targetPath);
  if(target.origin!==site||targetOwner?.prefix!==ownRoot.prefix)throw Error('Cross-project resource access denied');
  return target.href;
 }
 function link(value){if(value==null||value==='')return value;const u=new URL(value,root);return resolve(value,{kind:u.origin===site?'evidence':'download'});}
 function registerNativeAsset(asset){
  if(dataKind!=='entity'||!asset?.nativeReadOnlyBatch||asset.delivery?.kind!=='same-origin-static')throw Error('Native declarations belong only to this registered Entity adapter');
  const pending=[],d=asset.delivery,items=[{url:d.url,sha256:d.sha256,bytes:d.bytes},...(d.resources||[])];let base;
  for(const item of items){const m=typeof item.url==='string'&&/^\/__entity_assets\/(batch-[a-f0-9]{64})\/(?:models\/([a-f0-9]{64})\.gltf|resources\/([a-f0-9]{64})\.bin)$/.exec(item.url);if(!m||!Number.isSafeInteger(item.bytes)||item.bytes<1||(m[2]||m[3])!==item.sha256)throw Error('Invalid immutable native resource declaration');if(base&&base!==m[1])throw Error('Cross-batch native dependency');base=m[1];pending.push(item.url)}
  if(asset.preview_uri!==d.url)throw Error('Native preview/delivery mismatch');
  const b=d.bundle;if(b){if(b.schema!=='entity-exact-model-bundle/v1'||b.url!=='/__entity_bundles/'+b.sha256+'.ebundle'||!(/^[a-f0-9]{64}$/).test(b.sha256)||!Number.isSafeInteger(b.bytes)||b.bytes<8)throw Error('Invalid immutable bundle declaration');pending.push(b.url)}for(const url of pending)native.add(url);
 }
 function supplementalPair(asset,base){
  const proof=asset?.supplementalEntityLink,pin=proof&&supplementalPin(proof.entityId);
  if(dataKind!=='entity'||!pin||proof.project!==pin.sourceProject||proof.dataset!==pin.dataset||proof.version!==pin.version||proof.revision!==pin.revision||proof.resourceId!==pin.resourceId)throw Error('Unregistered supplemental identity');
  if(asset.resource_id!==pin.legacyResourceId||asset.format!=='glb'||asset.status!=='ready'||asset.coverage!=='static-assembly'||asset.preview_uri!==pin.modelPath||asset.bytes!==pin.modelBytes||asset.sha256!==pin.modelSHA256||asset.preview_sha256!==pin.modelSHA256||asset.delivery||asset.transport||asset.nativeReadOnlyBatch||asset.entity_ids?.length!==1||asset.entity_ids[0]!==pin.entityId)throw Error('Supplemental asset declaration mismatch');
  const target=directory(base,root),expected=new URL(supplementalRoot(pin),site);
  if(target.href!==expected.href||target.origin!==site)throw Error('Supplemental asset/base pair mismatch');
  return {pin,target,key:pin.entityId+':'+pin.version+':'+pin.modelSHA256+':'+target.href};
 }
 function registerSupplementalAsset(asset,base){const pair=supplementalPair(asset,base);supplemental.set(pair.key,true);return pair.target.href;}
 function resolveSupplementalBase(asset,base){const pair=supplementalPair(asset,base);if(!supplemental.has(pair.key))throw Error('Supplemental asset capability not registered');return pair.target.href;}
 function resolveSupplementalModel(asset,base){return new URL(asset.preview_uri,resolveSupplementalBase(asset,base)).href;}
 return Object.freeze({namespace:projectId+':'+datasetId,assetRoot:root.href,origin:site,resolve,link,external:externalLink,registerNativeAsset,nativePaths:()=>[...native],registerSupplementalAsset,resolveSupplementalBase,resolveSupplementalModel});
}
const resolvers=new WeakMap();
export function getResourceResolver(config){if(config.resourceResolver)return config.resourceResolver;let value=resolvers.get(config);if(!value){value=createResourceResolver(config);resolvers.set(config,value)}return value;}
const sourceKeys=new Set(['sourceUrl','sourceURL','sourceUri','sourceURI','licenseUrl','documentationUrl','archiveUrl']);
export function mapResourceData(value,resolver,path=''){
 if(Array.isArray(value))return value.map(item=>mapResourceData(item,resolver,path));
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([key,item])=>{
  const context=path+'.'+key;
  if(typeof item==='string'&&sourceKeys.has(key)){return[key,resolver.link(item)];}
  if(typeof item==='string'&&(key==='url'||/(?:Url|URL|Uri|URI)$/.test(key))){const link=(key==='url'&&/(?:^|\.)(?:sources|downloads|sourceLinks)(?:\.|$)/.test(path))||/downloadUrl/i.test(key);return[key,link?resolver.link(item):resolver.resolve(item)];}
  if(key==='assetShards'&&Array.isArray(item))return[key,item.map(url=>resolver.resolve(url))];
  return[key,item&&typeof item==='object'?mapResourceData(item,resolver,context):item];
 }));
}
export function createProjectScope(resolver){
 let controller=new AbortController(),generation=0,disposed=false;
 async function run(task,{signal}={}){if(disposed||controller.signal.aborted||signal?.aborted)throw abort();const epoch=generation,local=new AbortController(),stop=()=>local.abort();const parent=controller.signal;parent.addEventListener('abort',stop,{once:true});signal?.addEventListener('abort',stop,{once:true});try{const value=await task(local.signal);if(disposed||epoch!==generation||local.signal.aborted)throw abort();return value}finally{parent.removeEventListener('abort',stop);signal?.removeEventListener('abort',stop)}}
 function invalidate(){controller.abort();generation++;if(!disposed)controller=new AbortController()}
 return Object.freeze({namespace:resolver.namespace,run,invalidate,dispose(){disposed=true;invalidate()},get active(){return !disposed}});
}
