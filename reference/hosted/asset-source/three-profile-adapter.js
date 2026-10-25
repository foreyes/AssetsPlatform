import {createInspectionMaterial} from './inspection-material.js';
// Entity's Three r170 implementation of explicit, data-only render profiles.
// A presentation choice must never mutate source geometry, UVs, or source materials.
import * as THREE from './vendor/three.module.js';

export function createMaterialProfileController(root,{createMaterial=parameters=>new THREE.MeshBasicMaterial(parameters)}={}){
 const bindings=[];root.traverse(object=>{if(object.isMesh&&object.material)bindings.push({object,material:object.material});});
 let activeOwned=new Set(),disposed=false;const retired=new Set();
 function release(set){const errors=[];for(const material of [...set])try{material.dispose();set.delete(material);}catch(error){errors.push(error);}return errors;}
 function retainFailed(set){for(const material of set)retired.add(material);}
 function apply(mode,style={}){
  if(disposed)throw Error('Material profile controller is closed');
  if(!['source','unlit','wireframe','clay','toon','soft'].includes(mode))throw Error('Unsupported Entity material mode');
  const nextOwned=new Set(),cache=new Map();let next;
  const replace=source=>{
   if(!source)return source;if(cache.has(source))return cache.get(source);
   const parameters=mode==='wireframe'?{color:0x345350,wireframe:true,side:THREE.DoubleSide}:{
    color:source.color?.clone()||new THREE.Color(0xffffff),map:source.map||null,alphaMap:source.alphaMap||null,
    opacity:source.opacity??1,transparent:!!source.transparent,alphaTest:source.alphaTest||0,
    side:source.side??THREE.FrontSide,vertexColors:!!source.vertexColors,depthTest:source.depthTest!==false,
    depthWrite:source.depthWrite!==false,premultipliedAlpha:!!source.premultipliedAlpha,
    blending:source.blending??THREE.NormalBlending,
   };
   const previewParameters={...parameters,roughness:source.roughness??.8,metalness:source.metalness??0,roughnessMap:source.roughnessMap||null,metalnessMap:source.metalnessMap||null,emissive:source.emissive?.clone()||new THREE.Color(0),emissiveMap:source.emissiveMap||null,emissiveIntensity:source.emissiveIntensity??1};
   const material=['clay','toon','soft'].includes(mode)?createInspectionMaterial(previewParameters,mode,style):createMaterial(parameters);nextOwned.add(material);
   material.name=`${source.name||'material'} · ${mode}`;material.toneMapped=false;cache.set(source,material);return material;
  };
  // Build the entire replacement before touching even the first mesh binding.
  try{next=bindings.map(b=>mode==='source'?b.material:Array.isArray(b.material)?b.material.map(replace):replace(b.material));}
  catch(error){const cleanupErrors=release(nextOwned);retainFailed(nextOwned);throw new AggregateError([error,...cleanupErrors],'Profile construction failed; previous bindings retained');}
  const previous=bindings.map(b=>b.object.material);
  try{bindings.forEach((b,i)=>{b.object.material=next[i];});}
  catch(error){const rollbackErrors=[];bindings.forEach((b,i)=>{try{b.object.material=previous[i];}catch(e){rollbackErrors.push(e);}});const cleanupErrors=release(nextOwned);retainFailed(nextOwned);throw new AggregateError([error,...rollbackErrors,...cleanupErrors],'Profile binding failed; rollback attempted');}
  retainFailed(activeOwned);activeOwned=nextOwned;
  // A cleanup error cannot lie about the successfully applied new profile.
  // Failed retired objects remain owned and are retried by the next apply/dispose.
  return {cleanupErrors:release(retired)};
 }
 return {apply,dispose(){
  disposed=true;const errors=[];for(const b of bindings)try{b.object.material=b.material;}catch(error){errors.push(error);}
  retainFailed(activeOwned);activeOwned=new Set();errors.push(...release(retired));return errors;
 },get ownedMaterialCount(){return activeOwned.size+retired.size;},get cleanupPendingCount(){return retired.size;}};
}

export function configureThreeProfile(profile,{renderer,hemisphere,key,materials}){
 const p=profile?.parameters;
 if(!p||!['source','unlit','wireframe','clay','toon','soft'].includes(p.materialMode)||!['aces-filmic','none'].includes(p.toneMapping)||p.outputColorSpace!=='srgb')throw Error('Profile is not implemented by this Entity adapter');
 for(const n of ['exposure','hemisphereIntensity','keyIntensity'])if(!Number.isFinite(p[n])||p[n]<0||p[n]>16)throw Error('Invalid render profile parameter: '+n);
 if(!Number.isInteger(p.background)||p.background<0||p.background>0xffffff)throw Error('Invalid profile background');
 if(['clay','toon','soft'].includes(p.materialMode)){
  const style=p.style;
  if(!style||typeof style!=='object')throw Error('Missing inspection style');
  for(const k of ['lightDirection','ambientColor','keyLightColor','shadowColor','baseTint'])if(!Array.isArray(style[k])||style[k].length!==3||!style[k].every(n=>Number.isFinite(n)&&Math.abs(n)<=16))throw Error('Invalid inspection style vector: '+k);
  for(const k of ['ambientStrength','keyLightStrength','bands','lightThreshold','saturation','contrast'])if(!Number.isFinite(style[k])||style[k]<0||style[k]>16)throw Error('Invalid inspection style scalar: '+k);
 }
 const result=materials.apply(p.materialMode,p.style);
 renderer.toneMapping=p.toneMapping==='aces-filmic'?THREE.ACESFilmicToneMapping:THREE.NoToneMapping;
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMappingExposure=p.exposure;renderer.setClearColor(p.background);
 hemisphere.intensity=p.hemisphereIntensity;key.intensity=p.keyIntensity;return result;
}
