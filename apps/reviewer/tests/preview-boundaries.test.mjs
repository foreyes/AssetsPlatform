import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseGLB,readBoundedResponse,imageDimensions,PREVIEW_LIMITS,planTextureUploads,createSourceAnimation,createViewer} from '../viewer.mjs';
import {createPlaybackTimeline} from '../shared/playback-timeline.mjs';
const root=new URL('../',import.meta.url);
const directory=JSON.parse(fs.readFileSync(new URL('project-directory.json',root)));
const source=fs.readFileSync(new URL(directory.projects[0].config.replace(/[^/]+$/,'assets/cube.glb'),root));
const original=JSON.parse(source.subarray(20,20+source.readUInt32LE(12)));
const binStart=20+source.readUInt32LE(12),bin=source.subarray(binStart+8);
function model(change){const json=structuredClone(original);change(json);let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const out=Buffer.alloc(28+text.length+bin.length);out.writeUInt32LE(0x46546c67);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(text.length,12);out.writeUInt32LE(0x4e4f534a,16);text.copy(out,20);out.writeUInt32LE(bin.length,20+text.length);out.writeUInt32LE(0x004e4942,24+text.length);bin.copy(out,28+text.length);return out;}
function png(w,h){const b=Buffer.alloc(24);b.writeUInt32BE(0x89504e47);b.writeUInt32BE(0x0d0a1a0a,4);b.writeUInt32BE(13,8);b.writeUInt32BE(0x49484452,12);b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b;}
test('real packaged cube remains parseable',()=>assert(parseGLB(source).primitives.length>0));
test('every unknown required extension fails closed',()=>{for(const ext of ['UNKNOWN_required','KHR_draco_mesh_compression','EXT_meshopt_compression'])assert.throws(()=>parseGLB(model(j=>j.extensionsRequired=[ext])),/Unsupported required extension/);});
test('optional extensions and unapplied material inputs disclose distinct preview warnings', () => {
  const optional = 'UNKNOWN_optional';
  const geometry = parseGLB(model(json => {
    json.extensionsUsed = [optional, optional];
    json.textures = [{ source: 0 }];
    json.images = [{ uri: 'data:image/png;base64,' + png(1, 1).toString('base64') }];
    json.materials[0].normalTexture = { index: 0 };
    json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0, texCoord: 1 };
  }));
  assert(geometry.primitives.length > 0);
  assert.deepEqual(geometry.warnings, [
    'Unsupported optional extension: ' + optional,
    '当前仅支持 UV0，其他 UV 通道的贴图未应用',
    '法线贴图暂未应用；保留模型源法线'
  ]);
});
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

