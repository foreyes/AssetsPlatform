import {SUPPLEMENTAL_DATASETS,SUPPLEMENTAL_LINKS,supplementalRoot} from '../shared/entity-supplemental-pins.mjs';
export async function readSupplementalSnapshot(readJSON,url,{timeoutMs=5000}={}){
 const controller=new AbortController();let timer;
 try{return await Promise.race([Promise.resolve().then(()=>readJSON(url,false,{signal:controller.signal})),new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},Math.min(5000,Math.max(1,timeoutMs)));})]);}catch{return null;}finally{clearTimeout(timer);}
}
// Resource data overlay only. No UI events, state, alternative auth or renderer.
export function applyEntitySupplementalPreviews({sourceCatalog,libraryManifest,snapshot,resolver,renderableAsset}){
 const states=new Map(),statuses=new Map();
 const valid=snapshot?.schema==='entity-supplemental-preview-links/1'&&snapshot.source==='server-owned-fixed-87-pins'&&snapshot.animation==='not-playable'&&snapshot.originalRuntimeComplete===false&&Array.isArray(snapshot.datasets)&&snapshot.datasets.length===2&&new Set(snapshot.datasets.map(d=>d.sourceProject)).size===2;
 for(const d of SUPPLEMENTAL_DATASETS){const row=valid?snapshot.datasets.find(r=>r.sourceProject===d.sourceProject):null;states.set(d.sourceProject,row&&row.dataset===d.dataset&&row.version===d.version&&row.revision===d.revision&&row.state==='ready'?null:row?.reason||'ready-links-unavailable-identity-or-version-not-verified');}
 const entities=new Map(sourceCatalog.entities.map(e=>[e.id,e])),assets=libraryManifest.sources.flatMap(s=>s.assets),replacements=new Map();
 for(const pin of SUPPLEMENTAL_LINKS){
  const entity=entities.get(pin.entityId);if(!entity||entity.source!==pin.sourceProject||entity.publication?.state!=='eligible')continue;
  const related=assets.filter(a=>a.entity_ids?.includes(pin.entityId));
  if(related.some(a=>a.coverage!=='associated-model'&&renderableAsset(a))){statuses.set(pin.entityId,{state:'existing-primary-preserved',reason:null});continue;}
  const reason=states.get(pin.sourceProject);if(reason){statuses.set(pin.entityId,{state:'missing',reason});continue;}
  const original=related.find(a=>a.resource_id===pin.legacyResourceId);
  if(!original||original.sha256!==pin.modelSHA256||original.bytes!==pin.modelBytes||original.entity_ids?.length!==1||original.entity_ids[0]!==pin.entityId){statuses.set(pin.entityId,{state:'missing',reason:'legacy-source-binding-mismatch'});continue;}
  const asset={...original,format:'glb',status:'ready',coverage:'static-assembly',preview_uri:pin.modelPath,preview_sha256:pin.modelSHA256,sha256:pin.modelSHA256,bytes:pin.modelBytes,supplementalEntityLink:{entityId:pin.entityId,project:pin.sourceProject,dataset:pin.dataset,version:pin.version,revision:pin.revision,resourceId:pin.resourceId}};
  delete asset.delivery;delete asset.transport;delete asset.nativeReadOnlyBatch;delete asset.nativeReadOnlySample;
  try{resolver.registerSupplementalAsset(asset,supplementalRoot(pin));replacements.set(pin.legacyResourceId,asset);statuses.set(pin.entityId,{state:'linked-static-preview',reason:null,dataset:pin.dataset,version:pin.version,revision:pin.revision,indexedResourceId:pin.resourceId,legacyResourceId:pin.legacyResourceId,root:supplementalRoot(pin)});}catch{statuses.set(pin.entityId,{state:'missing',reason:'supplemental-resource-capability-rejected'});}
 }
 return {library:{...libraryManifest,sources:libraryManifest.sources.map(s=>({...s,assets:s.assets.map(a=>replacements.get(a.resource_id)||a)}))},statuses};
}
