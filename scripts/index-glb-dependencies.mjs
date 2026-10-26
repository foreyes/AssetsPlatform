// Optional, metadata-only index for the self-contained GLBs accepted by import-directory.
// IDs identify glTF definitions by source-file path and JSON index, never by display name.
import {createHash} from 'node:crypto';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const definitionHash = value => sha256(JSON.stringify(canonical(value)));
const at = (collection, index, label) => {
  if (!Number.isSafeInteger(index) || index < 0 || index >= collection.length) throw Error(`Invalid glTF ${label} index: ${index}`);
  return collection[index];
};
const array = (value, label) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw Error(`Invalid glTF ${label} collection`);
  return value;
};
const display = (name, type, index) => typeof name === 'string' && name.trim() ? name.trim() : `${type} ${index}`;
const location = (...segments) => '/' + segments.join('/');
const IMAGE_URI = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/;
const MATERIAL_SLOTS = [
  ['pbrMetallicRoughness/baseColorTexture', m => m.pbrMetallicRoughness?.baseColorTexture],
  ['pbrMetallicRoughness/metallicRoughnessTexture', m => m.pbrMetallicRoughness?.metallicRoughnessTexture],
  ['normalTexture', m => m.normalTexture], ['occlusionTexture', m => m.occlusionTexture],
  ['emissiveTexture', m => m.emissiveTexture]
];

// These are JSON-level source facts, not decoded animation, binding or playback validation.
function glTFAnimationFacts(doc, bytes, sourceSha256) {
  const evidence=pointer=>[{source:'glTF-json-parser',reference:`sha256:${sourceSha256}#/${pointer}`}];
  const animations=Array.isArray(doc.animations)?doc.animations:[],nodes=Array.isArray(doc.nodes)?doc.nodes:[];
  const accessors=Array.isArray(doc.accessors)?doc.accessors:[],views=Array.isArray(doc.bufferViews)?doc.bufferViews:[];
  const binLength=bytes.readUInt32LE(20+bytes.readUInt32LE(12));
  const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
  function storedFloat(index,type) {
    if(!Number.isSafeInteger(index)) return false;
    const accessor=accessors[index],view=views[accessor?.bufferView],size=components[type];
    if(!accessor || accessor.type!==type || accessor.componentType!==5126 || !Number.isSafeInteger(accessor.count) || accessor.count<1 ||
      accessor.sparse || !view || view.buffer!==0 || !Number.isSafeInteger(view.byteOffset??0) || !Number.isSafeInteger(view.byteLength) ||
      !Number.isSafeInteger(accessor.byteOffset??0) || !Number.isSafeInteger(view.byteStride??size*4)) return false;
    const stride=view.byteStride??size*4,offset=accessor.byteOffset??0,viewOffset=view.byteOffset??0;
    return stride>=size*4 && offset>=0 && viewOffset>=0 && viewOffset+view.byteLength<=binLength &&
      offset+(accessor.count-1)*stride+size*4<=view.byteLength;
  }
  const declared=animations.flatMap(animation=>Array.isArray(animation?.channels)?animation.channels:[]);
  const valid=animations.some(animation=>Array.isArray(animation?.channels) && animation.channels.some(channel=>{
    if(!Number.isSafeInteger(channel?.sampler)) return false;
    const sampler=animation.samplers?.[channel?.sampler],target=channel?.target;
    if(!sampler || !target || !Number.isSafeInteger(target.node) || !nodes[target.node]) return false;
    if(!storedFloat(sampler.input,'SCALAR')) return false;
    const interpolation=sampler.interpolation??'LINEAR';
    if(!['LINEAR','STEP','CUBICSPLINE'].includes(interpolation)) return false;
    const samples=accessors[sampler.input].count*(interpolation==='CUBICSPLINE'?3:1);
    if(target.path==='translation' || target.path==='scale') return storedFloat(sampler.output,'VEC3') && accessors[sampler.output].count===samples;
    if(target.path==='rotation') return storedFloat(sampler.output,'VEC4') && accessors[sampler.output].count===samples;
    if(target.path==='weights') return ['SCALAR','VEC2','VEC3','VEC4'].some(type=>storedFloat(sampler.output,type)) && accessors[sampler.output].count>=samples;
    return false;
  }));
  return {
    ...(valid || declared.length===0 ? {sourceTracks:{value:valid,evidence:evidence('animations')}} : {}),
    skeletonPresent:{value:Array.isArray(doc.skins) && doc.skins.length>0,evidence:evidence('skins')}
  };
}

