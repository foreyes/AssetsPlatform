import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseGLB,readBoundedResponse,imageDimensions,PREVIEW_LIMITS} from '../viewer.mjs';
const root=new URL('../',import.meta.url);
const directory=JSON.parse(fs.readFileSync(new URL('project-directory.json',root)));
const source=fs.readFileSync(new URL(directory.projects[0].config.replace(/[^/]+$/,'assets/cube.glb'),root));
const original=JSON.parse(source.subarray(20,20+source.readUInt32LE(12)));
const binStart=20+source.readUInt32LE(12),bin=source.subarray(binStart+8);
function model(change){const json=structuredClone(original);change(json);let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const out=Buffer.alloc(28+text.length+bin.length);out.writeUInt32LE(0x46546c67);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(text.length,12);out.writeUInt32LE(0x4e4f534a,16);text.copy(out,20);out.writeUInt32LE(bin.length,20+text.length);out.writeUInt32LE(0x004e4942,24+text.length);bin.copy(out,28+text.length);return out;}
function png(w,h){const b=Buffer.alloc(24);b.writeUInt32BE(0x89504e47);b.writeUInt32BE(0x0d0a1a0a,4);b.writeUInt32BE(13,8);b.writeUInt32BE(0x49484452,12);b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b;}
test('real packaged cube remains parseable',()=>assert(parseGLB(source).primitives.length>0));
test('unconverted source-engine visibility and renderer hints are rejected',()=>{
 assert.throws(()=>parseGLB(model(j=>{j.nodes[0].extras={sourceActive:false};})),/未转换的源引擎/);
 assert.throws(()=>parseGLB(model(j=>{j.meshes[0].extras={rendererType:'SkinnedMeshRenderer'};})),/未转换的源引擎/);
});
test('every unknown required extension fails closed',()=>{for(const ext of ['UNKNOWN_required','KHR_draco_mesh_compression','EXT_meshopt_compression'])assert.throws(()=>parseGLB(model(j=>j.extensionsRequired=[ext])),/Unsupported required extension/);});
test('unknown optional extension is disclosed',()=>assert(parseGLB(model(j=>j.extensionsUsed=['UNKNOWN_optional'])).warnings.includes('Unsupported optional extension: UNKNOWN_optional')));
test('required implemented unlit material remains supported',()=>assert(parseGLB(model(j=>j.extensionsRequired=['KHR_materials_unlit'])).primitives.length));
test('aggregate accessor allocation checked before access',()=>assert.throws(()=>parseGLB(model(j=>j.accessors=Array.from({length:9},()=>({count:1048576,type:'SCALAR',componentType:5126})))),/aggregate accessor values/));
test('node and image collection limits checked',()=>{assert.throws(()=>parseGLB(model(j=>j.nodes=Array(4097).fill({}))),/nodes/);assert.throws(()=>parseGLB(model(j=>j.images=Array(129).fill({}))),/images/);});
test('image dimensions fail before browser decode',()=>{const huge=png(100000,1);assert.throws(()=>imageDimensions(huge.buffer.slice(huge.byteOffset,huge.byteOffset+huge.byteLength),'image/png'),/image width/);const b=png(8192,8192);assert.throws(()=>parseGLB(model(j=>j.images=[{uri:'data:image/png;base64,'+b.toString('base64')}])),/aggregate image pixels/);});
test('repeated embedded images count against aggregate pixels',()=>{const uri='data:image/png;base64,'+png(4096,4096).toString('base64');assert.throws(()=>parseGLB(model(j=>j.images=Array(3).fill({uri}))),/aggregate image pixels/);});
test('external and unsupported image formats fail closed',()=>assert.throws(()=>parseGLB(model(j=>j.images=[{uri:'texture.png'}])),/External images/));
test('model byte budget precedes decoding',()=>assert.throws(()=>parseGLB(new ArrayBuffer(PREVIEW_LIMITS.downloadBytes+1)),/model bytes/));
test('streaming enforces actual bytes even without honest content length',async()=>{for(const headers of [{},{'content-length':'1'}]){let cancelled=false;const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(6));},cancel(){cancelled=true;}});await assert.rejects(readBoundedResponse(new Response(body,{headers}),10),/download bytes/);assert(cancelled);}});
test('declared over-budget response cancels without reading',async()=>{let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;}});await assert.rejects(readBoundedResponse(new Response(body,{headers:{'content-length':'100'}}),10),/download bytes/);assert(cancelled);});
test('bounded response preserves exact bytes',async()=>assert.deepEqual(new Uint8Array(await readBoundedResponse(new Response(new Uint8Array([1,2,3])),3)),new Uint8Array([1,2,3])));

test('deep node hierarchies reject before recursive overflow',()=>assert.throws(()=>parseGLB(model(j=>{j.nodes=Array.from({length:131},(_,i)=>i<130?{children:[i+1]}:{});j.scenes=[{nodes:[0]}];j.scene=0;})),/node depth/));
test('JSON chunk has a separate parse budget',()=>assert.throws(()=>parseGLB(model(j=>j.extras={padding:'x'.repeat(PREVIEW_LIMITS.jsonBytes)})),/JSON bytes/));
test('instance expansion has aggregate vertex budget',()=>assert.throws(()=>parseGLB(model(j=>{j.nodes=[{mesh:0}];j.scenes=[{nodes:[0]}];j.scene=0;j.accessors=[{componentType:5126,type:'VEC3',count:1000001}];j.meshes=[{primitives:[{attributes:{POSITION:0}}]}];})),/instanced vertices/));
test('triangle strip expansion has aggregate index budget',()=>assert.throws(()=>parseGLB(model(j=>{j.nodes=[{mesh:0}];j.scenes=[{nodes:[0]}];j.scene=0;j.accessors=[{componentType:5126,type:'VEC3',count:3},{componentType:5125,type:'SCALAR',count:1000003}];j.meshes=[{primitives:[{attributes:{POSITION:0},indices:1,mode:5}]}];})),/expanded indices/));

test('repeated DAG children fail without expanding descendants',()=>assert.throws(()=>parseGLB(model(j=>{j.nodes=[{children:[1,1]},{children:[2,2]},{mesh:0}];j.scenes=[{nodes:[0]}];j.scene=0;})),/多个父层级/));
test('partial UV transform semantics cannot satisfy required extension',()=>assert.throws(()=>parseGLB(model(j=>j.extensionsRequired=['KHR_texture_transform'])),/Unsupported required extension/));
test('geometry fetch rejects redirects rather than escaping approved source',async()=>{const {loadGeometry}=await import('../viewer.mjs');const originalFetch=globalThis.fetch;try{globalThis.fetch=async(url,options)=>{assert.equal(options.redirect,'error');return new Response(source);};assert((await loadGeometry('model.glb')).primitives.length);}finally{globalThis.fetch=originalFetch;}});
