// One active preview session. Parsing may finish after AbortController cancellation.
// Failed cleanup remains owned for retry; one failing disposer must not skip the others.
export function createPreviewLifecycle({load,createStage,disposeResource,onLoading=()=>{},onReady=()=>{},onError=()=>{},onCleanupError=()=>{}}){
 let current=null,flushing=false,pendingLoads=0;const pending=new Set();
 function retryCleanup(){
  if(flushing)return;flushing=true;
  try{for(const s of [...pending]){
   const errors=[];
   if(s.stage)try{s.stage.dispose();s.stage=null;}catch(error){errors.push(error);}
   if(s.resource)try{disposeResource(s.resource);s.resource=null;}catch(error){errors.push(error);}
   if(!s.stage&&!s.resource)pending.delete(s);
   if(errors.length)try{onCleanupError(errors);}catch{} // Diagnostic callbacks cannot interrupt disposal.
  }}finally{flushing=false;}
 }
 function retire(s){s.closed=true;s.abort.abort();pending.add(s);retryCleanup();}
 function close(){const s=current;current=null;if(s)retire(s);else retryCleanup();}
 async function open(asset){
  close();const s={abort:new AbortController(),closed:false,stage:null,resource:null};current=s;onLoading(asset);pendingLoads++;
  try{
   const resource=await load(asset,s.abort.signal);s.resource=resource;
   if(current!==s||s.closed){retire(s);return false;}
   try{s.stage=createStage(resource,asset);}catch(error){if(error?.stageForCleanup)s.stage=error.stageForCleanup;throw error;}
   if(current!==s||s.closed){retire(s);return false;}
   onReady(asset);return true;
  }catch(error){if(current!==s||s.closed){if(s.resource||s.stage)retire(s);return false;}close();if(error?.name!=='AbortError')onError(error,asset);return false;}finally{pendingLoads--;}
 }
 return {open,close,retryCleanup,resize(){current?.stage?.resize();},reset(){current?.stage?.reset();},get active(){return current!==null;},get cleanupPending(){return pending.size;},get pendingLoads(){return pendingLoads;}};
}
