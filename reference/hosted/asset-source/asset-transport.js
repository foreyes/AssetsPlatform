// Lossless transport only. Decoded bytes retain the original GLB content hash.
import {safeModelUrl,resolveAssetDelivery} from './asset-delivery.js';
export const MAX_MODEL_BYTES=256*1024*1024;
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const positive=n=>Number.isSafeInteger(n)&&n>0;
function cancelled(signal){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');}
async function bounded(stream,limit,signal){
 const reader=stream.getReader(),chunks=[];let size=0;
 try{while(true){cancelled(signal);const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('模型超过声明的字节预算');chunks.push(value);}}
 catch(error){try{await reader.cancel();}catch{}throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes.buffer;
}
export async function loadAssetBytes(asset,{signal,fetcher=globalThis.fetch}={}){
 if(asset?.format==='gltf')throw Error('Closed glTF requires its dependency transport, not a single-file download');
 const resolved=resolveAssetDelivery(asset);if(resolved.status!=='available')throw Error('资源供应尚未配置：'+resolved.reason);asset=resolved.asset;
 const uri=safeModelUrl(asset.preview_uri),expected=(asset.preview_sha256||asset.sha256||'').toLowerCase();
 if(!uri||!/^[a-f0-9]{64}$/.test(expected))throw Error('模型 URL 或内容 SHA 无效');
 const t=asset.transport;let target=uri,limit=asset.bytes||MAX_MODEL_BYTES;
 if(!positive(limit)||limit>MAX_MODEL_BYTES)throw Error('模型超过浏览器单次加载预算');
 if(t){
  if(t.schemaVersion!=='asset-review.byte-transport/v1'||t.encoding!=='gzip'||t.uri!==uri+'.gz.bin'||!positive(t.bytes)||t.bytes>24*1024*1024||!positive(t.decodedBytes)||t.decodedBytes>MAX_MODEL_BYTES||t.decodedSHA256!==expected||!/^[a-f0-9]{64}$/.test(t.sha256)||(asset.bytes&&asset.bytes!==t.decodedBytes))throw Error('压缩传输声明无效');
  target=t.uri;limit=t.bytes;
 }
 cancelled(signal);const response=await fetcher(target,{signal});if(!response.ok||!response.body)throw Error('模型文件加载失败');
 let bytes=await bounded(response.body,limit,signal);cancelled(signal);
 if(t){
  if(bytes.byteLength!==t.bytes||await hash(bytes)!==t.sha256)throw Error('压缩传输字节与 SHA 不一致');
  if(typeof DecompressionStream==='undefined')throw Error('浏览器不支持此模型的无损压缩解码');
  bytes=await bounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),t.decodedBytes,signal);
  if(bytes.byteLength!==t.decodedBytes)throw Error('解压后的模型长度不一致');
 }
 if(asset.bytes&&bytes.byteLength!==asset.bytes)throw Error('模型字节数与清单不一致');
 const actualSHA=await hash(bytes);if(actualSHA!==expected)throw Error('模型内容与清单 SHA-256 不一致');cancelled(signal);
 return {bytes,sha256:actualSHA};
}
