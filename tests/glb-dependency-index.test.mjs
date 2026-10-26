import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {importDirectory} from '../scripts/import-directory.mjs';
import {indexGLBDependencies} from '../scripts/index-glb-dependencies.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cube=fs.readFileSync(path.join(root,'apps/reviewer/demo-a/assets/cube.glb'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5l8AAAAASUVORK5CYII=','base64');
function fixture(withAnimation=false) {
  const old=JSON.parse(cube.subarray(20,20+cube.readUInt32LE(12)).toString());
  const oldBin=cube.subarray(28+cube.readUInt32LE(12));
  let bin=Buffer.concat([oldBin,png,Buffer.alloc((4-png.length%4)%4)]);
  const doc={...old,
    buffers:[{byteLength:bin.length}],
    bufferViews:[...old.bufferViews,{buffer:0,byteOffset:oldBin.length,byteLength:png.length}],
    scenes:[{nodes:[0]}],
    nodes:[{children:[1,2,3],name:'Root'},{mesh:0,name:'Repeated'},{mesh:1,name:'Repeated'},{name:''}],
    meshes:[{name:'Repeated',primitives:[{attributes:{POSITION:0},indices:1,material:0}]},
      {name:'Repeated',primitives:[{attributes:{POSITION:0},indices:1,material:1}]}],
    materials:[{name:'',pbrMetallicRoughness:{baseColorTexture:{index:0}}},
      {name:'',pbrMetallicRoughness:{baseColorTexture:{index:1}}}],
    textures:[{source:0,name:'Shared image'},{source:0,name:'Shared image'}],
    images:[{bufferView:2,mimeType:'image/png',name:''}]
  };
  if(withAnimation){
    const times=Buffer.alloc(8),translation=Buffer.alloc(24);times.writeFloatLE(1,4);translation.writeFloatLE(1,16);
    const timeOffset=bin.length,translationOffset=timeOffset+times.length;
    bin=Buffer.concat([bin,times,translation]);doc.buffers[0].byteLength=bin.length;
    doc.bufferViews.push({buffer:0,byteOffset:timeOffset,byteLength:times.length},{buffer:0,byteOffset:translationOffset,byteLength:translation.length});
    doc.accessors.push({bufferView:3,componentType:5126,count:2,type:'SCALAR'},
      {bufferView:4,componentType:5126,count:2,type:'VEC3'});
    doc.animations=[{samplers:[{input:2,output:3,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:1,path:'translation'}}]}];
  }
  let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const header=Buffer.alloc(12),jsonHeader=Buffer.alloc(8),binHeader=Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);
  jsonHeader.writeUInt32LE(json.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);
  binHeader.writeUInt32LE(bin.length,0);binHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,jsonHeader,json,binHeader,bin]);
}
function setup(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glb-index-')),source=path.join(dir,'source');fs.mkdirSync(source);return {dir,source,output:path.join(dir,'out'),id:'indexed'};}
const catalog=output=>JSON.parse(fs.readFileSync(path.join(output,'library/assets/catalog.json')));
const objects=output=>JSON.parse(fs.readFileSync(path.join(output,'library/assets/objects-catalog.json')));

test('opt-in GLB index distinguishes file, definitions and node instances; closes shared references',()=>{
  const x=setup();try{
    const file=path.join(x.source,'two-nodes.glb'),bytes=fixture();fs.writeFileSync(file,bytes);
    const before=fs.readFileSync(file);
    const result=importDirectory({...x,indexGLBDependencies:true});
    assert(!fs.existsSync(path.join(x.output,'animation-example')),'imported workspace excludes public exercise fixture');
    assert.deepEqual(fs.readFileSync(file),before,'source directory stays byte-for-byte read-only');
    assert.deepEqual(result.dependencyIndex,{schema:'gltf-internal-index/1',imageExtraction:'not-implemented',files:1,
      meshDefinitions:2,primitiveDefinitions:2,materialDefinitions:2,textureDefinitions:2,imageDefinitions:1,
      nodeDefinitions:4,sceneDefinitions:1,meshNodeInstances:2,primitiveNodeInstances:2});
    const assets=catalog(x.output).assets,object=objects(x.output).objects[0];
    const byType=type=>assets.filter(a=>a.type===type);
    assert.equal(assets.length,15);assert.equal(byType('mesh').length,1);assert.equal(objects(x.output).objects.length,1);
    assert.equal(byType('mesh-definition').length,2);assert.equal(byType('node').filter(n=>n.meshId).length,2);
    assert.equal(byType('node').filter(n=>n.name==='Repeated').length,2);
    assert.equal(byType('mesh-definition').filter(m=>m.name==='Repeated').length,2);
    assert.deepEqual(byType('material').map(m=>m.name),['material 0','material 1']);
    const [image]=byType('image'),[textureA,textureB]=byType('texture');
    assert.equal(textureA.imageId,image.id);assert.equal(textureB.imageId,image.id);
    assert.deepEqual(image.textureIds,[textureA.id,textureB.id]);
    const [materialA,materialB]=byType('material');
    assert.deepEqual(materialA.textureLinks,[textureA.id]);assert.deepEqual(materialB.textureLinks,[textureB.id]);
    assert.deepEqual(byType('primitive').map(p=>p.materialId),[materialA.id,materialB.id]);
    assert.deepEqual(byType('scene')[0].rootNodeIds,[byType('node')[0].id]);
    assert.deepEqual(byType('node')[0].childNodeIds,byType('node').slice(1).map(n=>n.id));
    assert(byType('node').every(node=>!Object.hasOwn(node,'sourceActive')),'index does not infer source-engine visibility');
    const ids=new Set(assets.map(a=>a.id));
    for(const a of assets)for(const [k,v] of Object.entries(a)) {
      if(k.endsWith('Id')&&v!==null)assert(ids.has(v),`${a.id}.${k} closes`);
      if(k.endsWith('Ids'))for(const id of v)assert(ids.has(id),`${a.id}.${k} closes`);
    }
    assert.deepEqual(new Set(object.assetIds),ids);
    assert.deepEqual(object.animationFacts,byType('mesh')[0].animationFacts);
    assert.deepEqual(object.animationFacts.sourceTracks,{value:false,evidence:[{source:'glTF-json-parser',reference:`sha256:${byType('mesh')[0].sourceFileSha256}#/animations`}]});
    assert.deepEqual(object.animationFacts.skeletonPresent,{value:false,evidence:[{source:'glTF-json-parser',reference:`sha256:${byType('mesh')[0].sourceFileSha256}#/skins`}]});
    assert.equal(object.animationFacts.playbackVerified,undefined);
    assert(assets.slice(1).every(a=>a.derivedFrom===byType('mesh')[0].id));
    assert(assets.slice(1).every(a=>a.sourceFileSha256===byType('mesh')[0].sourceFileSha256));
    assert.equal(image.contentSha256,createHash('sha256').update(png).digest('hex'));
    assert.equal(fs.readdirSync(path.join(x.output,'library/assets')).filter(f=>/\.png$/.test(f)).length,0);
    const validate=spawnSync(process.execPath,['validate-workspace.mjs'],{cwd:x.output,encoding:'utf8'});assert.equal(validate.status,0,validate.stderr);
    const again=path.join(x.dir,'again');importDirectory({...x,output:again,indexGLBDependencies:true});
    assert.deepEqual(catalog(again),catalog(x.output));
    assert.deepEqual(objects(again),objects(x.output));
    assert.deepEqual(fs.readFileSync(path.join(again,'import-report.json')),fs.readFileSync(path.join(x.output,'import-report.json')));
    const baseline=path.join(x.dir,'baseline');importDirectory({...x,output:baseline});
    assert(!fs.existsSync(path.join(baseline,'animation-example')),'default workspace excludes public exercise fixture');
    assert.equal(catalog(baseline).assets.length,1);assert.equal(objects(baseline).objects.length,1);
    assert.equal(objects(baseline).objects[0].id,object.id);
    assert.equal(JSON.parse(fs.readFileSync(path.join(baseline,'library/project-config.json'))).datasetId,result.datasetId);
    assert.throws(()=>importDirectory({...x,indexGLBDependencies:true}),/already exists/);
  }finally{fs.rmSync(x.dir,{recursive:true,force:true});}
});

test('CLI option is opt-in and malformed internal references fail before output creation',()=>{
  const x=setup();try{
    const file=path.join(x.source,'asset.glb');fs.writeFileSync(file,fixture());
    const cli=spawnSync(process.execPath,['scripts/import-directory.mjs','--source',x.source,'--output',x.output,'--id',x.id,'--index-glb-dependencies'],{cwd:root,encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);assert.equal(catalog(x.output).assets.length,15);
    const bad=fixture(),jsonLength=bad.readUInt32LE(12),doc=JSON.parse(bad.subarray(20,20+jsonLength).toString());
    doc.materials[0].pbrMetallicRoughness.baseColorTexture.index=500;
    let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
    const bin=bad.subarray(28+jsonLength),header=Buffer.from(bad.subarray(0,20)),binHeader=Buffer.alloc(8);
    header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);
    binHeader.writeUInt32LE(bin.length,0);binHeader.writeUInt32LE(0x004e4942,4);
    fs.writeFileSync(file,Buffer.concat([header,json,binHeader,bin]));
    const other=path.join(x.dir,'bad-output');assert.throws(()=>importDirectory({...x,output:other,indexGLBDependencies:true}),/Invalid glTF material texture index/);
    assert(!fs.existsSync(other));
  }finally{fs.rmSync(x.dir,{recursive:true,force:true});}
});

test('index budget is enforced before record expansion and extension-only image links remain unknown',()=>{
  const bytes=fixture(),doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  const args={doc,bytes,relative:'fixture.glb',key:'0'.repeat(64),sourceSha256:'1'.repeat(64)};
  assert.throws(()=>indexGLBDependencies({...args,maxRecords:2}),/index budget exceeded/);
  delete doc.textures[1].source;doc.textures[1].extensions={EXT_not_supported:{source:0}};
  const result=indexGLBDependencies(args),texture=result.assets.find(a=>a.type==='texture'&&a.id.endsWith('-1'));
  assert.equal(texture.imageId,null);
  assert.match(texture.imageBinding,/extension-only/);
  assert.equal(result.assets.filter(a=>a.type==='image').length,1);
  doc.accessors.push({bufferView:500,componentType:5126,count:2,type:'SCALAR'},
    {bufferView:500,componentType:5126,count:2,type:'VEC3'});
  doc.animations=[{samplers:[{input:2,output:3}],channels:[{sampler:0,target:{node:1,path:'translation'}}]}];
  assert.equal(indexGLBDependencies(args).animationFacts.sourceTracks,undefined,'unbacked channel remains unknown, not verified true');
});

test('a GLB with real core animation channels reports source tracks, not playback readiness',()=>{
  const x=setup();try{
    fs.writeFileSync(path.join(x.source,'animated.glb'),fixture(true));
    importDirectory({...x,indexGLBDependencies:true});
    const model=catalog(x.output).assets.find(a=>a.type==='mesh');
    assert.equal(model.animationFacts.sourceTracks.value,true);
    assert.equal(model.animationFacts.skeletonPresent.value,false);
    assert.equal(model.animationFacts.bindingConfirmed,undefined);
    assert.equal(model.animationFacts.conversionSupported,undefined);
    assert.equal(model.animationFacts.playbackVerified,undefined);
    assert.deepEqual(objects(x.output).objects[0].animationFacts,model.animationFacts);
    const check=spawnSync(process.execPath,['validate-workspace.mjs'],{cwd:x.output,encoding:'utf8'});
    assert.equal(check.status,0,check.stderr);
  }finally{fs.rmSync(x.dir,{recursive:true,force:true});}
});
