// Bounded glTF 2.0 material viewer. Sidecar animation requires separate evidence.
// Skin evaluation follows Khronos glTF 2.0 §3.7.3.
// No libraries, original game code, or external services.
// Lighting profiles are browser approximations, not source-engine shaders.
// Deliberately bounded preview subset, not a complete glTF implementation. Per model.
export const PREVIEW_LIMITS=Object.freeze({downloadBytes:64*1024*1024,jsonBytes:8*1024*1024,accessorValues:8*1024*1024,nodes:4096,depth:128,materials:2048,images:128,imageBytes:32*1024*1024,imagePixels:32*1024*1024,imageDimension:8192,primitives:4096,vertices:1000000,indices:3000000});
// Only these required semantics are implemented; optional unknown semantics warn.
export const SUPPORTED_REQUIRED_EXTENSIONS=Object.freeze(['KHR_materials_unlit','KHR_materials_emissive_strength']);
function budget(value,max,label){if(!Number.isSafeInteger(value)||value<0||value>max)throw Error('Preview budget exceeded: '+label);return value;}
export async function readBoundedResponse(response,limit=PREVIEW_LIMITS.downloadBytes){
  const declared=response.headers.get('content-length');
  if(declared!==null&&Number(declared)>limit){await response.body?.cancel();throw Error('Preview budget exceeded: download bytes');}
  if(!response.body?.getReader)throw Error('Bounded streaming response required');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;budget(size,limit,'download bytes');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes.buffer;
}
// Inspect dimensions before invoking any browser image decoder. PNG/JPEG only.
export function imageDimensions(buffer,mime){
  const b=new Uint8Array(buffer),v=new DataView(buffer);let width,height;
  if(mime==='image/png'&&b.length>=24&&v.getUint32(0)===0x89504e47&&v.getUint32(4)===0x0d0a1a0a&&v.getUint32(8)===13&&v.getUint32(12)===0x49484452){width=v.getUint32(16);height=v.getUint32(20);}
  else if(mime==='image/jpeg'&&b[0]===255&&b[1]===216){
    let o=2;while(o+4<=b.length){if(b[o++]!==255)throw Error('Invalid JPEG header');while(b[o]===255)o++;const marker=b[o++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;const n=v.getUint16(o);if(n<2||o+n>b.length)throw Error('Invalid JPEG segment');if([0xc0,0xc1,0xc2].includes(marker)){if(n<8)throw Error('Invalid JPEG frame');height=v.getUint16(o+3);width=v.getUint16(o+5);break;}o+=n;}
  }
  if(!width||!height)throw Error('Unsupported or invalid embedded image; PNG/JPEG required');
  budget(width,PREVIEW_LIMITS.imageDimension,'image width');budget(height,PREVIEW_LIMITS.imageDimension,'image height');return {width,height,pixels:width*height};
}
const identity = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const finite = (v,fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const normalize = v => { const l=Math.hypot(...v); return l>1e-12 ? v.map(x=>x/l) : [0,1,0]; };
const activeViewers = new WeakMap();
// Private parse data cannot be confused with or mutate immutable card/rest geometry.
const geometrySources = new WeakMap();
const defaultCamera = {yaw:0.6,pitch:-0.18,zoom:3.8};
function multiply(a,b) {
  const out=Array(16).fill(0);
  for(let c=0;c<4;c++) for(let r=0;r<4;r++) for(let k=0;k<4;k++) out[c*4+r]+=a[k*4+r]*b[c*4+k];
  return out;
}
function nodeMatrix(node) {
  if(node.matrix) return node.matrix;
  const [x,y,z,w]=node.rotation||[0,0,0,1],s=node.scale||[1,1,1],t=node.translation||[0,0,0];
  return [(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,
    (2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,
    (2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,...t,1];
}
function transformPoint(p,m) {
  return [p[0]*m[0]+p[1]*m[4]+p[2]*m[8]+m[12],p[0]*m[1]+p[1]*m[5]+p[2]*m[9]+m[13],p[0]*m[2]+p[1]*m[6]+p[2]*m[10]+m[14]];
}
function normalMatrix(m) {
  const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10];
  const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  if(Math.abs(det)<1e-12) return {matrix:[1,0,0,0,1,0,0,0,1],det};
  return {matrix:[e*i-f*h,c*h-b*i,b*f-c*e, f*g-d*i,a*i-c*g,c*d-a*f, d*h-e*g,b*g-a*h,a*e-b*d].map(x=>x/det),det};
}
function transformNormal(n,m) {
  return normalize([m[0]*n[0]+m[3]*n[1]+m[6]*n[2],m[1]*n[0]+m[4]*n[1]+m[7]*n[2],m[2]*n[0]+m[5]*n[1]+m[8]*n[2]]);
}
function vec(value,length,fallback) {
  return Array.from({length},(_,i)=>finite(value?.[i],fallback[i]));
}
function textureInfo(info) {
  if(!info) return null;
  const t=info.extensions?.KHR_texture_transform||{},scale=t.scale||[1,1],offset=t.offset||[0,0],angle=t.rotation||0,c=Math.cos(angle),s=Math.sin(angle);
  return {index:info.index,texCoord:t.texCoord??info.texCoord??0,transform:[c*scale[0],s*scale[0],0,-s*scale[1],c*scale[1],0,...offset,1]};
}
function readMaterial(source={},index=-1) {
  const pbr=source.pbrMetallicRoughness||{},extensions=source.extensions||{};
  return {index,name:source.name||'glTF 默认材质',baseColor:vec(pbr.baseColorFactor,4,[1,1,1,1]),
    baseColorTexture:textureInfo(pbr.baseColorTexture),emissiveTexture:textureInfo(source.emissiveTexture),
    metallicRoughnessTexture:textureInfo(pbr.metallicRoughnessTexture),
    metallic:clamp(finite(pbr.metallicFactor,1),0,1),roughness:clamp(finite(pbr.roughnessFactor,1),0.04,1),
    emissive:vec(source.emissiveFactor,3,[0,0,0]).map(x=>x*finite(extensions.KHR_materials_emissive_strength?.emissiveStrength,1)),
    alphaMode:['OPAQUE','MASK','BLEND'].includes(source.alphaMode)?source.alphaMode:'OPAQUE',
    alphaCutoff:clamp(finite(source.alphaCutoff,0.5),0,1),doubleSided:!!source.doubleSided,unlit:!!extensions.KHR_materials_unlit,
    extras:source.extras||{},userData:source.userData||{},source};
}

// World-space LBS: weighted(jointWorld * inverseBind). The mesh-node transform
// is deliberately ignored for skins, as required by glTF 2.0 section 3.7.3.2.
function skinPalette(skin,world) {
  return skin.joints.map((node,i)=>multiply(world(node),skin.inverseBindMatrices[i]));
}
function blendedSkinMatrices(skin,palette) {
  return skin.influences.map(influence=>{
    const matrix=Array(16).fill(0);
    for(const [joint,weight]of influence)for(let k=0;k<16;k++)matrix[k]+=palette[joint][k]*weight;
    return {matrix,normal:normalMatrix(matrix).matrix};
  });
}
function poseVertices(positions,normals,localPositions,localNormals,matrix,skin,palette,center=[0,0,0],scale=1) {
  const matrices=skin?blendedSkinMatrices(skin,palette):null,nm=skin?null:normalMatrix(matrix).matrix;
  for(let j=0;j<localPositions.length;j+=3) {
    const transform=skin?matrices[skin.vertexInfluences[j/3]]:null;
    const position=transformPoint(localPositions.subarray(j,j+3),transform?transform.matrix:matrix);
    if(!position.every(Number.isFinite))throw Error('骨骼/节点变换产生无效位置');
    for(let k=0;k<3;k++)positions[j+k]=(position[k]-center[k])*scale;
    if(localNormals)normals.set(transformNormal(localNormals.subarray(j,j+3),transform?transform.normal:nm),j);
  }
}

// Exported separately so the exact browser parser can be validated on real assets in Node.
export function parseGLB(input) {
  budget(input?.byteLength,PREVIEW_LIMITS.downloadBytes,'model bytes');
  const buffer=input instanceof ArrayBuffer?input:input?.buffer?.slice(input.byteOffset,input.byteOffset+input.byteLength);
  if(!buffer||buffer.byteLength<20) throw Error('模型文件不完整');
  const header=new DataView(buffer);
  if(header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2) throw Error('预览文件不是有效 GLB 2.0');
  if(header.getUint32(8,true)!==buffer.byteLength) throw Error('GLB 长度与文件不符');
  let json,bin;
  for(let offset=12;offset<buffer.byteLength;) {
    if(offset+8>buffer.byteLength) throw Error('GLB 区块头不完整');
    const length=header.getUint32(offset,true),type=header.getUint32(offset+4,true);offset+=8;
    if(offset+length>buffer.byteLength) throw Error('GLB 区块越界');
    if(type===0x4e4f534a) budget(length,PREVIEW_LIMITS.jsonBytes,'JSON bytes');
    if(type===0x4e4f534a) json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,offset,length)).replace(/\0+$/,''));
    if(type===0x004e4942) bin=buffer.slice(offset,offset+length);
    offset+=length;
  }
  if(!json||!bin) throw Error('模型缺少 JSON 或内嵌二进制数据');
  const warnings=[];
  for(const key of ['extensionsRequired','extensionsUsed'])if(json[key]!==undefined&&(!Array.isArray(json[key])||json[key].some(x=>typeof x!=='string')))throw Error('Invalid extension declaration');
  for(const extension of json.extensionsRequired||[])if(!SUPPORTED_REQUIRED_EXTENSIONS.includes(extension))throw Error('Unsupported required extension: '+extension);
  for(const extension of json.extensionsUsed||[])if(!SUPPORTED_REQUIRED_EXTENSIONS.includes(extension))warnings.push('Unsupported optional extension: '+extension);
  for(const [key,max] of Object.entries({nodes:PREVIEW_LIMITS.nodes,materials:PREVIEW_LIMITS.materials,images:PREVIEW_LIMITS.images,meshes:4096,accessors:16384,bufferViews:16384,textures:4096,skins:1024,animations:1024,scenes:1024,samplers:4096})){
    if(json[key]!==undefined&&!Array.isArray(json[key]))throw Error('Invalid model collection: '+key);budget((json[key]||[]).length,max,key);
  }
  // These source-engine hints change geometry/visibility semantics outside glTF.
  // Reject rather than silently drawing a misleading rigid or visible fallback.
  if((json.nodes||[]).some(node=>Object.hasOwn(node.extras||{},'sourceActive'))||(json.meshes||[]).some(mesh=>Object.hasOwn(mesh.extras||{},'rendererType')))throw Error('模型包含未转换的源引擎可见性或渲染器类型');
  let imageBytes=0,imagePixels=0,vertexTotal=0,indexTotal=0,primitiveTotal=0;
  const dimensions={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
  const componentSizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
  let accessorValues=0;
  for(const a of json.accessors||[]){const n=dimensions[a.type];if(!n||!componentSizes[a.componentType])throw Error('Invalid accessor type');budget(a.count,PREVIEW_LIMITS.accessorValues,'accessor count');accessorValues+=a.count*n;budget(accessorValues,PREVIEW_LIMITS.accessorValues,'aggregate accessor values');}
  const view=new DataView(bin),cache=new Map();
  function scalar(offset,type,normalized=false) {
    let v;
    if(type===5126) v=view.getFloat32(offset,true);
    else if(type===5125) v=view.getUint32(offset,true);
    else if(type===5123) v=view.getUint16(offset,true);
    else if(type===5122) v=view.getInt16(offset,true);
    else if(type===5121) v=view.getUint8(offset);
    else if(type===5120) v=view.getInt8(offset);
    else throw Error('不支持的顶点数值类型');
    if(normalized&&type!==5126) v=type===5120?Math.max(v/127,-1):type===5122?Math.max(v/32767,-1):v/({5121:255,5123:65535,5125:4294967295}[type]);
    if(!Number.isFinite(v)) throw Error('模型含无效顶点数值');
    return v;
  }
  function bufferView(index) {
    const v=json.bufferViews?.[index];
    if(!v||(v.buffer||0)!==0||!Number.isSafeInteger(v.byteOffset??0)||!Number.isSafeInteger(v.byteLength)||(v.byteOffset||0)<0||v.byteLength<0||(v.byteOffset||0)+v.byteLength>bin.byteLength) throw Error('模型缓冲区引用无效');
    return v;
  }
  function access(index) {
    if(cache.has(index)) return cache.get(index);
    const a=json.accessors?.[index];
    if(!a) throw Error('模型顶点属性引用无效');
    const size=componentSizes[a.componentType],n=dimensions[a.type];
    if(!size||!n||!Number.isSafeInteger(a.count)||a.count<0||a.count*n>PREVIEW_LIMITS.accessorValues) throw Error('模型顶点属性格式无效或超出预览限制');
    const out=new Float64Array(a.count*n);
    if(a.bufferView!==undefined) {
      const v=bufferView(a.bufferView),start=(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||n*size;
      if(!Number.isSafeInteger(stride)||!Number.isSafeInteger(a.byteOffset??0)||stride<n*size||(a.byteOffset||0)<0||a.count&&start+(a.count-1)*stride+n*size>(v.byteOffset||0)+v.byteLength) throw Error('模型顶点属性越界');
      for(let j=0;j<a.count;j++) for(let k=0;k<n;k++) out[j*n+k]=scalar(start+j*stride+k*size,a.componentType,a.normalized);
    }
    if(a.sparse) {
      const sparse=a.sparse,iv=bufferView(sparse.indices.bufferView),vv=bufferView(sparse.values.bufferView),type=sparse.indices.componentType,bytes=componentSizes[type];
      if(![5121,5123,5125].includes(type)||!Number.isSafeInteger(sparse.count)||sparse.count<0||sparse.count>a.count||!Number.isSafeInteger(sparse.indices.byteOffset??0)||(sparse.indices.byteOffset||0)<0||!Number.isSafeInteger(sparse.values.byteOffset??0)||(sparse.values.byteOffset||0)<0) throw Error('模型稀疏属性无效');
      const ip=(iv.byteOffset||0)+(sparse.indices.byteOffset||0),vp=(vv.byteOffset||0)+(sparse.values.byteOffset||0);
      if(ip+sparse.count*bytes>(iv.byteOffset||0)+iv.byteLength||vp+sparse.count*n*size>(vv.byteOffset||0)+vv.byteLength) throw Error('模型稀疏属性越界');
      for(let j=0;j<sparse.count;j++) {
        const dest=scalar(ip+j*bytes,type);
        if(dest>=a.count) throw Error('模型稀疏索引越界');
        for(let k=0;k<n;k++) out[dest*n+k]=scalar(vp+(j*n+k)*size,a.componentType,a.normalized);
      }
    }
    const result={data:out,size:n,count:a.count};cache.set(index,result);return result;
  }
  const materials=(json.materials||[]).map(readMaterial),fallback=readMaterial();
  const images=(json.images||[]).map(image=>{
    let bytes,mimeType=image.mimeType;
    if(image.bufferView!==undefined){const v=bufferView(image.bufferView);imageBytes+=v.byteLength;budget(imageBytes,PREVIEW_LIMITS.imageBytes,'aggregate image bytes');bytes=bin.slice(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);}
    else if(typeof image.uri==='string'&&image.uri.startsWith('data:')){
      const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(image.uri);if(!match)throw Error('Unsupported image data URI');
      mimeType=match[1];imageBytes+=Math.floor(match[2].length*3/4);budget(imageBytes,PREVIEW_LIMITS.imageBytes,'aggregate image bytes');bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0)).buffer;
    }else throw Error('External images are not supported');
    const dimensions=imageDimensions(bytes,mimeType);imagePixels+=dimensions.pixels;budget(imagePixels,PREVIEW_LIMITS.imagePixels,'aggregate image pixels');
    return {name:image.name||'',mimeType,bytes,...dimensions};
  });
  const textures=(json.textures||[]).map(texture=>({source:texture.source,sampler:json.samplers?.[texture.sampler]||{}}));
  let nodeVisits=0;
  const instances=[],nodeWorlds=new Map(),nodeParents=new Map();
  function visit(index,parent,ancestors=new Set(),parentIndex=null) {
    budget(++nodeVisits,PREVIEW_LIMITS.nodes,'node visits');
    budget(ancestors.size,PREVIEW_LIMITS.depth,'node depth');
    const node=json.nodes?.[index];
    if(!node||ancestors.has(index)) throw Error('模型节点层级无效');
    const local=nodeMatrix(node);
    if(local.length!==16||!local.every(Number.isFinite)) throw Error('模型节点变换无效');
    if(nodeWorlds.has(index)) throw Error('模型节点有多个父层级');
    const world=multiply(parent,local),next=new Set(ancestors);next.add(index);nodeWorlds.set(index,world);nodeParents.set(index,parentIndex);
    if(node.mesh!==undefined) instances.push({mesh:node.mesh,world,node,index});
    if(node.skin!==undefined) warnings.push('关节、权重与逆绑定矩阵驱动蒙皮；不执行额外的运行时约束或脚本');
    for(const child of node.children||[]) visit(child,world,next,index);
  }
  const scene=json.scenes?.[json.scene??0];
  if(scene) for(const root of scene.nodes||[]) visit(root,identity());
  else if(json.nodes?.length) {
    const children=new Set(json.nodes.flatMap(node=>node.children||[]));
    json.nodes.forEach((_,i)=>{if(!children.has(i))visit(i,identity());});
  } else (json.meshes||[]).forEach((_,mesh)=>instances.push({mesh,world:identity(),node:{},index:-1}));
  let jointTotal=0;
  const skins=(json.skins||[]).map((skin,index)=>{
    jointTotal+=skin.joints?.length||0;budget(jointTotal,65536,'aggregate skin joints');
    if(!Array.isArray(skin.joints)||!skin.joints.length||new Set(skin.joints).size!==skin.joints.length||skin.joints.some(j=>!Number.isSafeInteger(j)||!nodeWorlds.has(j)))throw Error('蒙皮关节层级引用无效');
    let matrices=skin.joints.map(identity);
    if(skin.inverseBindMatrices!==undefined){const a=access(skin.inverseBindMatrices);if(a.size!==16||a.count<skin.joints.length||json.accessors[skin.inverseBindMatrices].componentType!==5126)throw Error('逆绑定矩阵格式或数量无效');matrices=skin.joints.map((_,i)=>Array.from(a.data.subarray(i*16,(i+1)*16)));}
    if(matrices.some(m=>Math.abs(m[3])+Math.abs(m[7])+Math.abs(m[11])+Math.abs(m[15]-1)>1e-5))throw Error('逆绑定矩阵不是仿射矩阵');
    if(skin.skeleton!==undefined&&(!nodeWorlds.has(skin.skeleton)||skin.joints.some(j=>{while(j!==null&&j!==undefined){if(j===skin.skeleton)return false;j=nodeParents.get(j)}return true})))throw Error('蒙皮 skeleton 不是所有关节的共同祖先');
    return {index,joints:skin.joints.slice(),inverseBindMatrices:matrices,source:skin.extras||{}};
  });
  function primitiveSkin(instance,attr,count){
    if(instance.node.skin===undefined)return null;
    const skin=skins[instance.node.skin];if(!skin)throw Error('网格引用了缺失的 skin');
    const groups=[],keys=Object.keys(attr).filter(k=>/^JOINTS_\d+$/.test(k)).sort();
    budget(keys.length,8,'skin influence groups');
    if(!keys.length||!keys.includes('JOINTS_0'))throw Error('蒙皮缺少真实 JOINTS_0 / WEIGHTS_0');
    for(const key of keys){const j=access(attr[key]),w=access(attr[key.replace('JOINTS_','WEIGHTS_')]);if(j.count!==count||w.count!==count||j.size!==4||w.size!==4)throw Error('蒙皮关节或权重维数不匹配');groups.push({j:j.data,w:w.data});}
    const influences=[],lookup=new Map(),vertexInfluences=new Uint32Array(count);let maxWeightSumError=0;
    for(let v=0;v<count;v++){
      const influence=[];let sum=0;
      for(const g of groups)for(let k=0;k<4;k++){const joint=g.j[v*4+k],weight=g.w[v*4+k];if(!Number.isInteger(joint)||joint<0||joint>=skin.joints.length||weight<0||weight>1.00001)throw Error('蒙皮关节索引或权重无效');if(weight>0){influence.push([joint,weight]);sum+=weight;}}
      maxWeightSumError=Math.max(maxWeightSumError,Math.abs(sum-1));if(Math.abs(sum-1)>0.002)throw Error('蒙皮权重未归一化，拒绝静默替代');
      // Preserve source floating-point weights exactly; no invented influences.
      const key=JSON.stringify(influence);if(!lookup.has(key)){lookup.set(key,influences.length);influences.push(influence)}vertexInfluences[v]=lookup.get(key);
    }
    return {...skin,influences,vertexInfluences,maxWeightSumError};
  }
  const primitives=[],restPrimitives=[],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const instance of instances) {
    const mesh=json.meshes?.[instance.mesh];if(!mesh) throw Error('模型网格引用无效');
    const nm=normalMatrix(instance.world);
    for(const primitive of mesh.primitives||[]) {
      budget(++primitiveTotal,PREVIEW_LIMITS.primitives,'instanced primitives');
      const mode=primitive.mode??4;
      if(![4,5,6].includes(mode)){warnings.push('点或线拓扑未显示');continue;}
      if(primitive.targets?.length) warnings.push('形态目标以基础静态几何显示');
      const attr=primitive.attributes||{},pos=access(attr.POSITION);
      if(pos.size!==3) throw Error('模型位置属性必须是 VEC3');
      vertexTotal+=pos.count;budget(vertexTotal,PREVIEW_LIMITS.vertices,'instanced vertices');
      const skinData=primitiveSkin(instance,attr,pos.count);
      const sourceIndices=primitive.indices!==undefined?access(primitive.indices).data:Array.from({length:pos.count},(_,i)=>i);
      for(const index of sourceIndices) if(!Number.isInteger(index)||index<0||index>=pos.count) throw Error('模型三角形索引越界');
      indexTotal+=mode===4?sourceIndices.length:Math.max(0,sourceIndices.length-2)*3;budget(indexTotal,PREVIEW_LIMITS.indices,'expanded indices');
      const indices=[];
      if(mode===4) {
        if(sourceIndices.length%3) throw Error('模型三角形索引数无效');
        for(const value of sourceIndices) indices.push(value);
      } else for(let j=2;j<sourceIndices.length;j++) {
        const a=mode===6?sourceIndices[0]:sourceIndices[j-2],b=sourceIndices[j-1],c=sourceIndices[j];
        if(a!==b&&b!==c&&a!==c) indices.push(...(mode===5&&j%2?[b,a,c]:[a,b,c]));
      }
      const localIndices=new Uint32Array(indices);
      if(!skinData&&nm.det<0) for(let j=0;j<indices.length;j+=3) [indices[j+1],indices[j+2]]=[indices[j+2],indices[j+1]];
      const positions=new Float32Array(pos.count*3);
      poseVertices(positions,null,pos.data,null,instance.world,skinData,skinData?skinPalette(skinData,j=>nodeWorlds.get(j)):null);
      const normals=new Float32Array(pos.count*3);let localNormals=null;
      if(attr.NORMAL!==undefined) {
        const source=access(attr.NORMAL);if(source.count!==pos.count||source.size!==3) throw Error('模型法线属性无效');localNormals=source.data;
        poseVertices(positions,normals,pos.data,source.data,instance.world,skinData,skinData?skinPalette(skinData,j=>nodeWorlds.get(j)):null);
      } else {
        for(let j=0;j<indices.length;j+=3) {
          const a=indices[j]*3,b=indices[j+1]*3,c=indices[j+2]*3;
          const ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2],vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
          const n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
          for(const k of [a,b,c]) for(let axis=0;axis<3;axis++) normals[k+axis]+=n[axis];
        }
        for(let j=0;j<pos.count;j++) normals.set(normalize(Array.from(normals.subarray(j*3,j*3+3))),j*3);
      }
      const uv=new Float32Array(pos.count*2),colors=new Float32Array(pos.count*4).fill(1);
      if(attr.TEXCOORD_0!==undefined) {
        const source=access(attr.TEXCOORD_0);if(source.count!==pos.count||source.size!==2) throw Error('模型 UV 属性无效');uv.set(source.data);
      }
      if(attr.COLOR_0!==undefined) {
        const source=access(attr.COLOR_0);if(source.count!==pos.count||![3,4].includes(source.size)) throw Error('模型顶点颜色属性无效');
        for(let j=0;j<pos.count;j++) for(let k=0;k<source.size;k++) colors[j*4+k]=source.data[j*source.size+k];
      }
      if(!indices.length) continue;
      const material=primitive.material===undefined?fallback:materials[primitive.material];if(!material) throw Error('模型材质引用无效');
      for(const info of [material.baseColorTexture,material.emissiveTexture,material.metallicRoughnessTexture]) if(info&&info.texCoord!==0) warnings.push('当前仅支持 UV0，其他 UV 通道的贴图未应用');
      if(material.source.normalTexture) warnings.push('法线贴图暂未应用；保留模型源法线');
      for(const index of indices) for(let axis=0;axis<3;axis++) {const v=positions[index*3+axis];if(!Number.isFinite(v))throw Error('节点变换产生无效位置');min[axis]=Math.min(min[axis],v);max[axis]=Math.max(max[axis],v);}
      restPrimitives.push({nodeIndex:instance.index,localPositions:pos.data,localNormals,localIndices,skin:instance.node.skin,skinData,morph:!!primitive.targets?.length});
      primitives.push({positions,normals,uv,colors,indices:new Uint32Array(indices),visible:true,material,nodeName:instance.node.name||mesh.name||'',nodeIndex:instance.index,extras:primitive.extras||{},sourceAttributes:Object.keys(attr)});
    }
  }
  if(!primitives.length||!min.every(Number.isFinite)) throw Error('模型没有可绘制的三角形');
  const center=min.map((v,i)=>(v+max[i])/2),scale=2/Math.max(...max.map((v,i)=>v-min[i]),1e-5);
  let triangles=0,vertices=0;
  for(const primitive of primitives) {
    const p=primitive.positions;
    for(let j=0;j<p.length;j++) p[j]=(p[j]-center[j%3])*scale;
    const pc=[0,0,0];for(const index of primitive.indices) for(let k=0;k<3;k++)pc[k]+=p[index*3+k];
    primitive.center=pc.map(v=>v/primitive.indices.length);triangles+=primitive.indices.length/3;vertices+=p.length/3;
  }
  const geometry={primitives,materials,images,textures,warnings:[...new Set(warnings)],bounds:{min,max,center,scale},triangles,vertices,extras:json.extras||{},asset:json.asset};
  geometry.skinSummary={skins:skins.length,skinnedPrimitives:restPrimitives.filter(p=>p.skinData).length,joints:skins.reduce((n,s)=>n+s.joints.length,0),weightSumMaxError:Math.max(0,...restPrimitives.filter(p=>p.skinData).map(p=>p.skinData.maxWeightSumError))};
  geometrySources.set(geometry,{nodes:json.nodes||[],nodeWorlds,nodeParents,restPrimitives});
  return geometry;
}
export async function loadGeometry(source,{signal}={}) {
  if(source instanceof ArrayBuffer||ArrayBuffer.isView(source)) return parseGLB(source);
  const response=await fetch(source,{signal,redirect:'error'});
  if(!response.ok) throw Error('模型文件读取失败 ('+response.status+')');
  return parseGLB(await readBoundedResponse(response));
}

