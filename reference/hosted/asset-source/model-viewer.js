import {createPreviewLifecycle} from './viewer-lifecycle.js';
import {loadModelResource,retireModel} from './model-resource.js';
import {sharedRendererPool} from './render-runtime.js';
import {createRenderStage} from './render-stage.js';
import {profileById,DEFAULT_PROFILE} from './entity-render-profiles.js';
export {validateSelfContainedGLB,disposeGLTF} from './model-resource.js';
export function createModelViewer(host,{onLoading,onReady,onError,profile=profileById(DEFAULT_PROFILE),pool=sharedRendererPool,loadModel=loadModelResource,stageFactory=createRenderStage}={}){
 let currentProfile=profile,currentStage=null;
 const load=async(asset,signal)=>{const lease=await pool.acquire({signal,priority:100});try{return {gltf:await loadModel(asset,{signal:lease.signal}),lease};}catch(error){lease.release();throw error;}};
 const ownStage=(stage,resource)=>{resource.stageOwner=stage;return {...stage,dispose(){if(currentStage===stage)currentStage=null;stage.dispose();resource.stageOwner=null;}};};
 const createStage=(resource,asset)=>{try{const stage=stageFactory(resource.gltf,asset,{lease:resource.lease,host,profile:currentProfile,interactive:true,dpr:Math.min(globalThis.window?.devicePixelRatio||1,2),onError});currentStage=stage;return ownStage(stage,resource);}catch(error){if(error?.stageForCleanup)error.stageForCleanup=ownStage(error.stageForCleanup,resource);throw error;}};
 const disposeResource=resource=>{const errors=[];if(!resource.modelDisposed)try{retireModel(resource.gltf);resource.modelDisposed=true;}catch(error){errors.push(error);}if(resource.stageOwner)errors.push(Error('Stage cleanup is still pending'));else if(resource.modelDisposed)try{resource.lease.release();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Model cleanup retained for retry');};
 const lifecycle=createPreviewLifecycle({load,createStage,disposeResource,onLoading,onReady,onError});
 return {...lifecycle,setProfile(next){try{currentStage?.setProfile(next);currentProfile=next;return true;}catch(error){onError?.(error);return false;}},getSnapshot(){return currentStage?.getSnapshot()||null;},getPreviewKey(){return currentStage?.getPreviewKey()||null;},get active(){return lifecycle.active;},get cleanupPending(){return lifecycle.cleanupPending;},get pendingLoads(){return lifecycle.pendingLoads;}};
}
