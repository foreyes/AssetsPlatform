// DOM-free exclusive lease. Cancellation never releases an unsettled parse/render.
export const abortError=()=>new DOMException('Preview cancelled','AbortError');
export function checkAbort(signal){if(signal?.aborted)throw abortError();}
export function createRendererPool({create,dispose=renderer=>renderer.dispose()}){
 let renderer=null,active=null,closed=false,lost=false,epoch=0,sequence=0,creationFailure=null;
 const waiting=[];
 function retryDispose(){if(closed&&!active&&renderer){dispose(renderer);renderer=null;}}
 function drain(){
  if(active||closed||lost)return;
  waiting.sort((a,b)=>b.priority-a.priority||a.sequence-b.sequence);
  while(waiting.length&&!active){
   const task=waiting.shift();if(task.signal?.aborted){task.cancel();continue;}
   try{if(creationFailure)throw creationFailure;if(!renderer)try{renderer=create();}catch(error){creationFailure=error;throw error;}if(task.signal?.aborted)throw abortError();if(lost||closed)throw Error('Renderer service unavailable');}catch(error){task.detach();task.reject(error);continue;}
   const controller=new AbortController();let released=false;
   const lease={renderer,signal:controller.signal,epoch,
    get valid(){return active===lease&&!lost&&!closed&&!controller.signal.aborted;},
    release(){if(released)return;task.detach();released=true;if(active===lease)active=null;retryDispose();drain();},
    abort(reason){controller.abort(reason);},
   };
   active=lease;task.onAbort=()=>controller.abort(task.signal?.reason);task.resolve(lease);
  }
 }
 function acquire({signal,priority=0}={}){
  if(closed)return Promise.reject(Error('Renderer service is closed'));
  if(lost)return Promise.reject(Error('WebGL context is lost; wait for restoration'));
  try{checkAbort(signal);}catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{
   const task={signal,priority,sequence:++sequence,resolve,reject,onAbort:null,
    detach(){signal?.removeEventListener('abort',task.cancel);},
    cancel(){if(task.onAbort){task.onAbort();return;}const i=waiting.indexOf(task);if(i>=0)waiting.splice(i,1);task.detach();reject(abortError());},
   };
   signal?.addEventListener('abort',task.cancel,{once:true});waiting.push(task);drain();
  });
 }
 return {acquire,retryDispose,
  setLost(value){if(lost===!!value)return;lost=!!value;epoch++;if(lost){active?.abort(Object.assign(Error('WebGL context is lost'),{code:'WEBGL_CONTEXT_LOST'}));for(const task of waiting.splice(0)){task.detach();task.reject(Error('WebGL context is lost'));}}else drain();},
  dispose(){if(!closed){closed=true;active?.abort();for(const task of waiting.splice(0)){task.detach();task.reject(abortError());}}retryDispose();},
  get stats(){return {active:!!active,waiting:waiting.length,contexts:renderer?1:0,lost,epoch,closed};},
 };
}