// Sidecars are data, never executable animation/controller scripts. Binding is by
// source object identity AND GLB index; names and hierarchy-path guesses are banned.
const trackDimensions={translation:3,rotation:4,scale:3};
function numericArray(value,length,label) {
  if(!Array.isArray(value)||value.length!==length||!value.every(Number.isFinite))throw Error(label+' 含无效数值');
  return value.slice();
}
function quaternion(value) {
  const length=Math.hypot(...value);
  if(!Number.isFinite(length)||length<1e-10)throw Error('动画四元数不能归一化');
  return value.map(x=>x/length);
}
function slerp(a,b,t) {
  a=quaternion(a);b=quaternion(b);
  let dot=a.reduce((sum,x,i)=>sum+x*b[i],0);
  if(dot<0){b=b.map(x=>-x);dot=-dot;}
  if(dot>.9995)return quaternion(a.map((x,i)=>x+(b[i]-x)*t));
  const angle=Math.acos(clamp(dot,-1,1)),s=Math.sin(angle);
  return a.map((x,i)=>(Math.sin((1-t)*angle)*x+Math.sin(t*angle)*b[i])/s);
}
function keyValues(value,count,dimension,label) {
  if(Array.isArray(value)&&value.length===count&&Array.isArray(value[0]))return value.map(v=>numericArray(v,dimension,label));
  const flat=numericArray(value,count*dimension,label);
  return Array.from({length:count},(_,i)=>flat.slice(i*dimension,(i+1)*dimension));
}
function compileTrack(track,duration,binding) {
  if(track.scalarCurves!==undefined||track.sourceProperty!==undefined||track.sourceStartTime!==undefined||track.reconstruction!==undefined)throw Error('公开预览不支持未转换的源引擎曲线');
  const dimension=trackDimensions[track.path];
  if(!dimension)throw Error('不支持的源动画属性：'+String(track.path));
  const interpolation=track.interpolation;
  if(!['STEP','LINEAR','CUBICSPLINE'].includes(interpolation))throw Error('未验证的源曲线插值：'+String(interpolation));
  if(!Array.isArray(track.times)||!track.times.length||track.times.length>1000000)throw Error('源动画没有有效关键帧');
  const times=numericArray(track.times,track.times.length,'关键帧时间');
  if(times.some((t,i)=>t<0||t>duration+1e-5||(i>0&&t<=times[i-1])))throw Error('关键帧时间顺序或范围无效');
  const values=keyValues(track.values,times.length,dimension,'关键帧值');
  if(track.path==='rotation')for(const value of values)quaternion(value);
  const result={...track,nodeIndex:binding.index,dimension,interpolation,times,values};
  if(interpolation==='CUBICSPLINE') {
    result.inTangents=keyValues(track.inTangents,times.length,dimension,'入切线');
    result.outTangents=keyValues(track.outTangents,times.length,dimension,'出切线');
  }
  return result;
}
function sampleTrack(track,time) {
  const {times,values,interpolation,path}=track,last=times.length-1;
  let result;
  if(time<=times[0])result=values[0].slice();
  else if(time>=times[last])result=values[last].slice();
  else {
    let lo=0,hi=last;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(times[mid]<=time)lo=mid;else hi=mid;}
    const dt=times[hi]-times[lo],t=(time-times[lo])/dt,a=values[lo],b=values[hi];
    if(interpolation==='STEP')result=a.slice();
    else if(interpolation==='LINEAR')result=path==='rotation'?slerp(a,b,t):a.map((x,i)=>x+(b[i]-x)*t);
    else {
      const t2=t*t,t3=t2*t;
      result=a.map((x,i)=>(2*t3-3*t2+1)*x+(t3-2*t2+t)*dt*track.outTangents[lo][i]+(-2*t3+3*t2)*b[i]+(t3-t2)*dt*track.inTangents[hi][i]);
    }
  }
  if(!result.every(Number.isFinite))throw Error('源曲线采样产生无效数值');
  return path==='rotation'?quaternion(result):result;
}

