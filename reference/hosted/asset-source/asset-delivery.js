import {safeAssetUrl} from './model.js';
import {CLOSED_GLTF_REPRESENTATION,resolveClosedGLTFDeclaration,closedGLTFURL} from './shared-resource-transport.js';
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
// External delivery is opt-in manifest data, not a network fallback or a credential.
export function resolveAssetDelivery(asset){
 const d=asset?.delivery;
 if(d?.status==='unavailable')return {status:'unavailable',reason:d.reason||'delivery-not-configured'};
 if(d?.representation===CLOSED_GLTF_REPRESENTATION){resolveClosedGLTFDeclaration(asset);return {status:'available',kind:d.kind,asset:{...asset,preview_uri:d.url}};}
 if(asset?.format==='gltf')throw Error('glTF requires an explicit dependency-closed delivery declaration');
 if(!d)return safeAssetUrl(asset?.preview_uri)?{status:'available',kind:'bundled',asset}:{status:'unavailable',reason:'representation-missing'};
 if(d.status!=='available'||d.kind!=='same-origin-api')throw Error('Invalid asset delivery declaration');
 const expected=asset.preview_sha256||asset.sha256;
 if(!digest(expected)||d.sha256!==expected||d.bytes!==asset.bytes||!/^\/api\/assets\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/[a-f0-9]{64}\.glb$/.test(d.url)||!d.url.endsWith('/'+expected+'.glb')||d.url.includes('..'))throw Error('Asset API URL/hash/length does not match its manifest');
 return {status:'available',kind:'same-origin-api',asset:{...asset,preview_uri:d.url,transport:d.transport||null}};
}
export function safeModelUrl(value){return safeAssetUrl(value)||closedGLTFURL(value)||((typeof value==='string'&&!value.includes('..')&&/^\/api\/assets\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/[a-f0-9]{64}\.glb$/.test(value))?value:null);}
