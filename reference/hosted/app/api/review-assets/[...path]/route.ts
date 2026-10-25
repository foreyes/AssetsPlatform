import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {createIncrementalStorage} from '@/incremental-candidate/storage.mjs';
import {readyDescriptor, descriptorResponse} from '@/lib/incremental-project-directory.mjs';
import viewer from '@/lib/generated/incremental-viewer.json';
export const dynamic = 'force-dynamic';
const storage = createIncrementalStorage();
const unavailable = (status:number, message:string) => new Response(message,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
async function read(request:Request) {
  const url=new URL(request.url);
  if(url.search||url.pathname.includes('%'))return unavailable(400,'Invalid immutable path');
  if(request.headers.has('Range'))return unavailable(416,'Range not supported');
  // Never infer identity from a caller argument, email, bearer or owner query.
  let user;try {user=await getChatGPTUser();}catch{return unavailable(401,'Identity unavailable');}
  if(!user?.userId?.trim())return unavailable(401,'Sign in required');
  try {
    const match=/^\/api\/review-assets\/([A-Za-z]+)\/([A-Za-z0-9_-]{1,64})\/(v-[a-f0-9]{64})\/(project-config-v1\.json|project-config-policy-v2\.json|trusted-viewer-[a-f0-9]{64}\.mjs)$/.exec(url.pathname);
    if(match){
      const descriptor=await readyDescriptor(env,match[1],match[2],match[3],viewer);
      if(!descriptor)return unavailable(404,'Not ready');
      if(match[4]==='project-config-v1.json'||match[4]==='project-config-policy-v2.json')return descriptorResponse(descriptor,request.method);
      if(match[4]!==viewer.module)return unavailable(404,'Unregistered module');
      // This exact code is tracked by the application, not supplied by a package.
      // Its content-addressed URL cannot select an arbitrary ASSETS key or URL.
      if(!env.ASSETS)return unavailable(503,'Trusted module unavailable');
      const source=await env.ASSETS.fetch(new Request(new URL(viewer.staticPath,url.origin),{method:'GET',redirect:'manual'}));
      if(source.status!==200||source.redirected)return unavailable(503,'Trusted module unavailable');
      if(!source.body)return unavailable(503,'Trusted module unavailable');
      const bytes=new Uint8Array(viewer.bytes),reader=source.body.getReader();let size=0;
      for(;;){const part=await reader.read();if(part.done)break;if(size+part.value.length>viewer.bytes){await reader.cancel();return unavailable(503,'Trusted module integrity unavailable');}bytes.set(part.value,size);size+=part.value.length;}
      if(size!==viewer.bytes)return unavailable(503,'Trusted module integrity unavailable');
      const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(bytes.length!==viewer.bytes||sha!==viewer.sha256)return unavailable(503,'Trusted module integrity unavailable');
      return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':'text/javascript','Content-Length':String(bytes.length),'Cache-Control':'private, max-age=86400, immutable','X-Content-Type-Options':'nosniff'}});
    }
    return await storage.read(request,env)??unavailable(404,'Not registered');
  }catch{return unavailable(503,'Verified storage unavailable');}
}
export const GET=read;
export const HEAD=read;