function includeVisibleTriangleBounds(primitive,min,max) {
  if(primitive.visible===false)return;
  const p=primitive.positions,indices=primitive.indices;
  for(let j=0;j<indices.length;j+=3) {
    const a=indices[j]*3,b=indices[j+1]*3,c=indices[j+2]*3;
    const u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]],v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]];
    const area2=(u[1]*v[2]-u[2]*v[1])**2+(u[2]*v[0]-u[0]*v[2])**2+(u[0]*v[1]-u[1]*v[0])**2;
    // Bounds only: collapsed source boxes must not pull the Yoyo camera away.
    // Rendering, transforms, activation, topology and source vertices are untouched.
    if(area2<=1e-20)continue;
    for(const index of [a,b,c])for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],p[index+axis]);max[axis]=Math.max(max[axis],p[index+axis]);}
  }
}

// Pure renderer-side evaluator, exported for real-source numerical regressions.
// It never mutates parseGLB's rest geometry or changes normalization per frame.
export function createSourceAnimation(geometry,data) {
  const source=geometrySources.get(geometry),diagnostics=[],compiled=new Map(),bindings=new Map();
  const sourceId=geometry.extras?.sourceId||source?.nodes[0]?.extras?.sourceId;
  let live=null,state=null,lastWorlds=null;const framingCache=new Map();
  const fail=(clipId,reason)=>diagnostics.push({clipId:clipId||null,reason});
  if(data) {
    try {
      if(!source||![1,2].includes(data.schemaVersion)||data.coordinateSystem!=='glTF')throw Error('动画数据版本或坐标系未经验证');
      if(typeof data.sourceId!=='string'||data.sourceId!==sourceId)throw Error('动画与模型的源对象 ID 不匹配');
      if(!Array.isArray(data.nodes)||!Array.isArray(data.clips))throw Error('动画缺少源节点或片段');
      if(data.flows!==undefined||data.evaluation!==undefined||data.precomputedFraming!==undefined||data.variants!==undefined)throw Error('公开预览不支持源状态流程、离线约束或专用镜头数据');
      const ids=new Set(),indexes=new Set();
      for(const node of data.nodes) {
        if(node?.sourceActive!==undefined||node?.active!==undefined)throw Error('公开预览不支持未转换的源节点启用状态');
        const index=node.glbNodeIndex,original=source.nodes[index];
        if(typeof node.id!=='string'||ids.has(node.id)||!Number.isSafeInteger(index)||indexes.has(index)||!original||!source.nodeWorlds.has(index)||original.extras?.sourceId!==node.id)throw Error('动画目标与 GLB 源节点绑定不匹配');
        ids.add(node.id);indexes.add(index);
        const trs={translation:numericArray(node.translation,3,'源位置'),rotation:numericArray(node.rotation,4,'源旋转'),scale:numericArray(node.scale,3,'源缩放')};
        const originalMatrix=nodeMatrix(original),restMatrix=nodeMatrix(trs);
        if(restMatrix.some((v,i)=>Math.abs(v-originalMatrix[i])>2e-5*Math.max(1,Math.abs(v),Math.abs(originalMatrix[i]))))throw Error('源静态变换与 GLB 矩阵不匹配');
        if(node.parentId!==undefined) {
          const parent=source.nodeParents.get(index),parentId=parent===null?null:source.nodes[parent]?.extras?.sourceId;
          if(node.parentId!==parentId)throw Error('源父节点与 GLB 层级不匹配');
        }
        bindings.set(node.id,{index,trs});
      }
      const clipIds=new Set();
      for(const clip of data.clips) {
        try {
          if(clip.segments!==undefined||clip.previewPreparation!==undefined||clip.canonicalSHA256!==undefined||clip.classification==='derived_source_state_flow')throw Error('公开预览不支持源状态流程或专用预处理片段');
          if(typeof clip.id!=='string'||!clip.id||clipIds.has(clip.id))throw Error('动画片段 ID 缺失或重复');
          clipIds.add(clip.id);
          if(clip.supported===false||clip.status==='unsupported')throw Error(clip.unsupportedReason||'此源片段不支持预览');
          if(!Number.isFinite(clip.duration)||clip.duration<=0)throw Error('源片段为空或时长为零');
          if(!Array.isArray(clip.tracks)||!clip.tracks.length)throw Error('未恢复可播放的源曲线');
          const tracks=[],keys=new Set(),affected=new Set();
          for(const track of clip.tracks) {
            const binding=bindings.get(track.nodeId);
            if(!binding)throw Error('源曲线目标节点缺失：'+String(track.nodeId));
            const key=binding.index+':'+track.path;
            if(keys.has(key))throw Error('同一节点属性存在多个冲突曲线');keys.add(key);
            tracks.push(compileTrack(track,clip.duration,binding));
            for(let pi=0;pi<source.restPrimitives.length;pi++) {
              const primitive=source.restPrimitives[pi];
              for(let index of [primitive.nodeIndex,...(primitive.skinData?.joints||[])])while(index!==null&&index!==undefined&&index>=0){if(index===binding.index){affected.add(pi);break;}index=source.nodeParents.get(index);}
            }
          }
          if(!affected.size)throw Error('源曲线未绑定到当前已恢复的可见网格');
          for(const pi of affected) {
            const primitive=source.restPrimitives[pi];
            if(primitive.skin!==undefined&&!primitive.skinData)throw Error('蒙皮绑定无效，不能用静态网格冒充动画');
            if(primitive.morph)throw Error('形态目标动画尚未恢复');
          }
          compiled.set(clip.id,{...clip,tracks,affected});
        } catch(error){fail(clip.id,error.message);}
      }
    } catch(error){compiled.clear();fail(null,error.message);}
  }
  if(Array.isArray(data?.unsupportedClips))for(const clip of data.unsupportedClips)fail(clip.sourceClipId||clip.id,(clip.name?clip.name+'：':'')+(clip.reason||'源片段尚不支持预览'));
  const clips=[...compiled.values()].map(clip=>({id:clip.id,name:clip.name||clip.id,duration:clip.duration,loop:clip.loop===true,sourceClipId:clip.sourceClipId||clip.id,limitations:Array.isArray(clip.limitations)?clip.limitations.slice():[]}));
  function sample(clipId,time) {
    const clip=compiled.get(clipId);
    if(!clip)throw Error('此动画没有已验证的可播放曲线');
    if(!Number.isFinite(time))throw Error('动画时间必须是有限数值');
    time=clamp(time,0,clip.duration);
    const poses=new Map();
    for(const track of clip.tracks) {
      let pose=poses.get(track.nodeIndex);
      if(!pose){const rest=bindings.get(track.nodeId).trs;pose={translation:rest.translation.slice(),rotation:rest.rotation.slice(),scale:rest.scale.slice()};poses.set(track.nodeIndex,pose);}
      pose[track.path]=sampleTrack(track,time);
    }
    const worlds=new Map();
    function world(index) {
      if(worlds.has(index))return worlds.get(index);
      const parent=source.nodeParents.get(index),local=nodeMatrix(poses.get(index)||source.nodes[index]);
      const matrix=parent===null?local:multiply(world(parent),local);
      if(!matrix.every(Number.isFinite))throw Error('动画层级变换产生无效矩阵');
      worlds.set(index,matrix);return matrix;
    }
    if(!live)live={...geometry,primitives:geometry.primitives.map(p=>({...p,positions:p.positions.slice(),normals:p.normals.slice(),indices:p.indices.slice(),center:p.center.slice()}))};
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],{center,scale}=geometry.bounds;
    for(let pi=0;pi<live.primitives.length;pi++) {
      const p=live.primitives[pi],rest=source.restPrimitives[pi];
      if(!clip.affected.has(pi)) {
        const original=geometry.primitives[pi];p.positions.set(original.positions);p.normals.set(original.normals);p.indices.set(original.indices);p.center=original.center.slice();p.visible=original.visible;
        includeVisibleTriangleBounds(p,min,max);
        continue;
      }
      const matrix=rest.nodeIndex>=0?world(rest.nodeIndex):identity(),nm=normalMatrix(matrix);
      p.visible=true;
      p.indices.set(rest.localIndices);
      if(!rest.skinData&&nm.det<0)for(let j=0;j<p.indices.length;j+=3)[p.indices[j+1],p.indices[j+2]]=[p.indices[j+2],p.indices[j+1]];
      poseVertices(p.positions,p.normals,rest.localPositions,rest.localNormals,matrix,rest.skinData,rest.skinData?skinPalette(rest.skinData,world):null,center,scale);
      if(!rest.localNormals) {
        p.normals.fill(0);
        for(let j=0;j<p.indices.length;j+=3) {
          const a=p.indices[j]*3,b=p.indices[j+1]*3,c=p.indices[j+2]*3,positions=p.positions;
          const ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2],vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
          const normal=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
          for(const k of [a,b,c])for(let axis=0;axis<3;axis++)p.normals[k+axis]+=normal[axis];
        }
        for(let j=0;j<p.normals.length;j+=3)p.normals.set(normalize(Array.from(p.normals.subarray(j,j+3))),j);
      }
      const centroid=[0,0,0];
      for(const index of p.indices)for(let axis=0;axis<3;axis++){const value=p.positions[index*3+axis];centroid[axis]+=value;}
      includeVisibleTriangleBounds(p,min,max);
      p.center=centroid.map(value=>value/p.indices.length);
    }
    lastWorlds=new Map([...source.nodeWorlds.keys()].map(index=>[index,world(index)]));
    state={clipId,time,duration:clip.duration};live.animationEvaluation={mode:'glTF-sidecar-keyframes',trackCount:clip.tracks.length,affectedPrimitives:clip.affected.size,skinnedPrimitives:source.restPrimitives.filter(p=>p.skinData).length};live.posedBounds=min.every(Number.isFinite)?{min,max}:null;
    return live;
  }
  function getFraming(clipId=clips[0]?.id) {
    const cached=framingCache.get(clipId);if(cached)return {...cached,center:cached.center.slice()};
    const selected=compiled.get(clipId);if(!selected)return {center:[0,0,0],scale:1,sampleCount:0,clipId:null};
    const previous=state?{...state}:null,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let sampleCount=0,framing;

    // A fixed full-clip frame avoids zoom pumping. Include key boundaries,
    // their midpoints, and a bounded uniform sweep.
    for(const clip of [selected]) {
      const times=new Set([0,clip.duration]);
      for(const track of clip.tracks)for(const time of track.times)times.add(time);
      const steps=Math.min(1200,Math.max(1,Math.ceil(clip.duration*120)));
      for(let i=0;i<=steps;i++)times.add(clip.duration*i/steps);
      const sorted=[...times].sort((a,b)=>a-b);
      for(let i=1;i<sorted.length;i++)times.add((sorted[i-1]+sorted[i])/2);
      for(const time of times) {
        const bounds=sample(clip.id,time).posedBounds;sampleCount++;
        if(bounds)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],bounds.min[axis]);max[axis]=Math.max(max[axis],bounds.max[axis]);}
      }
    }
    if(previous)sample(previous.clipId,previous.time);else state=null;
    if(!min.every(Number.isFinite))framing={center:[0,0,0],scale:1,sampleCount};
    else {
      const center=min.map((value,i)=>(value+max[i])/2),radius=Math.hypot(...min.map((value,i)=>(max[i]-value)/2));
      framing={center,scale:Math.min(1,1.25/Math.max(radius*1.04,1e-5)),sampleCount,bounds:{min,max}};
    }
    framing.clipId=clipId;framingCache.set(clipId,framing);
    return {...framing,center:framing.center.slice()};
  }
  return {clips,diagnostics,sample,getFraming,getNodeWorldMatrices(){return lastWorlds?new Map([...lastWorlds].map(([k,v])=>[k,v.slice()])):null;},reset(){state=null;return geometry;},getState(){return state?{...state}:null;}};
}

