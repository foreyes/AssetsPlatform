import * as THREE from './vendor/three.module.js';
import {createRendererPool} from './render-pool.js';
const listeners=new Set();let canvas=null;
const notify=event=>{for(const fn of listeners)try{fn(event);}catch{}};
export const sharedRendererPool=createRendererPool({
 create(){
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});canvas=renderer.domElement;
  canvas.className='model-canvas';canvas.setAttribute('aria-label','3D 模型：拖动旋转，滚轮缩放');
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();sharedRendererPool.setLost(true);notify('lost');});
  canvas.addEventListener('webglcontextrestored',()=>{sharedRendererPool.setLost(false);notify('restored');});
  return renderer;
 },
 dispose(renderer){renderer.renderLists?.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();canvas=null;},
});
export function subscribeContext(fn){listeners.add(fn);return()=>listeners.delete(fn);}
export function sharedRendererStats(){return sharedRendererPool.stats;}