function texturedModel(width,height,samplers) {
  return parseGLB(model(json=>{
    json.images=[{uri:'data:image/png;base64,'+png(width,height).toString('base64')}];
    json.samplers=samplers;
    json.textures=samplers.map((_,sampler)=>({source:0,sampler}));
    const material=json.materials[0];
    material.pbrMetallicRoughness.baseColorTexture={index:0};
    if(samplers.length>1)material.emissiveTexture={index:1};
    if(samplers.length>2)material.pbrMetallicRoughness.metallicRoughnessTexture={index:2};
  }));
}
test('GPU plan shares effective samplers, skips unused textures and counts rectangular mip chains',()=>{
  const geometry=texturedModel(8,2,[{}, {minFilter:9987}, {minFilter:123}]);
  geometry.textures.push({source:99,sampler:{}});
  const plan=planTextureUploads(geometry);
  assert.equal(plan.uploads.length,1);assert.equal(plan.maps.size,3);assert.equal(plan.bytes,4+64+16+8+4);
  assert.equal(plan.maps.get(0).upload,plan.maps.get(2).upload);
});
test('NPOT bindings preserve independent shader wraps while sharing the hardware sampler',()=>{
  const plan=planTextureUploads(texturedModel(3,5,[{wrapS:10497},{wrapS:33648},{wrapS:33071}]));
  assert.equal(plan.uploads.length,1);assert.equal(plan.bytes,4+3*5*4);assert.equal(plan.uploads[0].mipmaps,false);
  assert.deepEqual([...plan.maps.values()].map(map=>map.wrap),[[1,1],[2,1],[0,1]]);
});
test('GPU plan omits unused mipmaps and enforces total bytes including white fallback',()=>{
  const geometry=texturedModel(4096,4096,[{minFilter:9729},{minFilter:9728},{minFilter:9987}]);
  assert.throws(()=>planTextureUploads(geometry),/aggregate texture bytes/);
  const noMips=planTextureUploads(texturedModel(8,2,[{minFilter:9729}]));
  assert.equal(noMips.bytes,68);assert.equal(noMips.uploads[0].mipmaps,false);
  assert.equal(planTextureUploads(parseGLB(source)).bytes,4);
});
function animatedModel(instances=1) {
  const geometry=parseGLB(model(json=>{
    json.extras={sourceId:'fixture'};
    json.nodes=Array.from({length:instances},(_,index)=>({mesh:0,extras:{sourceId:'node'+index}}));
    json.scenes=[{nodes:json.nodes.map((_,index)=>index)}];json.scene=0;
  }));
  const data={schemaVersion:1,coordinateSystem:'glTF',sourceId:'fixture',modelSHA256:'model',nodes:[{id:'node0',glbNodeIndex:0,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}],clips:[
    {id:'move',canonicalSHA256:'move',duration:10,tracks:[{nodeId:'node0',path:'translation',interpolation:'LINEAR',times:[0,10],values:[[0,0,0],[20,0,0]]}]},
    {id:'other',canonicalSHA256:'other',duration:10,tracks:[{nodeId:'node0',path:'translation',interpolation:'LINEAR',times:[0,10],values:[[0,0,0],[0,20,0]]}]}
  ]};
  return {geometry,data};
}
test('framing immediately returns rest view; bounded async sampling never mutates live pose or clip state',async()=>{
  const {geometry,data}=animatedModel(),animation=createSourceAnimation(geometry,data);
  assert.equal(animation.clips.length,2);assert.equal(animation.getFraming().sampleCount,0);assert.equal(animation.getState(),null);
  const pending=animation.prepareFraming('move');
  const live=animation.sample('other',3),positions=live.primitives[0].positions.slice(),worlds=animation.getNodeWorldMatrices();
  const framing=await pending;
  assert(framing.sampleCount>0&&framing.sampleCount<=17);assert.equal(framing.approximate,true);
  assert.deepEqual(animation.getState(),{clipId:'other',time:3,duration:10});
  assert.deepEqual(live.primitives[0].positions,positions);assert.deepEqual(animation.getNodeWorldMatrices(),worlds);
  assert.equal(animation.getFraming('move').sampleCount,framing.sampleCount);assert.equal(animation.getFraming('other').sampleCount,0);
});
test('cancelled framing is not cached and expensive geometry retains an immediate static fallback',async()=>{
  const fixture=animatedModel(),animation=createSourceAnimation(fixture.geometry,fixture.data),controller=new AbortController();
  const pending=animation.prepareFraming('move',{signal:controller.signal});controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(animation.getFraming().sampleCount,0);
  const large=animatedModel(257),largeAnimation=createSourceAnimation(large.geometry,large.data);
  assert.equal((await largeAnimation.prepareFraming()).sampleCount,0);assert.equal(largeAnimation.getState(),null);
});
test('matching precomputed framing is an actual no-sampling fast path',async()=>{
  const {geometry,data}=animatedModel();
  data.precomputedFraming={move:{modelSHA256:'model',canonicalSHA256:'move',clipId:'move',center:[1,2,3],scale:0.5,sampleCount:100,bounds:{min:[-10,-10,-10],max:[10,10,10]}}};
  const animation=createSourceAnimation(geometry,data),frame=await animation.prepareFraming();
  assert.equal(frame.precomputed,true);assert.equal(frame.sampleCount,100);assert.equal(animation.getState(),null);assert.equal(animation.getNodeWorldMatrices(),null);
});