// A compact linear-light material shader, not a complete PBR implementation.
export const VERTEX_SHADER=`
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUV;
attribute vec4 aColor;
uniform mat4 uMVP;
uniform mat4 uModelView;
varying mediump vec3 vNormal;
varying mediump vec3 vViewPosition;
varying mediump vec2 vUV;
varying mediump vec4 vColor;
void main() {
  gl_Position=uMVP*vec4(aPosition,1.0);
  vViewPosition=(uModelView*vec4(aPosition,1.0)).xyz;
  vNormal=mat3(uModelView)*aNormal;
  vUV=aUV;
  vColor=aColor;
}`;
export const FRAGMENT_SHADER=`
precision highp float;
varying mediump vec3 vNormal;
varying mediump vec3 vViewPosition;
varying mediump vec2 vUV;
varying mediump vec4 vColor;
uniform sampler2D uBaseMap;
uniform sampler2D uEmissiveMap;
uniform sampler2D uMRMap;
uniform mat3 uBaseUV;
uniform mat3 uEmissiveUV;
uniform mat3 uMRUV;
uniform vec2 uBaseWrap;
uniform vec2 uEmissiveWrap;
uniform vec2 uMRWrap;
uniform vec4 uBaseColor;
uniform vec3 uEmissive;
uniform vec3 uLightDirection;
uniform vec3 uAmbientColor;
uniform vec3 uKeyColor;
uniform vec3 uShadowColor;
uniform vec3 uBaseTint;
uniform float uAmbient;
uniform float uKey;
uniform float uBands;
uniform float uLightThreshold;
uniform float uSaturation;
uniform float uContrast;
uniform float uAlphaMode;
uniform float uAlphaCutoff;
uniform float uMetallic;
uniform float uRoughness;
uniform float uMode;
uniform float uUnlit;
uniform float uWire;
vec3 toLinear(vec3 c) {return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));}
vec3 toSRGB(vec3 c) {return mix(c*12.92,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
float wrapCoordinate(float v,float mode) {if(mode>1.5)return 1.0-abs(mod(v,2.0)-1.0);if(mode>0.5)return fract(v);return v;}
vec2 wrapUV(vec2 uv,vec2 mode) {return vec2(wrapCoordinate(uv.x,mode.x),wrapCoordinate(uv.y,mode.y));}
void main() {
  if(uWire>0.5) {gl_FragColor=vec4(0.19,0.34,0.30,1.0);return;}
  vec4 texel=texture2D(uBaseMap,wrapUV((uBaseUV*vec3(vUV,1.0)).xy,uBaseWrap));
  vec4 base=vec4(toLinear(texel.rgb),texel.a)*uBaseColor*vColor;
  if(uAlphaMode>0.5&&uAlphaMode<1.5&&base.a<uAlphaCutoff) discard;
  float alpha=uAlphaMode>1.5?base.a:1.0;
  if(alpha<0.001) discard;
  vec3 albedo=base.rgb*uBaseTint;
  if(uMode>0.5&&uMode<1.5) albedo=vec3(0.42,0.46,0.43)*uBaseTint;
  vec3 N=normalize(vNormal);
  if(!gl_FrontFacing) N=-N;
  vec3 L=normalize(uLightDirection);
  float ndl=max(dot(N,L),0.0);
  vec3 lighting=uAmbientColor*uAmbient+mix(uShadowColor,uKeyColor,ndl)*uKey;
  vec3 color;
  if(uMode>1.5) {
    float steps=max(uBands-1.0,1.0);
    float band=clamp(floor(ndl*steps+1.0-uLightThreshold)/steps,0.0,1.0);
    lighting=uAmbientColor*uAmbient+mix(uShadowColor,uKeyColor,band)*uKey;
  }
  color=albedo*lighting;
  if(uMode<0.5) {
    vec4 mr=texture2D(uMRMap,wrapUV((uMRUV*vec3(vUV,1.0)).xy,uMRWrap));
    float rough=max(0.04,uRoughness*mr.g),metal=uMetallic*mr.b;
    vec3 H=normalize(L+normalize(-vViewPosition));
    float exponent=clamp(2.0/(rough*rough)-2.0,1.0,128.0);
    vec3 f0=mix(vec3(0.04),albedo,metal);
    color=albedo*lighting*(1.0-metal*0.6)+f0*pow(max(dot(N,H),0.0),exponent)*ndl*uKey*uKeyColor;
  }
  if(uUnlit>0.5) color=albedo;
  if(!(uMode>0.5&&uMode<1.5)) color+=toLinear(texture2D(uEmissiveMap,wrapUV((uEmissiveUV*vec3(vUV,1.0)).xy,uEmissiveWrap)).rgb)*uEmissive;
  color=toSRGB(max(color,vec3(0.0)));
  float grey=dot(color,vec3(0.2126,0.7152,0.0722));
  color=mix(vec3(grey),color,uSaturation);
  color=(color-0.5)*uContrast+0.5;
  gl_FragColor=vec4(clamp(color,0.0,1.0),clamp(alpha,0.0,1.0));
}`;

