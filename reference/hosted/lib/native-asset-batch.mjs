// Archived v12 handler contract only; not routed in production. Current batch uses native static delivery protected by Sites ACL. No external fetch, R2 or uploads.
import { createHash } from 'node:crypto';
const errors={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export function createNativeBatchHandler({batch,getUser,fetchAsset}){
 return async function handle(request){
  if(!['GET','HEAD'].includes(request.method))return Response.json({error:'read-only'},{status:405,headers:{...errors,Allow:'GET, HEAD'}});
  if(!await getUser())return Response.json({error:'sign-in-required'},{status:401,headers:errors});
  const url=new URL(request.url);
  if(url.search||url.pathname.includes('%'))return Response.json({error:'query-or-encoding-not-supported'},{status:400,headers:errors});
  const item=Object.hasOwn(batch.payloads,url.pathname)&&batch.payloads[url.pathname];
  if(!item)return Response.json({error:'not-allowlisted'},{status:404,headers:errors});
  if(request.headers.has('Range'))return Response.json({error:'range-not-supported'},{status:416,headers:errors});
  if(typeof fetchAsset!=='function'||!item.storagePath.startsWith('/__entity_assets/'+batch.version+'/')||item.storagePath.includes('..'))return Response.json({error:'native-assets-unavailable'},{status:503,headers:errors});
  // Target comes only from the release-owned allowlist. Never forward caller headers/cookies.
  const stored=await fetchAsset(new Request(new URL(item.storagePath,url.origin),{method:'GET'}));
  if(stored.status!==200)return Response.json({error:'native-asset-missing'},{status:503,headers:errors});
  const length=Number(stored.headers.get('Content-Length'));
  if(length&&length!==item.bytes)return Response.json({error:'release-length-mismatch'},{status:503,headers:errors});
  const bytes=Buffer.from(await stored.arrayBuffer());
  if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)return Response.json({error:'release-integrity-failed'},{status:503,headers:errors});
  return new Response(request.method==='HEAD'?null:bytes,{headers:{'Cache-Control':'private, max-age=86400, immutable','X-Content-Type-Options':'nosniff','Content-Type':item.mime,'Content-Length':String(item.bytes),ETag:'"sha256-'+item.sha256+'"','X-Entity-Delivery-Scope':'readonly-native-batch-877-static','Vary':'Cookie'}});
 };
}
