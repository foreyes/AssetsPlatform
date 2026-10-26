// One project-scoped logical resource resolver. Data/model URLs are never
// external fetch proxies; source/Drive download links are a separate capability.

const ORIGIN_FALLBACK='http://localhost';
const abort=()=>new DOMException('Project resource request cancelled','AbortError');
const beneath=(path,root)=>root==='/'?path.startsWith('/'):path.startsWith(root);
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
export function createResourceResolver({projectId='legacy',datasetId='verified',assetRoot,origin,resourceMounts,externalOrigins=[],registeredProjectRoots=[]}={}){
 const fallback=origin||globalThis.location?.origin||ORIGIN_FALLBACK,root=directory(assetRoot||'./',fallback+'/'),site=root.origin;if(origin&&new URL(origin).origin!==site)throw Error('Project assetRoot must remain on the registered site');
 const external=new Set(externalOrigins.map(value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Exact HTTPS external origin required');return u.origin}));
 const otherRoots=registeredProjectRoots.map(value=>directory(value,root)).filter(u=>u.origin===site&&u.href!==root.href);
 const specs=resourceMounts||[{logicalPrefix:'/assets/',target:'assets/'}];
 const mounts=specs.map(spec=>{if(!spec||typeof spec.logicalPrefix!=='string'||!/^\/(?:[A-Za-z0-9._-]+\/)+$/.test(spec.logicalPrefix)||spec.logicalPrefix.split('/').includes('..'))throw Error('Registered logical resource prefix required');const target=directory(spec.target||'./',root);if(target.origin!==site||!beneath(target.pathname,root.pathname))throw Error('Resource mount escapes project root');return {prefix:spec.logicalPrefix,target}}).sort((a,b)=>b.prefix.length-a.prefix.length);
 function externalLink(value){safeReference(value);const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||!external.has(url.origin))throw Error('External source/download origin is not registered');return value;}
 function resolve(value,{kind='asset'}={}){
  if(value==null||value==='')return value;safeReference(value);
  if(!['asset','dependency','evidence','download','external-source'].includes(kind))throw Error('Unknown resource reference kind');
  if(kind==='external-source')return externalLink(value);
  if(/^[a-z][a-z0-9+.-]*:/i.test(value)&&!/^https?:/i.test(value))throw Error('Unknown resource protocol');
  const raw=new URL(value,root);if(raw.username||raw.password||raw.search&&kind!=='download')throw Error('Resource credentials/query are not permitted');
  if(raw.origin!==site){if(kind==='download')return externalLink(value);throw Error('External asset fetch is not permitted');}
  if(raw.search)throw Error('Local resource query is not permitted');
  if(otherRoots.some(u=>beneath(raw.pathname,u.pathname)&&!beneath(raw.pathname,root.pathname)))throw Error('Cross-project source path denied');
  let target=raw;
  // Already-resolved URLs within this project are idempotent. Logical absolute
  // prefixes are mapped only when they are outside its physical public root.
  if(!beneath(raw.pathname,root.pathname)){
   const mapping=mounts.find(m=>raw.pathname.startsWith(m.prefix));if(!mapping)throw Error('Resource escapes the registered project root');
   target=new URL(raw.pathname.slice(mapping.prefix.length)+raw.hash,mapping.target);
  }
  if(target.origin!==site||!beneath(target.pathname,root.pathname)||otherRoots.some(u=>beneath(target.pathname,u.pathname)&&u.pathname!==root.pathname))throw Error('Cross-project resource access denied');
  return target.href;
 }
 function link(value){if(value==null||value==='')return value;const u=new URL(value,root);return resolve(value,{kind:u.origin===site?'evidence':'download'});}
 return Object.freeze({namespace:projectId+':'+datasetId,assetRoot:root.href,origin:site,resolve,link,external:externalLink});
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
