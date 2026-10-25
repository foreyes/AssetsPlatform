import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {supplementalPreviewLinks} from '@/lib/entity-supplemental-preview-links.mjs';
export const dynamic='force-dynamic';
async function read(request:Request){
 const deny=(status:number,message:string)=>new Response(message,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 const url=new URL(request.url);if(url.search)return deny(400,'Invalid supplemental lookup path');
 if(request.headers.has('Range'))return deny(416,'Range not supported');
 let user;try{user=await getChatGPTUser();}catch{return deny(401,'Identity unavailable');}
 if(!user?.userId?.trim())return deny(401,'Sign in required');
 try{return await supplementalPreviewLinks(env,request.method);}catch{return deny(503,'Ready links unavailable');}
}
export const GET=read;
export const HEAD=read;