function prepareProfile(value={}) {
  value=value||{};
  if(typeof value==='string') value={id:value,mode:value};
  const p=value.parameters||{},mode=['material','clay','toon'].includes(value.mode)?value.mode:['clay','toon'].includes(value.id)?value.id:'material';
  return {...value,mode,parameters:{lightDirection:normalize(vec(p.lightDirection,3,[0.4,0.8,1])),ambientColor:vec(p.ambientColor,3,[1,1,1]),
    ambientStrength:clamp(finite(p.ambientStrength,0.42),0,4),keyLightColor:vec(p.keyLightColor,3,[1,0.98,0.93]),keyLightStrength:clamp(finite(p.keyLightStrength,0.85),0,8),
    bands:clamp(finite(p.bands,3),2,12),lightThreshold:clamp(finite(p.lightThreshold,0.5),0,1),shadowColor:vec(p.goochDarkColor||p.shadowColor,3,mode==='toon'?[0.25,0.32,0.4]:[0,0,0]),baseTint:vec(p.baseTint,3,[1,1,1]),
    saturation:clamp(finite(p.saturation,1),0,3),contrast:clamp(finite(p.contrast,1),0,3),
    alphaCutoff:p.alphaCutoff===undefined?null:clamp(finite(p.alphaCutoff,0.5),0,1),unlit:p.unlit===undefined?null:!!p.unlit}};
}
function cancelledError(){return new DOMException('预览任务已取消','AbortError');}
function sanitizeCamera(value={},previous=defaultCamera) {
  return {yaw:finite(value.yaw,previous.yaw),pitch:clamp(finite(value.pitch,previous.pitch),-1.5,1.5),zoom:clamp(finite(value.zoom,previous.zoom),1.25,14)};
}
async function decodeImage(image,signal) {
  let blob;
  if(image.bytes) blob=new Blob([image.bytes],{type:image.mimeType});
  else throw Error('贴图没有内嵌在 GLB 内，未加载外部资源');
  if(signal.aborted) throw new DOMException('Cancelled','AbortError');
  if(typeof createImageBitmap==='function') {
    try{return await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none',imageOrientation:'none'});}catch(error){if(signal.aborted)throw error;}
  }
  return await new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(blob),img=new Image();
    const cleanup=()=>{URL.revokeObjectURL(url);signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();img.src='';reject(new DOMException('Cancelled','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});img.onload=()=>{cleanup();resolve(img);};img.onerror=()=>{cleanup();reject(Error('内嵌贴图解码失败'));};img.src=url;
  });
}

export async function createViewer(container,url,options={}) {
  activeViewers.get(container)?.dispose();
  const canvas=options._canvas||document.createElement('canvas');
  canvas.setAttribute('aria-label','实际模型与材质预览。拖动旋转，滚轮缩放，方向键旋转。');canvas.tabIndex=0;
  Object.assign(canvas.style,{display:'block',width:'100%',height:'100%',touchAction:'none'});
  container.replaceChildren(canvas);
  const abort=new AbortController(),cleanups=[],decodedImages=[];
  let disposed=false,contextLost=false,ready=false,geometry,animation=null,animationFrame={center:[0,0,0],scale:1},gpu=null,resize=null,frame=0,drag=null,isWire=false;
  let camera=sanitizeCamera(options.camera),profile=prepareProfile(options.profile);
  const gl=canvas.getContext('webgl',{antialias:true,alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:!!options._sharedResources});
  if(options._sharedResources)options._sharedResources.gl=gl;
  function showStatus(message,afterFailure=false) {
    if((!afterFailure&&(disposed||activeViewers.get(container)!==api))||canvas.parentNode!==container)return;
    let node=container.querySelector('[data-viewer-status]');
    if(!message){node?.remove();return;}
    if(!node){node=document.createElement('div');node.dataset.viewerStatus='';node.setAttribute('role','status');Object.assign(node.style,{position:'absolute',left:'12px',right:'12px',bottom:'12px',padding:'10px',borderRadius:'8px',background:'rgba(255,255,255,.94)',color:'#38483f',fontSize:'12px',pointerEvents:'none'});container.append(node);}
    node.textContent=message;
  }
  function alive(){return !disposed&&activeViewers.get(container)===api&&canvas.parentNode===container;}
  function listen(target,event,handler,opts){target.addEventListener(event,handler,opts);cleanups.push(()=>target.removeEventListener(event,handler,opts));}
  function releaseGPU() {
    if(!gpu||!gl)return;
    for(const item of gpu.primitives) {gl.deleteBuffer(item.buffer);if(item.wire)gl.deleteBuffer(item.wire);}
    for(const texture of gpu.textures)gl.deleteTexture(texture);
    if(options._sharedResources?.program!==gpu.program)gl.deleteProgram(gpu.program);gpu=null;
  }
  function dispose() {
    if(disposed)return;disposed=true;abort.abort();cancelAnimationFrame(frame);resize?.disconnect();
    for(const cleanup of cleanups)cleanup();releaseGPU();
    for(const img of decodedImages)img?.close?.();decodedImages.length=0;
    if(activeViewers.get(container)===api){activeViewers.delete(container);container.querySelector('[data-viewer-status]')?.remove();}
    // Release scarce browser contexts; restoration events cannot revive a disposed viewer.
    if(!options._sharedResources)gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  function requestDraw(){if(options._sharedResources||!alive()||contextLost||frame)return;frame=requestAnimationFrame(()=>{frame=0;draw();});}
  function applyAnimationGeometry(next) {
    geometry=next;
    if(gpu&&!contextLost)for(let i=0;i<gpu.primitives.length;i++) {
      const item=gpu.primitives[i],primitive=geometry.primitives[i];item.source=primitive;
      for(let j=0;j<primitive.indices.length;j++) {
        const index=primitive.indices[j],offset=j*12;
        item.packed.set(primitive.positions.subarray(index*3,index*3+3),offset);
        item.packed.set(primitive.normals.subarray(index*3,index*3+3),offset+3);
        // A negative animated scale changes winding, not source triangle identity.
        item.packed.set(primitive.uv.subarray(index*2,index*2+2),offset+6);
        item.packed.set(primitive.colors.subarray(index*4,index*4+4),offset+8);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER,item.buffer);gl.bufferData(gl.ARRAY_BUFFER,item.packed,gl.DYNAMIC_DRAW);
      item.wireDirty=true;
    }
    requestDraw();
    if(alive())options.onAnimationChange?.(animation?.getState()||null);
  }
  function notifyCamera(){if(alive()&&typeof options.onCameraChange==='function')options.onCameraChange({...camera});}
  const api={reset(){if(!disposed){camera={...defaultCamera};requestDraw();notifyCamera();}},wireframe(value){isWire=!!value;requestDraw();},
    setProfile(value){profile=prepareProfile(value);requestDraw();},
    getAnimationClips(){return animation?.clips.map(clip=>({...clip,limitations:clip.limitations.slice()}))||[];},
    getAnimationState(){return animation?.getState()||null;},
    getAnimationFraming(){return {...animationFrame,center:animationFrame.center.slice()};},
    setAnimationTime(clipId,time){
      if(!alive()||!animation)throw Error('动画预览尚未就绪或已经关闭');
      // Only the app owns playback time. Both views receive this same absolute seek.
      try{
        // Reframe once on clip selection, never on the shared clock's frame ticks.
        if(clipId!==null&&animationFrame.clipId!==clipId)animationFrame=animation.getFraming(clipId);
        applyAnimationGeometry(clipId===null?animation.reset():animation.sample(clipId,time));
      }
      catch(error){applyAnimationGeometry(animation.reset());throw error;}
      return animation.getState();
    },
    resetAnimation(){if(alive()&&animation)applyAnimationGeometry(animation.reset());},
    getAnimationDiagnostics(){return animation?.diagnostics.map(item=>({...item}))||[];},
    get animationWarnings(){return animation?.diagnostics.map(item=>({...item}))||[];},
    // Programmatic camera updates are silent, avoiding feedback loops between two viewers.
    setCamera(value){camera=sanitizeCamera(value,camera);requestDraw();},getCamera(){return {...camera};},dispose,
    async capture(){
      if(!alive())throw cancelledError();
      if(!ready||contextLost||gl.isContextLost()||!gpu)throw Error('三维预览尚未就绪');
      draw();
      return new Promise((resolve,reject)=>canvas.toBlob(blob=>{
        if(!alive())reject(cancelledError());else if(blob)resolve(blob);else reject(Error('预览图像生成失败'));
      },'image/png'));
    },
    get warnings(){return geometry?.warnings?.slice()||[];},get stats(){return geometry?{triangles:geometry.triangles,vertices:geometry.vertices,materials:geometry.materials.length}:null;}};
  activeViewers.set(container,api);
  if(options.signal){if(options.signal.aborted){dispose();return api;}listen(options.signal,'abort',dispose,{once:true});}
  if(!gl){dispose();showStatus('此浏览器无法使用 WebGL，请查看静态预览',true);throw Error('此浏览器无法使用 WebGL');}
  function compile(type,source) {
    const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const log=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error('三维着色器编译失败：'+log);}
    return shader;
  }
  function initializeGPU() {
    releaseGPU();
    const shared=options._sharedResources,program=shared?.program||gl.createProgram();
    gpu={program,primitives:[],textures:[],loc:shared?.loc||{}};
    if(!shared?.program){
      let vert,frag;
      try{
        vert=compile(gl.VERTEX_SHADER,VERTEX_SHADER);
        const highp=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT)?.precision>0;
        frag=compile(gl.FRAGMENT_SHADER,highp?FRAGMENT_SHADER:FRAGMENT_SHADER.replace('precision highp float','precision mediump float'));
        gl.attachShader(program,vert);gl.attachShader(program,frag);gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('三维着色器链接失败：'+gl.getProgramInfoLog(program));
      }finally{if(vert)gl.deleteShader(vert);if(frag)gl.deleteShader(frag);}
      for(const key of ['aPosition','aNormal','aUV','aColor'])gpu.loc[key]=gl.getAttribLocation(program,key);
      for(const key of ['uMVP','uModelView','uBaseMap','uEmissiveMap','uMRMap','uBaseUV','uEmissiveUV','uMRUV','uBaseWrap','uEmissiveWrap','uMRWrap','uBaseColor','uEmissive','uLightDirection','uAmbientColor','uKeyColor','uShadowColor','uBaseTint','uAmbient','uKey','uBands','uLightThreshold','uSaturation','uContrast','uAlphaMode','uAlphaCutoff','uMetallic','uRoughness','uMode','uUnlit','uWire'])gpu.loc[key]=gl.getUniformLocation(program,key);
      if(shared){shared.program=program;shared.loc=gpu.loc;}
    }
    function uploadTexture(img,sampler={}) {
      if(img&&(img.width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||img.height>gl.getParameter(gl.MAX_TEXTURE_SIZE)))throw Error('源贴图超过此设备支持的最大尺寸');
      const texture=gl.createTexture();gpu.textures.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
      if(img)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
      else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
      const pot=!img||((img.width&(img.width-1))===0&&(img.height&(img.height-1))===0),wrap=[gl.CLAMP_TO_EDGE,gl.MIRRORED_REPEAT,gl.REPEAT];
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,pot&&wrap.includes(sampler.wrapS)?sampler.wrapS:pot?gl.REPEAT:gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,pot&&wrap.includes(sampler.wrapT)?sampler.wrapT:pot?gl.REPEAT:gl.CLAMP_TO_EDGE);
      const min=[gl.NEAREST,gl.LINEAR,gl.NEAREST_MIPMAP_NEAREST,gl.LINEAR_MIPMAP_NEAREST,gl.NEAREST_MIPMAP_LINEAR,gl.LINEAR_MIPMAP_LINEAR].includes(sampler.minFilter)?sampler.minFilter:gl.LINEAR_MIPMAP_LINEAR;
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,pot?min:min===gl.NEAREST?gl.NEAREST:gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,sampler.magFilter===gl.NEAREST?gl.NEAREST:gl.LINEAR);
      if(pot)gl.generateMipmap(gl.TEXTURE_2D);
      // WebGL 1 cannot repeat NPOT textures in hardware. Preserve source tiling in GLSL.
      const wrapMode=v=>v===gl.CLAMP_TO_EDGE?0:v===gl.MIRRORED_REPEAT?2:1;
      return {texture,wrap:pot?[0,0]:[wrapMode(sampler.wrapS),wrapMode(sampler.wrapT)]};
    }
    gpu.white=uploadTexture(null);
    gpu.maps=geometry.textures.map(texture=>uploadTexture(decodedImages[texture.source],texture.sampler));
    for(const primitive of geometry.primitives) {
      const packed=new Float32Array(primitive.indices.length*12);
      for(let j=0;j<primitive.indices.length;j++) {
        const index=primitive.indices[j],offset=j*12;
        packed.set(primitive.positions.subarray(index*3,index*3+3),offset);packed.set(primitive.normals.subarray(index*3,index*3+3),offset+3);
        packed.set(primitive.uv.subarray(index*2,index*2+2),offset+6);packed.set(primitive.colors.subarray(index*4,index*4+4),offset+8);
      }
      const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,packed,gl.STATIC_DRAW);
      gpu.primitives.push({buffer,packed,wire:null,wireDirty:false,count:primitive.indices.length,source:primitive});
    }
  }
  function bindAttribute(name,size,stride,offset) {
    const location=gpu.loc[name];if(location<0)return;gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,stride,offset);
  }
  function draw() {
    if(!alive()){if(!disposed)dispose();return;}if(!gpu||contextLost)return;
    const rect=canvas.getBoundingClientRect(),ratio=Math.min(globalThis.devicePixelRatio||1,2),width=options._renderSize?.width||Math.max(1,Math.round(rect.width*ratio)),height=options._renderSize?.height||Math.max(1,Math.round(rect.height*ratio));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.useProgram(gpu.program);
    const {yaw,pitch,zoom}=camera,cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const ry=[cy,0,-sy,0,0,1,0,0,sy,0,cy,0,0,0,0,1],rx=[1,0,0,0,0,cp,sp,0,0,-sp,cp,0,0,0,0,1],view=identity();view[14]=-zoom*Math.max(1,height/width);
    const fit=identity();fit[0]=fit[5]=fit[10]=animationFrame.scale;
    for(let axis=0;axis<3;axis++)fit[12+axis]=-animationFrame.center[axis]*animationFrame.scale;
    const mv=multiply(view,multiply(multiply(rx,ry),fit)),f=2.25,near=0.01,far=100,projection=[f/(width/height),0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0],loc=gpu.loc,p=profile.parameters;
    gl.uniformMatrix4fv(loc.uMVP,false,new Float32Array(multiply(projection,mv)));gl.uniformMatrix4fv(loc.uModelView,false,new Float32Array(mv));
    for(const [key,value]of [['uLightDirection',p.lightDirection],['uAmbientColor',p.ambientColor],['uKeyColor',p.keyLightColor],['uShadowColor',p.shadowColor],['uBaseTint',p.baseTint]])gl.uniform3fv(loc[key],value);
    for(const [key,value]of [['uAmbient',p.ambientStrength],['uKey',p.keyLightStrength],['uBands',p.bands],['uLightThreshold',p.lightThreshold],['uSaturation',p.saturation],['uContrast',p.contrast],['uMode',profile.mode==='clay'?1:profile.mode==='toon'?2:0],['uWire',isWire?1:0]])gl.uniform1f(loc[key],value);
    const opaque=gpu.primitives.filter(item=>item.source.visible!==false&&item.source.material.alphaMode!=='BLEND'),transparent=gpu.primitives.filter(item=>item.source.visible!==false&&item.source.material.alphaMode==='BLEND');
    transparent.sort((a,b)=>transformPoint(a.source.center,mv)[2]-transformPoint(b.source.center,mv)[2]);
    for(const item of [...opaque,...transparent]) {
      const material=item.source.material,blend=material.alphaMode==='BLEND'&&!isWire;
      if(blend){gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);}else{gl.disable(gl.BLEND);gl.depthMask(true);}
      if(material.doubleSided||isWire)gl.disable(gl.CULL_FACE);else{gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.frontFace(gl.CCW);}
      if(isWire) {
        if(!item.wire||item.wireDirty){const wire=new Float32Array(item.count*6),indices=item.source.indices,positions=item.source.positions;let out=0;for(let j=0;j<indices.length;j+=3)for(const k of [0,1,1,2,2,0]){const index=indices[j+k]*3;wire.set(positions.subarray(index,index+3),out);out+=3;}if(!item.wire)item.wire=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,item.wire);gl.bufferData(gl.ARRAY_BUFFER,wire,item.wireDirty?gl.DYNAMIC_DRAW:gl.STATIC_DRAW);item.wireDirty=false;}
        gl.bindBuffer(gl.ARRAY_BUFFER,item.wire);bindAttribute('aPosition',3,0,0);
        for(const name of ['aNormal','aUV','aColor'])if(loc[name]>=0){gl.disableVertexAttribArray(loc[name]);gl.vertexAttrib4f(loc[name],0,1,0,1);}
        gl.drawArrays(gl.LINES,0,item.count*2);continue;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER,item.buffer);bindAttribute('aPosition',3,48,0);bindAttribute('aNormal',3,48,12);bindAttribute('aUV',2,48,24);bindAttribute('aColor',4,48,32);
      gl.uniform4fv(loc.uBaseColor,material.baseColor);gl.uniform3fv(loc.uEmissive,material.emissive);gl.uniform1f(loc.uAlphaMode,material.alphaMode==='MASK'?1:material.alphaMode==='BLEND'?2:0);
      gl.uniform1f(loc.uAlphaCutoff,p.alphaCutoff??material.alphaCutoff);gl.uniform1f(loc.uMetallic,material.metallic);gl.uniform1f(loc.uRoughness,material.roughness);gl.uniform1f(loc.uUnlit,p.unlit===null?(material.unlit?1:0):(p.unlit?1:0));
      for(const [unit,info,map,uv,wrap]of [[0,material.baseColorTexture,'uBaseMap','uBaseUV','uBaseWrap'],[1,material.emissiveTexture,'uEmissiveMap','uEmissiveUV','uEmissiveWrap'],[2,material.metallicRoughnessTexture,'uMRMap','uMRUV','uMRWrap']]) {
        const mapTexture=info&&info.texCoord===0?gpu.maps[info.index]||gpu.white:gpu.white;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,mapTexture.texture);gl.uniform2fv(loc[wrap],mapTexture.wrap);gl.uniform1i(loc[map],unit);gl.uniformMatrix3fv(loc[uv],false,new Float32Array(info?.transform||[1,0,0,0,1,0,0,0,1]));
      }
      gl.drawArrays(gl.TRIANGLES,0,item.count);
    }
    gl.depthMask(true);gl.disable(gl.BLEND);
  }
  listen(canvas,'webglcontextlost',event=>{event.preventDefault();contextLost=true;cancelAnimationFrame(frame);frame=0;gpu=null;if(options._sharedResources){options._sharedResources.program=null;options._sharedResources.loc=null;}showStatus('三维上下文暂时中断，等待浏览器恢复…');});
  listen(canvas,'webglcontextrestored',()=>{if(!alive())return;contextLost=false;if(!ready)return;try{initializeGPU();showStatus('');requestDraw();}catch(error){showStatus(error.message);options.onError?.(error);}});
  if(!options._sharedResources){
  listen(canvas,'pointerdown',event=>{if(event.button!==0)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);});
  listen(canvas,'pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;camera=sanitizeCamera({yaw:camera.yaw+(event.clientX-drag.x)*0.009,pitch:camera.pitch+(event.clientY-drag.y)*0.009},camera);drag.x=event.clientX;drag.y=event.clientY;requestDraw();notifyCamera();});
  const endDrag=()=>{drag=null;};for(const event of ['pointerup','pointercancel','lostpointercapture'])listen(canvas,event,endDrag);
  listen(canvas,'wheel',event=>{event.preventDefault();camera=sanitizeCamera({zoom:camera.zoom*Math.exp(event.deltaY*0.001)},camera);requestDraw();notifyCamera();},{passive:false});
  listen(canvas,'keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0'].includes(event.key))return;event.preventDefault();if(event.key==='0'){api.reset();return;}const next={...camera};if(event.key==='ArrowLeft')next.yaw-=0.15;if(event.key==='ArrowRight')next.yaw+=0.15;if(event.key==='ArrowUp')next.pitch-=0.15;if(event.key==='ArrowDown')next.pitch+=0.15;if(['+','='].includes(event.key))next.zoom-=0.2;if(event.key==='-')next.zoom+=0.2;camera=sanitizeCamera(next);requestDraw();notifyCamera();});
  }
  try {
    geometry=await loadGeometry(url,{signal:abort.signal});
    // Thumbnail jobs can never bind or sample motion, even if options are reused.
    if(!options._sharedResources){animation=createSourceAnimation(geometry,options.animationData);if(animation.clips.length)animationFrame=animation.getFraming();}
    if(!alive()){dispose();return api;}
    const required=new Set();for(const material of geometry.materials)for(const info of [material.baseColorTexture,material.emissiveTexture,material.metallicRoughnessTexture])if(info&&info.texCoord===0){const source=geometry.textures[info.index]?.source;if(source!==undefined)required.add(source);else throw Error('材质贴图引用无效');}
    // Sequential decoding bounds transient image memory and checks cancellation between images.
    for(const index of required) {
      const source=geometry.images[index];if(!source)throw Error('材质内嵌图像缺失');
      const img=await decodeImage(source,abort.signal);
      if(!alive()){img.close?.();dispose();return api;}decodedImages[index]=img;
      if(!contextLost&&(img.width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||img.height>gl.getParameter(gl.MAX_TEXTURE_SIZE)))throw Error('源贴图超过此设备支持的最大尺寸');
    }
    if(!alive()){dispose();return api;}
    ready=true;
    if(!contextLost){initializeGPU();showStatus('');}
    if(!options._sharedResources){
    if(typeof ResizeObserver==='function'){resize=new ResizeObserver(requestDraw);resize.observe(canvas);}else listen(window,'resize',requestDraw);
    }
    requestDraw();return api;
  } catch(error) {
    const cancelled=disposed||error.name==='AbortError'||activeViewers.get(container)!==api;
    dispose();if(cancelled)return api;showStatus(error.message||'模型预览加载失败',true);throw error;
  }
}


