import * as THREE from './vendor/three.module.js';
import {OrbitControls} from './vendor/controls/OrbitControls.js';
import {createMaterialProfileController,configureThreeProfile} from './three-profile-adapter.js';
import {ENTITY_CAPABILITIES,freezeSnapshot,previewKey} from './entity-render-profiles.js';
export const DEFAULT_CAMERA=Object.freeze({preset:'fit-world-isometric/v1',fov:40,direction:Object.freeze([1,.65,1]),padding:1.15});
export function visibleWorldBounds(root){
 root.updateWorldMatrix(true,true);const bounds=new THREE.Box3();
 root.traverseVisible(o=>{if(!o.isMesh||!o.geometry)return;const b=new THREE.Box3();if(o.isSkinnedMesh&&o.computeBoundingBox){o.computeBoundingBox();b.copy(o.boundingBox);}else{o.geometry.computeBoundingBox();b.copy(o.geometry.boundingBox);}b.applyMatrix4(o.matrixWorld);bounds.union(b);});
 if(bounds.isEmpty()||![...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite))throw Error('GLB 未包含有限的可见几何');return bounds;
}
export function createRenderStage(gltf,asset,{lease,host=null,profile,interactive=false,width=320,height=200,dpr=1,onError=()=>{},controlsFactory=(camera,canvas)=>new OrbitControls(camera,canvas)}={}){
 const renderer=lease.renderer,scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(DEFAULT_CAMERA.fov,1,.01,1000),root=gltf.scene;
 let controls,observer,materials,bounds,disposed=false,lastSnapshot=null,currentProfile=profile;const completed=new Set();
 const assertActive=()=>{if(disposed||!lease.valid||renderer.getContext?.().isContextLost?.())throw Error('WebGL frame unavailable or cancelled');};
 const cleanup=()=>{disposed=true;lastSnapshot=null;const errors=[],step=(key,fn)=>{if(completed.has(key))return;try{fn();completed.add(key);}catch(error){errors.push(error);}};
  step('abort',()=>lease.signal.removeEventListener('abort',interrupted));step('observer',()=>observer?.disconnect());step('window',()=>globalThis.window?.removeEventListener('resize',resize));
  step('controls-listener',()=>controls?.removeEventListener('change',safeDraw));step('controls',()=>controls?.dispose());
  step('materials',()=>{const errors=materials?.dispose()||[];if(errors.length)throw new AggregateError(errors,'Profile cleanup');});
  step('scene',()=>scene.remove(root));step('render-lists',()=>renderer.renderLists?.dispose());step('canvas',()=>{if(host&&renderer.domElement.parentNode===host)renderer.domElement.remove();});
  if(errors.length)throw new AggregateError(errors,'Stage cleanup retained for retry');
 };
 const interrupted=()=>{if(!disposed&&lease.signal.reason?.code==='WEBGL_CONTEXT_LOST')onError(Error('WebGL 上下文已丢失；不会回退为离线缩略图'));};
 function draw(){assertActive();renderer.render(scene,camera);assertActive();
  const target=controls?.target||bounds.getCenter(new THREE.Vector3());
  const value={modelSHA256:gltf.previewSHA256,backend:{id:ENTITY_CAPABILITIES.backendId,revision:ENTITY_CAPABILITIES.revision,environment:ENTITY_CAPABILITIES.environment},algorithm:{id:currentProfile.algorithmId,revision:currentProfile.algorithmRevision},profile:currentProfile,perInstanceOverrides:{},materialRules:{materialMode:currentProfile.parameters.materialMode,geometryAndUVUnchanged:true},camera:{type:'perspective',basis:'gltf-world-right-handed-y-up',fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),matrixWorld:camera.matrixWorld.toArray(),projectionMatrix:camera.projectionMatrix.toArray(),target:target.toArray()},frame:{mode:'original-world-bounds',min:bounds.min.toArray(),max:bounds.max.toArray()},pose:{mode:'gltf-default-static',animationApplied:false},clip:null,time:0,dimensions:{width:renderer.domElement.width,height:renderer.domElement.height,dpr:renderer.getPixelRatio()},background:{rgb:renderer.getClearColor(new THREE.Color()).getHexString(),alpha:renderer.getClearAlpha()},renderTarget:{format:'rgba8-default-framebuffer',dynamicRange:'ldr',colorSpace:'srgb'},colorPipeline:currentProfile.colorPipeline,postPipeline:currentProfile.postPipeline};
  // Semantic revision is stable for an identical state, never a request/draw counter.
  lastSnapshot=freezeSnapshot({...value,stateRevision:'entity-frame/v2:'+JSON.stringify(value)});return lastSnapshot;
 }
 function safeDraw(){try{draw();}catch(error){onError(error);}}
 function reset(){assertActive();const center=bounds.getCenter(new THREE.Vector3()),radius=Math.max(bounds.getSize(new THREE.Vector3()).length()/2,.0001),vfov=THREE.MathUtils.degToRad(camera.fov)/2,hfov=Math.atan(Math.tan(vfov)*camera.aspect),distance=radius/Math.sin(Math.min(vfov,hfov))*DEFAULT_CAMERA.padding;
  camera.near=Math.max(distance/1000,.00001);camera.far=distance*100;camera.position.copy(center).add(new THREE.Vector3(...DEFAULT_CAMERA.direction).normalize().multiplyScalar(distance));camera.lookAt(center);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  if(controls){controls.target.copy(center);controls.update();controls.saveState();}return draw();
 }
 function resize(){if(disposed)return;const w=host?Math.max(1,host.clientWidth):width,h=host?Math.max(1,host.clientHeight):height;renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(lastSnapshot)draw();}
 try{
  assertActive();if(!root)throw Error('GLB 中未找到可见场景');scene.add(root);root.traverse(o=>{if(o.isMesh&&!o.material)o.material=new THREE.MeshStandardMaterial({color:0xb9bfac,roughness:.85});});bounds=visibleWorldBounds(root);
  const hemisphere=new THREE.HemisphereLight(0xffffff,0x777a71,2.5),key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,5,4);scene.add(hemisphere,key);materials=createMaterialProfileController(root);
  const apply=next=>{assertActive();configureThreeProfile(next,{renderer,hemisphere,key,materials});currentProfile=next;if(lastSnapshot)draw();};apply(profile);
  if(host)host.replaceChildren(renderer.domElement);
  if(interactive){controls=controlsFactory(camera,renderer.domElement);controls.enableDamping=false;controls.enablePan=true;const radius=Math.max(bounds.getSize(new THREE.Vector3()).length()/2,.0001);controls.minDistance=radius*.05;controls.maxDistance=radius*40;controls.addEventListener('change',safeDraw);}
  lease.signal.addEventListener('abort',interrupted,{once:true});resize();reset();
  if(host){if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>{try{resize();}catch(error){onError(error);}});observer.observe(host);}else globalThis.window?.addEventListener('resize',resize);}
  return {draw,reset,resize,setProfile:apply,dispose:cleanup,getSnapshot:()=>lastSnapshot,getPreviewKey:()=>lastSnapshot?previewKey(lastSnapshot):null};
 }catch(error){try{cleanup();}catch(cleanupError){const failure=new AggregateError([error,cleanupError],'Stage construction and cleanup failed');failure.stageForCleanup={dispose:cleanup};throw failure;}throw error;}
}