export function indexGLBDependencies({doc, bytes, relative, key, sourceSha256, maxRecords=10000}) {
  const meshes=array(doc.meshes,'meshes'), materials=array(doc.materials,'materials');
  const textures=array(doc.textures,'textures'), images=array(doc.images,'images');
  const nodes=array(doc.nodes,'nodes'), scenes=array(doc.scenes,'scenes');
  const bufferViews=array(doc.bufferViews,'bufferViews');
  const primitiveCount=meshes.reduce((count,mesh)=>count+array(mesh?.primitives,'mesh primitives').length,0);
  if(meshes.length+primitiveCount+materials.length+textures.length+images.length+nodes.length+scenes.length>maxRecords)
    throw Error('GLB dependency index budget exceeded');
  const fileId=`mesh-${key}`, id=(type,...indices)=>`gltf-${type}-${key}-${indices.join('-')}`;
  const base=(type,index,source,internalLocation)=>({
    id:id(type,index), name:display(source.name,type,index), type,
    category:'model', originalName:typeof source.name==='string'?source.name:'',
    sourceFileSha256:sourceSha256, definitionSha256:definitionHash(source),
    internalLocation, derivedFrom:fileId,
    provenance:{sourceFile:relative,internalLocation,evidence:'embedded glTF JSON definition'}
  });
  const sceneRecords=scenes.map((scene,i)=>({
    ...base('scene',i,scene,location('scenes',i)),
    rootNodeIds:array(scene.nodes,'scene nodes').map(n=>{at(nodes,n,'scene root node');return id('node',n);})
  }));
  const parents=Array(nodes.length).fill(null);
  for (const [parent,node] of nodes.entries()) for (const child of array(node.children,'node children')) {
    at(nodes,child,'child node');
    if (parents[child]!==null) throw Error(`glTF node ${child} has more than one parent`);
    parents[child]=parent;
  }
  const visiting=new Set(),visited=new Set();
  function visit(n) { if(visiting.has(n)) throw Error('glTF node hierarchy has a cycle');
    if(visited.has(n)) return; visiting.add(n);
    for(const child of nodes[n].children||[]) visit(child);
    visiting.delete(n);visited.add(n);
  }
  nodes.forEach((_,i)=>visit(i));
  const nodeRecords=nodes.map((node,i)=>{
    const meshId=node.mesh===undefined?null:(at(meshes,node.mesh,'node mesh'),id('mesh-definition',node.mesh));
    const childNodeIds=(node.children||[]).map(n=>id('node',n));
    return {...base('node',i,node,location('nodes',i)),meshId,
      primitiveIds:node.mesh===undefined?[]:meshes[node.mesh].primitives.map((_,j)=>id('primitive',node.mesh,j)),
      parentNodeId:parents[i]===null?null:id('node',parents[i]),childNodeIds,
      rootSceneIds:scenes.flatMap((s,j)=>(s.nodes||[]).includes(i)?[id('scene',j)]:[]),
      transform:node.matrix!==undefined?{matrix:node.matrix}:{translation:node.translation||[0,0,0],rotation:node.rotation||[0,0,0,1],scale:node.scale||[1,1,1]}
    };
  });
  const primitiveRecords=[];
  const meshRecords=meshes.map((mesh,i)=>{
    const primitives=array(mesh.primitives,'mesh primitives');
    for (const [j,primitive] of primitives.entries()) {
      const materialId=primitive.material===undefined?null:(at(materials,primitive.material,'primitive material'),id('material',primitive.material));
      primitiveRecords.push({
        ...base('primitive',`${i}-${j}`,primitive,location('meshes',i,'primitives',j)),
        meshDefinitionId:id('mesh-definition',i),materialId,
        materialBinding:materialId?'explicit':'glTF default material; no indexed definition',
        mode:primitive.mode??4,
        nodeIds:nodes.flatMap((node,n)=>node.mesh===i?[id('node',n)]:[])
      });
    }
    return {...base('mesh-definition',i,mesh,location('meshes',i)),
      primitiveIds:primitives.map((_,j)=>id('primitive',i,j)),
      nodeIds:nodes.flatMap((node,n)=>node.mesh===i?[id('node',n)]:[])};
  });
  const materialRecords=materials.map((material,i)=>{
    const textureUsages=[];
    for (const [slot,read] of MATERIAL_SLOTS) {
      const ref=read(material); if(ref===undefined) continue;
      if(!ref || typeof ref!=='object' || Array.isArray(ref)) throw Error(`Invalid glTF material texture slot: ${i}/${slot}`);
      at(textures,ref.index,'material texture');
      textureUsages.push({slot,textureId:id('texture',ref.index),texCoord:ref.extensions?.KHR_texture_transform?.texCoord??ref.texCoord??0});
    }
    return {...base('material',i,material,location('materials',i)),textureUsages,
      textureLinks:[...new Set(textureUsages.map(u=>u.textureId))],
      primitiveIds:primitiveRecords.filter(p=>p.materialId===id('material',i)).map(p=>p.id)};
  });
  const textureRecords=textures.map((texture,i)=>{
    const imageId=texture.source===undefined?null:(at(images,texture.source,'texture image'),id('image',texture.source));
    if(!imageId && !Object.keys(texture.extensions||{}).length) throw Error(`glTF texture ${i} has no image source`);
    return {...base('texture',i,texture,location('textures',i)),imageId,
      imageBinding:imageId?'core glTF image reference':'extension-only; image reference not indexed',
      materialIds:materialRecords.filter(m=>m.textureLinks.includes(id('texture',i))).map(m=>m.id),
      samplerIndex:texture.sampler??null};
  });
  const binHeader=20+bytes.readUInt32LE(12),binStart=binHeader+8,binLength=bytes.readUInt32LE(binHeader);
  const imageRecords=images.map((source,i)=>{
    let imageBytes,mimeType=source.mimeType;
    if(source.bufferView!==undefined){
      const view=at(bufferViews,source.bufferView,'image bufferView');
      if(view.buffer!==0 || !Number.isSafeInteger(view.byteOffset??0) || !Number.isSafeInteger(view.byteLength) ||
        (view.byteOffset??0)<0 || view.byteLength<0 || (view.byteOffset??0)+view.byteLength>binLength) throw Error('Invalid glTF image bufferView range');
      imageBytes=bytes.subarray(binStart+(view.byteOffset??0),binStart+(view.byteOffset??0)+view.byteLength);
    } else if(typeof source.uri==='string') {
      const match=IMAGE_URI.exec(source.uri);if(!match)throw Error('Unsupported glTF image URI');
      mimeType=match[1];imageBytes=Buffer.from(match[2],'base64');
    } else throw Error('glTF image has no embedded source');
    return {...base('image',i,source,location('images',i)),mimeType,byteLength:imageBytes.length,
      contentSha256:sha256(imageBytes),
      embeddedAt:source.bufferView===undefined?'data URI':location('bufferViews',source.bufferView),
      textureIds:textures.flatMap((t,j)=>t.source===i?[id('texture',j)]:[])};
  });
  const assets=[...meshRecords,...primitiveRecords,...materialRecords,...textureRecords,...imageRecords,...nodeRecords,...sceneRecords];
  const ids=new Set([fileId,...assets.map(a=>a.id)]);
  for(const asset of assets) for(const [name,value] of Object.entries(asset)) if(name.endsWith('Id') && value!==null && !ids.has(value) || name.endsWith('Ids') && Array.isArray(value) && value.some(v=>!ids.has(v))) throw Error(`Unresolved internal glTF reference: ${asset.id}.${name}`);
  const summary={meshDefinitions:meshRecords.length,primitiveDefinitions:primitiveRecords.length,
    materialDefinitions:materialRecords.length,textureDefinitions:textureRecords.length,imageDefinitions:imageRecords.length,
    nodeDefinitions:nodeRecords.length,sceneDefinitions:sceneRecords.length,
    meshNodeInstances:nodeRecords.filter(n=>n.meshId!==null).length,
    primitiveNodeInstances:nodeRecords.reduce((count,n)=>count+n.primitiveIds.length,0)};
  return {assets,summary,animationFacts:glTFAnimationFacts(doc,bytes,sourceSha256),links:{meshDefinitionIds:meshRecords.map(a=>a.id),primitiveIds:primitiveRecords.map(a=>a.id),
    materialIds:materialRecords.map(a=>a.id),textureIds:textureRecords.map(a=>a.id),imageIds:imageRecords.map(a=>a.id),
    nodeIds:nodeRecords.map(a=>a.id),sceneIds:sceneRecords.map(a=>a.id)}};
}
