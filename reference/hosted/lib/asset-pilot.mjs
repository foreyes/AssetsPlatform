// Fixed-sample native R2 pilot. getUser must be Sites getChatGPTUser.
// No service-token writer, incoming identity-header parser, generic upload or external fetch.
const headers = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
const json=(x,status=200)=>Response.json(x,{status,headers});
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const bytes64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export function createPilot({release,getUser,ownerId}) {
  const {version,base,manifest,files}=release, manifestFile=files.at(-1);
  const key=f=>`entity/${version}/${f.uri}`;
  async function checked(bucket,f) {
    const object=await bucket.get(key(f)); if(!object)throw Error('missing-object');
    const bytes=await object.arrayBuffer();
    if(bytes.byteLength!==f.bytes || await hash(bytes)!==f.sha256)throw Error('integrity-conflict');
    return bytes;
  }
  async function once(bucket,f) {
    const bytes=bytes64(f.base64);
    if(bytes.byteLength!==f.bytes || await hash(bytes)!==f.sha256)throw Error('invalid-pinned-source');
    await bucket.put(key(f),bytes,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:f.sha256,httpMetadata:{contentType:f.mime}});
    // NULL from a conditional write is not success: exact content must read back.
    await checked(bucket,f);
  }
  async function ready(env) {
    const row=await env.DB.prepare('SELECT manifest_sha256, file_count, payload_bytes FROM entity_asset_versions WHERE version = ?').bind(version).first();
    if(!row)return false;
    if(row.manifest_sha256!==manifestFile.sha256 || row.file_count!==manifest.fileCount || row.payload_bytes!==manifest.payloadBytes)throw Error('catalog-conflict');
    for(const f of files)await checked(env.BUCKET,f);
    return true;
  }
  return async function handle(request,env) {
    const user=await getUser();
    if(!user?.userId)return json({error:'sign-in-required'},401);
    const url=new URL(request.url);
    if(url.search || url.pathname.includes('%'))return json({error:'invalid-path'},400);
    if(!env.BUCKET || !env.DB)return json({error:'storage-not-configured'},503);
    try {
      if(url.pathname==='/api/asset-pilot/import') {
        if(request.method!=='POST')return json({error:'method-not-allowed'},405);
        if(user.userId!==ownerId)return json({error:'owner-required'},403);
        if(request.headers.get('Origin')!==url.origin || request.headers.get('Sec-Fetch-Site')!=='same-origin')return json({error:'same-origin-required'},403);
        if(request.headers.get('Content-Type')!=='application/json')return json({error:'json-required'},415);
        if(Number(request.headers.get('Content-Length')||0)>512)return json({error:'body-too-large'},413);
        const reader=request.body?.getReader(); let size=0, parts=[];
        if(reader){for(;;){const n=await reader.read();if(n.done)break;size+=n.value.length;if(size>512){await reader.cancel();return json({error:'body-too-large'},413);}parts.push(n.value);}}
        const body=new Uint8Array(size);let p=0;for(const b of parts){body.set(b,p);p+=b.length;}
        let input;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{return json({error:'invalid-json'},400);}
        if(!input || Object.keys(input).sort().join(',')!=='manifestSHA256,version' || input.version!==version || input.manifestSHA256!==manifestFile.sha256)return json({error:'not-pinned-release'},400);
        const existed=await ready(env);
        if(!existed){
          for(const f of files)await once(env.BUCKET,f);
          await env.DB.prepare('INSERT INTO entity_asset_versions (version, manifest_sha256, file_count, payload_bytes) VALUES (?, ?, ?, ?) ON CONFLICT(version) DO NOTHING').bind(version,manifestFile.sha256,manifest.fileCount,manifest.payloadBytes).run();
          if(!await ready(env))throw Error('commit-not-confirmed');
        }
        return json({state:'ready',version,manifestSHA256:manifestFile.sha256,payloadBytes:manifest.payloadBytes,fileCount:manifest.fileCount,alreadyReady:existed});
      }
      if(url.pathname==='/api/asset-pilot/status' && request.method==='GET') return json({state:await ready(env)?'ready':'not-imported',version,manifestSHA256:manifestFile.sha256,payloadBytes:manifest.payloadBytes,fileCount:manifest.fileCount,canImport:user.userId===ownerId,genericUploadEnabled:false});
      if(!['GET','HEAD'].includes(request.method))return json({error:'read-only'},405);
      if(request.headers.has('Range'))return json({error:'range-not-supported'},416);
      const f=files.find(f=>url.pathname===`${base}/${f.uri}`);
      if(!f)return json({error:'not-allowlisted'},404);
      if(!await ready(env))return json({error:'version-not-ready'},409);
      const bytes=await checked(env.BUCKET,f);
      return new Response(request.method==='HEAD'?null:bytes,{headers:{...headers,'Content-Type':f.mime,'Content-Length':String(f.bytes),ETag:`"sha256-${f.sha256}"`}});
    }catch(error){return json({error:['missing-object','integrity-conflict','catalog-conflict','invalid-pinned-source','commit-not-confirmed'].includes(error.message)?error.message:'storage-unavailable'},503);}
  };
}
