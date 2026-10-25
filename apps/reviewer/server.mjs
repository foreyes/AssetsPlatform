import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.svg':'image/svg+xml'};
const port=Number(process.env.PORT||8768);
http.createServer((req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(requested.split('/').some(part=>part.startsWith('.'))){res.writeHead(404);res.end();return;}
  const target=path.resolve(root,'.'+requested+(requested.endsWith('/')?'index.html':''));
  if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()||!fs.realpathSync(target).startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
  if(path.relative(root,fs.realpathSync(target)).split(path.sep).some(part=>part.startsWith('.'))){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD')res.end();else fs.createReadStream(target).pipe(res);
 }catch{res.writeHead(400);res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`Asset Review: http://127.0.0.1:${port}/`));
