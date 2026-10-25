// Optional exact-byte delivery projection. Original documents, resources and URLs
// remain authoritative. No executable archive, extraction paths, or external URLs.
import {createVerifiedResourceCache} from './verified-resource-cache.js';
import {resolveClosedGLTFDeclaration,loadClosedGLTFBytes} from './shared-resource-transport.js';
export const MODEL_BUNDLE_LIMITS=Object.freeze({bytes:1024*1024,headerBytes:256*1024,entries:1024,concurrency:3,timeoutMs:15000,failedEntries:64});
const PATH=/^\/__entity_bundles\/([a-f0-9]{64})\.ebundle$/;
const abort=()=>new DOMException('Model bundle cancelled','AbortError');
const check=signal=>{if(signal?.aborted)throw abort();};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
export function resolveModelBundle(asset){
 const b=asset?.delivery?.bundle;if(b==null)return null;const match=typeof b.url==='string'&&PATH.exec(b.url);
 if(b.schema!=='entity-exact-model-bundle/v1'||!match||match[0]!==b.url||match[1]!==b.sha256||!Number.isSafeInteger(b.bytes)||b.bytes<8||b.bytes>MODEL_BUNDLE_LIMITS.bytes)throw Error('Invalid immutable model bundle declaration');
 return {url:b.url,sha256:b.sha256,bytes:b.bytes};
}
export async function decodeModelBundle(input,asset){
 const descriptor=resolveModelBundle(asset),declaration=resolveClosedGLTFDeclaration(asset);if(!descriptor||input.byteLength!==descriptor.bytes||await digest(input)!==descriptor.sha256)throw Error('Model bundle length or SHA-256 mismatch');
 const bytes=new Uint8Array(input),view=new DataView(input);if(view.getUint32(0,true)!==0x31424d45)throw Error('Invalid model bundle signature');const length=view.getUint32(4,true);
 if(!length||length>MODEL_BUNDLE_LIMITS.headerBytes||8+length>bytes.length)throw Error('Invalid model bundle index length');
 const index=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(8,8+length))),expected=new Map([declaration.root,...declaration.resources.values()].map(r=>[r.url,r]));
 if(!Array.isArray(index)||index.length!==expected.size||index.length>MODEL_BUNDLE_LIMITS.entries)throw Error('Model bundle closure mismatch');
 const result=new Map();let offset=8+length;
 for(const item of index){const original=item&&expected.get(item.url);if(!original||result.has(item.url)||item.sha256!==original.sha256||item.bytes!==original.bytes||!Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>bytes.length-offset)throw Error('Invalid, duplicate or undeclared model bundle entry');
  const part=input.slice(offset,offset+item.bytes);if(await digest(part)!==original.sha256)throw Error('Model bundle constituent SHA-256 mismatch');result.set(item.url,part);offset+=item.bytes;
 }
 if(offset!==bytes.length)throw Error('Trailing model bundle bytes');return result;
}
export function createModelBundleTransport({fetcher=globalThis.fetch,timeoutMs=MODEL_BUNDLE_LIMITS.timeoutMs,concurrency=MODEL_BUNDLE_LIMITS.concurrency}={}){
 if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>3||!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw Error('Invalid model bundle transport limits');
 const overlays=new Map(),tasks=new Map(),waiting=[],completed=new Map(),failed=new Map();let active=0,disposed=false,lastEvictions=0;
 const counters={bundles:0,bundleHits:0,fallbacks:0,failed:0,aborted:0,timedOut:0};
 // One SHA-deduplicating, 64 MiB constituent cache shared by cards and detail.
 // Raw incoming bundle buffers are at most 3 x 1 MiB. Decode owns up to
 // another 3 x 1 MiB of constituent copies before cache handoff. Neither is a second LRU.
 const cache=createVerifiedResourceCache({fetcher:(url,options)=>{const o=overlays.get(url);return o?Promise.resolve(new Response(o.bytes.slice(0))):fetcher(url,options);}});
 const descriptors=asset=>{const d=resolveClosedGLTFDeclaration(asset);return[d.root,...d.resources.values()];};
 const cap=(map,max)=>{while(map.size>max)map.delete(map.keys().next().value);};
 function detach(s){s.signal?.removeEventListener('abort',s.cancel);}
 function stop(task,error){if(task.stopped||task.finished)return;task.stopped=true;task.error=error;clearTimeout(task.timer);if(!task.active){const i=waiting.indexOf(task);if(i!==-1)waiting.splice(i,1);}if(tasks.get(task.key)===task)tasks.delete(task.key);for(const s of task.subscribers){detach(s);s.reject(error);}task.subscribers.clear();task.controller.abort();if(task.reader&&!task.cancellation)try{task.cancellation=Promise.resolve(task.reader.cancel(error)).catch(()=>{});}catch{task.cancellation=Promise.resolve();}}
 async function run(task){let readDone=false,parts,owned=[];try{
  counters.bundles++;const response=await fetcher(task.bundle.url,{method:'GET',credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'default',signal:task.controller.signal});
  if(response?.body?.getReader)task.reader=response.body.getReader();check(task.controller.signal);
  if(!response?.ok||response.status!==200||response.redirected||['opaque','opaqueredirect'].includes(response.type)||!task.reader)throw Error('Model bundle HTTP response invalid');
  if(response.url){const u=new URL(response.url);if(u.pathname!==task.bundle.url||u.search||u.hash||u.username||u.password||!['http:','https:'].includes(u.protocol)||(globalThis.location?.origin&&u.origin!==globalThis.location.origin))throw Error('Model bundle response URL changed');}
  const output=new Uint8Array(task.bundle.bytes);let offset=0;for(;;){check(task.controller.signal);const {value,done}=await task.reader.read();check(task.controller.signal);if(done){readDone=true;break;}if(!(value instanceof Uint8Array)||value.byteLength>output.length-offset)throw Error('Model bundle exceeds declared byte budget');output.set(value,offset);offset+=value.byteLength;}if(offset!==output.length)throw Error('Model bundle is truncated');
  parts=await decodeModelBundle(output.buffer,task.asset);check(task.controller.signal);
  for(const[url,bytes]of parts){let overlay=overlays.get(url);if(!overlay){overlay={bytes,owners:0};overlays.set(url,overlay);}overlay.owners++;owned.push([url,overlay]);}
  // Cache validates every constituent again. It exposes only owned copies.
  await Promise.all(descriptors(task.asset).map(r=>cache.get(r,{signal:task.controller.signal})));check(task.controller.signal);
  if(cache.stats.evictions!==lastEvictions)completed.clear();completed.set(task.key,true);cap(completed,64);lastEvictions=cache.stats.evictions;task.finished=true;clearTimeout(task.timer);for(const s of task.subscribers){detach(s);s.resolve();}task.subscribers.clear();
 }catch(error){if(!task.stopped){counters.failed++;stop(task,error);}}finally{
  if(task.reader&&!readDone&&!task.cancellation)try{task.cancellation=Promise.resolve(task.reader.cancel()).catch(()=>{});}catch{}
  if(task.cancellation)await task.cancellation;try{task.reader?.releaseLock();}catch{}
  for(const[url,overlay]of owned)if(--overlay.owners===0&&overlays.get(url)===overlay)overlays.delete(url);parts?.clear();
  if(tasks.get(task.key)===task)tasks.delete(task.key);active--;drain();
 }}
 function drain(){while(!disposed&&active<concurrency&&waiting.length){const task=waiting.shift();if(task.stopped)continue;task.active=true;active++;void run(task);}}
 function ensure(asset,{signal}={}){
  try{check(signal);if(disposed)throw Error('Model bundle transport disposed');const bundle=resolveModelBundle(asset);if(!bundle)return Promise.resolve();const key=bundle.sha256;
   if(cache.stats.evictions!==lastEvictions){completed.clear();lastEvictions=cache.stats.evictions;}
   if(completed.has(key)){counters.bundleHits++;return Promise.resolve();}
   const failure=failed.get(key);if(failure&&failure>Date.now())return Promise.resolve();if(failure)failed.delete(key);
   let task=tasks.get(key),fresh=!task;if(!task){task={key,bundle,asset:structuredClone(asset),controller:new AbortController(),subscribers:new Set(),stopped:false,finished:false,reader:null,cancellation:null};tasks.set(key,task);}
   const promise=new Promise((resolve,reject)=>{const s={signal,resolve,reject,cancel:null};s.cancel=()=>{task.subscribers.delete(s);detach(s);reject(abort());if(!task.subscribers.size){counters.aborted++;stop(task,abort());}};task.subscribers.add(s);signal?.addEventListener('abort',s.cancel,{once:true});if(signal?.aborted)s.cancel();});
   if(fresh&&!task.stopped){task.timer=setTimeout(()=>{counters.timedOut++;const e=Error('Model bundle request timed out');e.name='TimeoutError';stop(task,e);},timeoutMs);waiting.push(task);drain();}
   return promise.catch(error=>{check(signal);if(error.name==='AbortError'||disposed)throw error;failed.set(key,Date.now()+60000);cap(failed,MODEL_BUNDLE_LIMITS.failedEntries);counters.fallbacks++;});
  }catch(error){return Promise.reject(error);}
 }
 return {cache,ensure,clear(){for(const task of tasks.values())stop(task,abort());waiting.length=0;completed.clear();failed.clear();cache.clear();},dispose(){disposed=true;this.clear();cache.dispose();},get stats(){return {...counters,active,queued:waiting.filter(t=>!t.stopped).length,pending:tasks.size,stagingEntries:overlays.size,completed:completed.size,cache:cache.stats};}};
}
let shared;
export const sharedModelBundleTransport=()=>shared??=createModelBundleTransport();
export async function loadBundledClosedGLTFBytes(asset,{signal,fetcher,cache}={}){
 // Injected QA/custom transports retain their original ownership and semantics.
 if(fetcher||cache)return loadClosedGLTFBytes(asset,{signal,fetcher,cache});
 const transport=sharedModelBundleTransport();await transport.ensure(asset,{signal});check(signal);return loadClosedGLTFBytes(asset,{signal,cache:transport.cache});
}
