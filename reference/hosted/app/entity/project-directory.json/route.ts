import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {projectDirectory} from '@/lib/incremental-project-directory.mjs';
export const dynamic='force-dynamic';
async function read(request:Request) {
  const deny=(status:number,message:string)=>new Response(message,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  if(new URL(request.url).search)return deny(400,'Invalid directory path');
  let user;try{user=await getChatGPTUser();}catch{return deny(401,'Identity unavailable');}
  if(!user?.userId?.trim())return deny(401,'Sign in required');
  try{return await projectDirectory(env,request.method);}catch{return deny(503,'Ready directory unavailable');}
}
export const GET=read;
export const HEAD=read;
