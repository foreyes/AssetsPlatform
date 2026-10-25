// Bounded byte preparation overlaps latency. Parsing/drawing/capture remain serial.
// Active resources retain their slot until real cleanup settles, including abort.
export function createPreviewQueue({rendererFactory,maxEntries=512,prepareConcurrency=2,makeURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}){
 if(!Number.isSafeInteger(prepareConcurrency)||prepareConcurrency<1||prepareConcurrency>4)throw Error('Invalid preparation bound');
 let renderer,disposed=false,running=false,preparing=0;const cache=new Map(),pending=new Map();let queue=[];
 const touch=key=>{const value=cache.get(key);if(value){cache.delete(key);cache.set(key,value);}return value;};
 function remember(key,blob){const url=makeURL(blob);cache.set(key,url);while(cache.size>maxEntries){const first=cache.keys().next().value;revokeURL(cache.get(first));cache.delete(first);}return url;}
 const current=task=>!disposed&&!task.stopped&&pending.get(task.key)===task;
 function finish(task,result){if(!current(task))return;pending.delete(task.key);for(const callback of task.callbacks)try{callback(result);}catch{/* One consumer cannot stall other cards. */}task.callbacks=[];}
 function stop(task){task.stopped=true;task.callbacks=[];if(pending.get(task.key)===task)pending.delete(task.key);task.controller.abort();}
 function drain(){
  if(disposed)return;renderer??=rendererFactory();queue=queue.filter(task=>current(task));
  const warm=()=>queue.filter(task=>task.state==='prepared'||task.state==='preparing').length;
  if(typeof renderer.prepare==='function')for(const task of queue){if(task.state!=='queued')continue;if(preparing>=prepareConcurrency||warm()>=prepareConcurrency)break;task.state='preparing';preparing++;
   Promise.resolve().then(()=>renderer.prepare(task.url,{...task.options,signal:task.controller.signal})).then(()=>{if(current(task))task.state='prepared';},error=>finish(task,{error,status:'error'})).finally(()=>{preparing--;drain();});
  }
  if(running)return;const task=queue.find(task=>task.state==='prepared'||(task.state==='queued'&&typeof renderer.prepare!=='function'));if(!task)return;
  queue.splice(queue.indexOf(task),1);task.state='rendering';running=true;
  // Calling immediately preserves the no-preparation API's synchronous start.
  let work;try{work=renderer.render(task.url,{...task.options,signal:task.controller.signal});}catch(error){work=Promise.reject(error);}
  Promise.resolve(work).then(blob=>{if(!current(task))return;if(!(blob instanceof Blob))throw Error('缩略图渲染结果无效');finish(task,{url:remember(task.key,blob),status:'ready'});},error=>finish(task,{error,status:'error'})).catch(error=>finish(task,{error,status:'error'})).finally(()=>{if(pending.get(task.key)===task)pending.delete(task.key);running=false;drain();});
  // While this one model parses/draws, prepare at most two successor byte sets.
  if(typeof renderer.prepare==='function')drain();
 }
 return {
  request(key,url,options,callback){if(disposed)return;const hit=touch(key);if(hit){callback({url:hit,status:'ready'});return;}const prior=pending.get(key);if(prior){prior.callbacks.push(callback);return;}const task={key,url,options,callbacks:[callback],state:'queued',stopped:false,controller:new AbortController()};pending.set(key,task);queue.push(task);drain();},
  peek:key=>touch(key),
  retain(keys){const keep=new Set(keys);for(const task of pending.values())if(!keep.has(task.key))stop(task);queue=queue.filter(current);drain();},
  cancel(){for(const task of pending.values())stop(task);queue=[];},
  dispose(){if(disposed)return;for(const task of pending.values())stop(task);disposed=true;queue=[];renderer?.dispose?.();for(const url of cache.values())revokeURL(url);cache.clear();},
  get stats(){return {cached:cache.size,pending:pending.size,running,preparing,prepared:queue.filter(t=>t.state==='prepared').length,prepareConcurrency,disposed};},
 };
}
