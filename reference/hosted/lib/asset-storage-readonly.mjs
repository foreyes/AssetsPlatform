// Production storage diagnostics and downloads only. Asset ingestion belongs to
// the authenticated backend publication pipeline, never a visitor-facing API.
const headers = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
const json=(x,status=200,extra={})=>Response.json(x,{status,headers:{...headers,...extra}});
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function createReadOnlyStorage({release,getUser}) {
  const {version,base,manifest,files}=release, manifestFile=files.at(-1);
  const key=f=>`entity/${version}/${f.uri}`;
  async function checked(bucket,f) {
    const object=await bucket.get(key(f));if(!object)throw Error('missing-object');
    const bytes=await object.arrayBuffer();
    if(bytes.byteLength!==f.bytes || await hash(bytes)!==f.sha256)throw Error('integrity-conflict');
    return bytes;
  }
  async function ready(env) {
    const row=await env.DB.prepare('SELECT manifest_sha256, file_count, payload_bytes FROM entity_asset_versions WHERE version = ?').bind(version).first();
    if(!row)return false;
    if(row.manifest_sha256!==manifestFile.sha256 || row.file_count!==manifest.fileCount || row.payload_bytes!==manifest.payloadBytes)throw Error('catalog-conflict');
    for(const f of files)await checked(env.BUCKET,f);
    return true;
  }
  return async function handle(request,env) {
    if(!['GET','HEAD'].includes(request.method))return json({error:'read-only',uploadEnabled:false},405,{Allow:'GET, HEAD'});
    const user=await getUser();if(!user?.userId)return json({error:'sign-in-required'},401);
    const url=new URL(request.url);
    if(url.search || url.pathname.includes('%'))return json({error:'invalid-path'},400);
    if(url.pathname!=='/api/asset-pilot/status' && !files.some(f=>url.pathname===`${base}/${f.uri}`))return json({error:'not-allowlisted'},404);
    if(!env.BUCKET || !env.DB)return json({error:'storage-not-configured'},503);
    try {
      if(url.pathname==='/api/asset-pilot/status') {
        if(request.method!=='GET')return json({error:'method-not-allowed'},405,{Allow:'GET'});
        return json({state:await ready(env)?'ready':'not-imported',version,manifestSHA256:manifestFile.sha256,payloadBytes:manifest.payloadBytes,fileCount:manifest.fileCount,canImport:false,genericUploadEnabled:false,uploadEnabled:false,assetManagement:'backend-publication',r2BackendWriterReady:false});
      }
      if(request.headers.has('Range'))return json({error:'range-not-supported'},416);
      const f=files.find(f=>url.pathname===`${base}/${f.uri}`);
      if(!await ready(env))return json({error:'version-not-ready'},409);
      const bytes=await checked(env.BUCKET,f);
      return new Response(request.method==='HEAD'?null:bytes,{headers:{...headers,'Content-Type':f.mime,'Content-Length':String(f.bytes),ETag:`"sha256-${f.sha256}"`}});
    }catch(error){return json({error:['missing-object','integrity-conflict','catalog-conflict'].includes(error.message)?error.message:'storage-unavailable'},503);}
  };
}