// Exercise the real viewer/timeline binding before RAF. Only the DOM and GPU
// transport are stubbed; parsing, posing, framing and playback are production code.
async function withViewerPlatform(run) {
  const names=['fetch','requestAnimationFrame','cancelAnimationFrame','ResizeObserver'];
  const previous=new Map(names.map(name=>[name,globalThis[name]]));
  const gl=new Proxy({NO_ERROR:0,getError:()=>0,getParameter:()=>8192,getShaderParameter:()=>true,getProgramParameter:()=>true,getShaderPrecisionFormat:()=>({precision:23}),getAttribLocation:()=>0,getExtension:()=>null,createTexture:()=>({}),createProgram:()=>({}),createShader:()=>({}),createBuffer:()=>({})},{get(target,key){if(key in target)return target[key];return /^[A-Z0-9_]+$/.test(key)?1:()=>{};}});
  const canvas={style:{},setAttribute(){},getContext:()=>gl,addEventListener(){},removeEventListener(){}};
  const container={replaceChildren(child){child.parentNode=this;},querySelector:()=>null};
  globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  try{await run({container,canvas});}finally{for(const [name,value] of previous){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}}
}
for(const cache of ['missing','stale','valid'])test('viewer timeline first pose stays visible with '+cache+' framing on a large clip',async()=>{
  await withViewerPlatform(async({container,canvas})=>{
    const bytes=model(json=>{
      json.extras={sourceId:'fixture'};json.nodes=Array.from({length:257},(_,i)=>i?{}:{mesh:0,extras:{sourceId:'node0'}});
      json.scenes=[{nodes:json.nodes.map((_,i)=>i)}];json.scene=0;
    });
    const {data}=animatedModel();data.clips=data.clips.slice(0,1);data.clips[0].tracks[0].values=[[20,0,0],[22,0,0]];
    if(cache!=='missing')data.precomputedFraming={move:{modelSHA256:'model',canonicalSHA256:'move',clipId:'move',center:cache==='valid'?[21,0,0]:[0,0,0],scale:0.4,sampleCount:100,bounds:{min:cache==='valid'?[19,-1,-1]:[-1,-1,-1],max:cache==='valid'?[23,1,1]:[1,1,1]}}};
    globalThis.fetch=async()=>new Response(bytes);
    const viewer=await createViewer(container,'fixture.glb',{_canvas:canvas,animationData:data});
    const timeline=createPlaybackTimeline({onFrame:state=>viewer.setAnimationTime(state.clipId,state.time)});
    try{
      assert.deepEqual(viewer.getAnimationFraming().center,[0,0,0]);
      timeline.configure(viewer.getAnimationClips());
      const first=viewer.getAnimationFraming();
      assert.equal(viewer.getAnimationState().time,0);assert(first.center[0]>=20);
      assert(Math.abs(20-first.center[0])*first.scale<1.25);
      assert.equal(first.precomputed===true,cache==='valid');
      const camera=viewer.getCamera();viewer.setCamera({...camera,yaw:camera.yaw+0.2});
      await new Promise(resolve=>setTimeout(resolve,5));
      assert.deepEqual(viewer.getAnimationFraming(),first);assert.equal(viewer.getCamera().yaw,camera.yaw+0.2);
      timeline.seek(2);assert.deepEqual(viewer.getAnimationFraming(),first);
    }finally{timeline.dispose();viewer.dispose();}
  });
});

test('timeline invalidates a precomputed frame when a later real pose leaves its bounds',async()=>{
  await withViewerPlatform(async({container,canvas})=>{
    const bytes=model(json=>{
      json.extras={sourceId:'fixture'};json.nodes=Array.from({length:257},(_,i)=>i?{}:{mesh:0,extras:{sourceId:'node0'}});
      json.scenes=[{nodes:json.nodes.map((_,i)=>i)}];json.scene=0;
    });
    const {data}=animatedModel();data.clips=data.clips.slice(0,1);
    data.precomputedFraming={move:{modelSHA256:'model',canonicalSHA256:'move',clipId:'move',center:[0,0,0],scale:0.6,sampleCount:100,bounds:{min:[-1,-1,-1],max:[1,1,1]}}};
    globalThis.fetch=async()=>new Response(bytes);
    const viewer=await createViewer(container,'fixture.glb',{_canvas:canvas,animationData:data});
    const timeline=createPlaybackTimeline({onFrame:state=>viewer.setAnimationTime(state.clipId,state.time)});
    try{
      timeline.configure(viewer.getAnimationClips());assert.equal(viewer.getAnimationFraming().precomputed,true);
      timeline.seek(10);const frame=viewer.getAnimationFraming();
      assert.equal(frame.precomputed,undefined);assert.equal(frame.center[0],20);
      assert(Math.abs(20-frame.center[0])*frame.scale<1.25);
      await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(viewer.getAnimationFraming(),frame);
    }finally{timeline.dispose();viewer.dispose();}
  });
});
test('two 12000-vertex views complete the same fixed framing samples regardless of scheduling',async()=>{
  const geometry=parseGLB(model(json=>{
    json.extras={sourceId:'fixture'};json.nodes[0].extras={sourceId:'node0'};
    json.meshes[0].primitives=Array.from({length:1500},()=>structuredClone(json.meshes[0].primitives[0]));
  }));
  assert.equal(geometry.vertices,12000);
  const {data}=animatedModel(),left=createSourceAnimation(geometry,data),right=createSourceAnimation(geometry,data);
  left.framePose('move',left.sample('move',0).posedBounds);right.framePose('move',right.sample('move',0).posedBounds);
  const pending=left.prepareFraming('move');
  await new Promise(resolve=>setTimeout(resolve,20));
  const [a,b]=await Promise.all([pending,right.prepareFraming('move')]);
  assert.equal(a.sampleCount,17);assert.equal(b.sampleCount,17);assert.deepEqual(a,b);
});

