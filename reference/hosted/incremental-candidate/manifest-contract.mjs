// Pure manifest and metadata contract shared by hosted ingestion and local export.
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
export function checkJSONText(text){
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
