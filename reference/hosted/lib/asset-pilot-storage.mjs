// The fixed, already-exported pilot only. No caller-selected keys or bodies.
// Reuses legacy pilot conditional-put/readback/last-D1-commit semantics without
// re-enabling its browser import route or changing its hash-bound source.
export const PINNED_SAMPLE=Object.freeze({sample:'searchable-chest',version:'r2probe-dd086eb3c9cc74694663648bb69378080e41466c0d4b358e57c4a0db4063e7d4',manifestSHA256:'f779aac98d9312a26477d29ca301e55e4e589cc15b4304bb808a01f36ef55cfb',payloadBytes:4990,payloadFileCount:6,objectCount:7,totalBytes:11639});
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const error=message=>{throw Error(message)};
export function createFixedPilotStorage({release}){
 const {version,manifest,files}=release,manifestFile=files?.at(-1);let validated;
 async function validate(){validated??=(async()=>{if(version!==PINNED_SAMPLE.version||manifestFile?.sha256!==PINNED_SAMPLE.manifestSHA256||files.length!==7||manifestFile.uri!=='manifest.json'||manifest.fileCount!==6||manifest.payloadBytes!==4990||manifest.asset.resource_id!=='entity_example_c0091cda3860')error('not-pinned-release');const seen=new Set(),source=new Map();for(const file of files){if(seen.has(file.uri)||!(/^(?:manifest\.json|models\/[a-f0-9]{64}\.gltf|resources\/[a-f0-9]{64}\.bin)$/).test(file.uri)||!Number.isSafeInteger(file.bytes)||file.bytes<1)error('invalid-pinned-source');seen.add(file.uri);const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));if(bytes.byteLength!==file.bytes||await hash(bytes)!==file.sha256)error('invalid-pinned-source');source.set(file.uri,bytes)}if(files.reduce((n,f)=>n+f.bytes,0)!==11639)error('invalid-pinned-source');const decoded=JSON.parse(new TextDecoder().decode(source.get('manifest.json')));if(JSON.stringify(decoded)!==JSON.stringify(manifest))error('invalid-pinned-manifest');for(const item of manifest.files){const f=files.find(f=>f.uri===item.uri);if(!f||f.sha256!==item.sha256||f.bytes!==item.bytes)error('invalid-pinned-manifest')}return source})();return validated}
 const key=file=>`entity/${version}/${file.uri}`;
 function bindings(env){if(!env?.DB||!env?.BUCKET)error('storage-not-configured')}
 async function row(env){const found=await env.DB.prepare('SELECT manifest_sha256, file_count, payload_bytes FROM entity_asset_versions WHERE version = ?').bind(version).first();if(found&&(found.manifest_sha256!==manifestFile.sha256||found.file_count!==6||found.payload_bytes!==4990))error('catalog-conflict');return found}
 async function checked(env,file,object){object??=await env.BUCKET.get(key(file));if(!object)error('missing-object');const bytes=await object.arrayBuffer();const sha256=await hash(bytes);if(bytes.byteLength!==file.bytes||sha256!==file.sha256)error('integrity-conflict');return{uri:file.uri,bytes:bytes.byteLength,sha256,verified:true}}
 async function auditObjects(env){const objects=[];for(const file of files)objects.push(await checked(env,file));return objects}
 async function status(env){await validate();bindings(env);const found=await row(env);if(!found)return{...PINNED_SAMPLE,state:'not-imported',ready:false};const objects=await auditObjects(env);return{...PINNED_SAMPLE,state:'ready',ready:true,objects}}
 async function importFixed(env){const source=await validate();bindings(env);const prior=await row(env);if(prior)return{...await status(env),alreadyReady:true};let puts=0;for(const file of files){const existing=await env.BUCKET.get(key(file));if(existing){await checked(env,file,existing);continue}await env.BUCKET.put(key(file),source.get(file.uri),{onlyIf:new Headers({'If-None-Match':'*'}),sha256:file.sha256,httpMetadata:{contentType:file.mime}});puts++;await checked(env,file)}
  // Full readback again before the one catalog INSERT. No DELETE/UPDATE/overwrite.
  await auditObjects(env);await row(env);
  try{await env.DB.prepare('INSERT INTO entity_asset_versions (version, manifest_sha256, file_count, payload_bytes) VALUES (?, ?, ?, ?) ON CONFLICT(version) DO NOTHING').bind(version,manifestFile.sha256,6,4990).run()}catch{const recovered=await row(env);if(!recovered)error('catalog-commit-unconfirmed')}
  if(!await row(env))error('catalog-commit-unconfirmed');return{...await status(env),alreadyReady:false,putAttempts:puts};
 }
 return Object.freeze({status,importFixed});
}
