import {createThumbnailQueue,CARD_RENDER,thumbnailIdentity} from './thumbnail-runtime.js';
import {automaticPreviewReason} from './model-resource.js';
// Intersection deltas reconcile keys; unrelated scroll events never reset live work.
export function createVisiblePreviewGrid({getProfile,onState=()=>{},queueFactory=createThumbnailQueue,Observer=globalThis.IntersectionObserver,document:doc=globalThis.document,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let entries=[],visible=new Set(),observer=null,generation=0,paused=false,closed=false,timer=null;const submitted=new Map();
 const queue=queueFactory({onInvalidate:()=>invalidate()});
 function clearScheduled(){if(timer!==null){clearTimer(timer);timer=null;}}
 function cancel(){generation++;queue.cancel();submitted.clear();clearScheduled();}
 function paint(entry,state){if(!entry.host.isConnected)return;const target=entry.host.querySelector('.realtime-surface');if(!target)return;target.replaceChildren();if(state.status==='ready'){const img=doc.createElement('img');img.src=state.url;img.alt=entry.asset.name+' · 浏览器实时渲染';img.dataset.renderIdentity=state.identity;target.append(img);target.dataset.state='ready';}else{target.textContent=state.message||'正在等待实时预览';target.dataset.state=state.status;}onState(entry,state);}
 function renderVisible(){timer=null;if(closed||paused||doc?.hidden)return;const token=generation,profile=getProfile(),keys=[];
  for(const entry of entries){if(!visible.has(entry.host)){submitted.delete(entry.host);continue;}try{const reason=automaticPreviewReason(entry.asset);if(reason){paint(entry,{status:'deferred',message:reason});continue;}const identity=thumbnailIdentity(entry.asset,profile);keys.push(identity);if(submitted.get(entry.host)===identity)continue;submitted.set(entry.host,identity);paint(entry,{status:'loading',message:'浏览器实时渲染中…'});queue.request(entry.asset,profile,result=>{if(token!==generation||paused||closed||!visible.has(entry.host)||!entry.host.isConnected||submitted.get(entry.host)!==identity)return;paint(entry,result.status==='ready'?result:{status:'error',message:'实时渲染暂不可用：'+result.error.message});});}catch(error){paint(entry,{status:'error',message:'实时预览声明无效：'+error.message});}}
  queue.retain?.(keys);
 }
 function refresh(){if(closed||paused||doc?.hidden)return;if(timer===null)timer=setTimer(renderVisible,32);}
 function invalidate(){cancel();refresh();}
 function observe(next){cancel();observer?.disconnect();observer=null;entries=next.slice(0,CARD_RENDER.maxVisible);visible=new Set();for(const e of entries)paint(e,{status:'queued',message:'等待进入可见区域'});
  if(Observer){observer=new Observer(changes=>{for(const change of changes){if(change.isIntersecting)visible.add(change.target);else{visible.delete(change.target);submitted.delete(change.target);}}refresh();},{root:null,rootMargin:'0px',threshold:.01});for(const e of entries)observer.observe(e.host);}
  else{for(const e of entries){const r=e.host.getBoundingClientRect();if(r.bottom>0&&r.top<(globalThis.innerHeight||0))visible.add(e.host);}refresh();}
 }
 const visibility=()=>{if(doc.hidden)cancel();else refresh();};doc?.addEventListener?.('visibilitychange',visibility);
 return {observe,refresh,pause(value=true){paused=value;cancel();if(!paused)refresh();},invalidateProfile(){for(const e of entries)paint(e,{status:'queued',message:'渲染方式已更新，等待实时预览'});invalidate();},dispose(){closed=true;cancel();observer?.disconnect();queue.dispose();entries=[];visible.clear();doc?.removeEventListener?.('visibilitychange',visibility);},get stats(){return {...queue.stats,visible:visible.size,entries:entries.length,paused};}};
}