// One unattached canvas/context and one shader program for a bounded thumbnail queue.
// GPU model/image resources are released after every Blob; the caller owns URL caching.
export function createThumbnailRenderer({width=360,height=300}={}) {
  const size={width:clamp(Math.round(finite(width,360)),32,1024),height:clamp(Math.round(finite(height,300)),32,1024)};
  const container=document.createElement('div'),canvas=document.createElement('canvas');
  const shared={program:null,loc:null,gl:null};
  let disposed=false,tail=Promise.resolve(),activeAbort=null;
  const contextLost=event=>{event.preventDefault();shared.program=null;shared.loc=null;};
  canvas.addEventListener('webglcontextlost',contextLost);
  async function run(url,options) {
    if(disposed||options.signal?.aborted)throw cancelledError();
    if(shared.gl?.isContextLost())throw Error('缩略图三维上下文正在恢复');
    const controller=new AbortController();activeAbort=controller;
    const cancel=()=>controller.abort();options.signal?.addEventListener('abort',cancel,{once:true});
    let viewer;
    try {
      viewer=await createViewer(container,url,{profile:options.profile,camera:options.camera,
        signal:controller.signal,_canvas:canvas,_sharedResources:shared,_renderSize:size});
      if(disposed||controller.signal.aborted)throw cancelledError();
      return await viewer.capture();
    } finally {
      options.signal?.removeEventListener('abort',cancel);viewer?.dispose();
      if(activeAbort===controller)activeAbort=null;
    }
  }
  return {
    render(url,options={}) {
      if(disposed||options.signal?.aborted)return Promise.reject(cancelledError());
      // Rejections do not poison the queue; canceled jobs cannot contaminate later captures.
      const job=tail.then(()=>run(url,options));tail=job.catch(()=>{});return job;
    },
    dispose() {
      if(disposed)return;disposed=true;activeAbort?.abort();activeViewers.get(container)?.dispose();
      canvas.removeEventListener('webglcontextlost',contextLost);
      if(shared.program)shared.gl?.deleteProgram(shared.program);
      shared.program=null;shared.loc=null;shared.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
}