test('restoring saved timeline time before first RAF fits the pending pose without restarting the sweep',async()=>{
  await withViewerPlatform(async({container,canvas})=>{
    const bytes=model(json=>{
      json.extras={sourceId:'fixture'};json.nodes[0].extras={sourceId:'node0'};
      json.meshes[0].primitives=Array.from({length:1500},()=>structuredClone(json.meshes[0].primitives[0]));
    });
    const {data}=animatedModel();data.clips=data.clips.slice(0,1);data.clips[0].duration=1;data.clips[0].tracks[0].times=[0,1];
    globalThis.fetch=async()=>new Response(bytes);
    const viewer=await createViewer(container,'fixture.glb',{_canvas:canvas,animationData:data});
    const timeline=createPlaybackTimeline({onFrame:state=>viewer.setAnimationTime(state.clipId,state.time)});
    try{
      const camera=viewer.getCamera();
      timeline.configure(viewer.getAnimationClips());timeline.select('move');timeline.seek(1);
      const first=viewer.getAnimationFraming();
      assert.equal(first.sampleCount,0);assert.equal(first.center[0],20);
      assert(Math.abs(20-first.center[0])*first.scale<1.25);assert.deepEqual(viewer.getCamera(),camera);
      // The original job completes rather than being restarted by restored seeks.
      for(let i=0;i<100&&viewer.getAnimationFraming().sampleCount!==17;i++)await new Promise(resolve=>setTimeout(resolve,10));
      const final=viewer.getAnimationFraming();assert.equal(final.sampleCount,17);assert.equal(final.center[0],10);
      assert.deepEqual(viewer.getCamera(),camera);assert.equal(viewer.getAnimationState().time,1);
    }finally{timeline.dispose();viewer.dispose();}
  });
});

test('two real viewers publish the same completed sweep despite staggered playback poses',async()=>{
  await withViewerPlatform(async({container,canvas})=>{
    const bytes=model(json=>{json.extras={sourceId:'fixture'};json.nodes[0].extras={sourceId:'node0'};});
    const {data}=animatedModel();data.clips=data.clips.slice(0,1);data.clips[0].duration=1;
    // A brief excursion between fixed samples is an explicit approximation gap.
    data.clips[0].tracks[0].times=[0,1/32,1/16,1];
    data.clips[0].tracks[0].values=[[0,0,0],[20,0,0],[0,0,0],[0,0,0]];
    globalThis.fetch=async()=>new Response(bytes);
    const left=await createViewer(container,'fixture.glb',{_canvas:canvas,animationData:data});
    const right=await createViewer({...container},'fixture.glb',{_canvas:{...canvas,style:{}},animationData:data});
    const leftTimeline=createPlaybackTimeline({onFrame:state=>left.setAnimationTime(state.clipId,state.time)});
    const rightTimeline=createPlaybackTimeline({onFrame:state=>right.setAnimationTime(state.clipId,state.time)});
    async function finish(viewer){for(let i=0;i<100&&viewer.getAnimationFraming().sampleCount!==17;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(viewer.getAnimationFraming().sampleCount,17);}
    try{
      leftTimeline.configure(left.getAnimationClips());await finish(left);
      rightTimeline.configure(right.getAnimationClips());
      leftTimeline.seek(1/32);rightTimeline.seek(1/32);
      assert.equal(right.getAnimationFraming().center[0],20);
      await finish(right);
      assert.deepEqual(left.getAnimationState(),right.getAnimationState());
      assert.deepEqual(left.getAnimationFraming(),right.getAnimationFraming());
      assert.equal(right.getAnimationFraming().center[0],0);
      assert.deepEqual(left.getCamera(),right.getCamera());
    }finally{leftTimeline.dispose();rightTimeline.dispose();left.dispose();right.dispose();}
  });
});
