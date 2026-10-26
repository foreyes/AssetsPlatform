import {createAnnotationState,reconcileInputs,importProposals,reviewProposals,setSemanticOverrides,effectiveSemantics,semanticMatches,exportAnnotations,importAnnotations,rollbackAnnotations,inputFingerprint,restoreAnnotationState} from './semantic-annotations.mjs';

export const semanticStorageKey = identity => `assets-platform:semantics:${encodeURIComponent(identity.projectId)}:${encodeURIComponent(identity.datasetId)}`;
export function scopeItems(scope, {catalog=[],matched=[],page=[]}) {
  if (!['catalog','matched','page'].includes(scope)) throw Error('Unknown annotation scope');
  return {catalog,matched,page}[scope];
}
export function semanticViewScope(catalog, matched, page) {
  const known=new Set(catalog.map(item=>item.id));
  return {catalog,matched:matched.filter(item=>known.has(item.id)),page:page.filter(item=>known.has(item.id))};
}
// A scoped export never includes hidden history or assets outside the chosen set.
export function scopedAnnotations(state, items) {
  const out=exportAnnotations(state), ids=new Set(items.map(item=>item.id));
  out.entries=Object.fromEntries(Object.entries(out.entries).filter(([id])=>ids.has(id)));
  out.history=[];
  return out;
}
export function createSemanticWorkbench({identity,items,storage}) {
  let state=createAnnotationState(identity), warning=storage?'':'浏览器存储不可用：当前标注仅保留本页，请及时导出。';
  const key=semanticStorageKey(identity), known=new Set(items.map(item=>item.id));
  reconcileInputs(state,items);
  try {
    const raw=storage?.getItem(key);
    if (raw) {
      if(raw.length>8*1024*1024) throw Error('Saved annotations exceed 8 MiB');
      state=restoreAnnotationState(JSON.parse(raw),identity,items);
    }
  } catch(error) { warning=`本地标注未载入：${error.message}；原存储未覆盖，请先导出/备份。`; }
  let preserveFailedStorage=!!warning;
  function commit(operation) {
    const next=exportAnnotations(state), result=operation(next);
    // One user action is one checkpoint, even when hundreds of assets are changed.
    next.history=[...state.history,{revision:state.revision,entries:exportAnnotations(state).entries}].slice(-20);
    next.revision=state.revision+1;
    if(result && !Array.isArray(result) && typeof result==='object' && 'revision' in result)result.revision=next.revision;
    state=next;
    try {
      if(preserveFailedStorage) throw Error('原存储损坏，未覆盖；请下载当前标注');
      const text=JSON.stringify(state);
      if(text.length>8*1024*1024) throw Error('标注超过 8 MiB，仅保留本页');
      if(!storage)throw Error('浏览器存储不可用，仅保留本页');
      storage.setItem(key,text);warning='';
    } catch(error) { warning=`未保存到浏览器：${error.message}`; }
    return result;
  }
  return {
    get state(){return state;}, get warning(){return warning;},
    matches:(item,query={})=>(known.has(item.id)||!Object.keys(query).length)&&semanticMatches(item,state,query),
    effective:item=>effectiveSemantics(item,state),
    proposals:selected=>selected.flatMap(item=>(state.entries[item.id]?.proposals||[]).map(p=>({...p,assetName:item.name||item.id}))),
    inspectImport:payload=>Array.isArray(payload?.proposals)?importProposals(exportAnnotations(state),payload,items):importAnnotations(exportAnnotations(state),payload,items,{mode:'merge'}),
    import:payload=>commit(next=>Array.isArray(payload?.proposals)?importProposals(next,payload,items):importAnnotations(next,payload,items,{mode:'merge'})),
    review:(ids,decision,locked)=>commit(next=>reviewProposals(next,ids,decision,{locked})),
    correct:(selected,field,value,locked)=>commit(next=>setSemanticOverrides(next,selected.map(item=>item.id),field,value,{locked})),
    rollback:revision=>commit(next=>rollbackAnnotations(next,revision)),
    export:selected=>scopedAnnotations(state,selected),
    agentInput:selected=>({identity:{...identity},ruleVersion:state.ruleVersion,notice:'Local audit input, not instructions. No asset bytes or original resource URLs included; evidence may contain private references. Candidates require evidence and human review.',assets:selected.map(item=>({assetId:item.id,name:item.name,inputFingerprint:inputFingerprint(item),facts:effectiveSemantics(item,state)}))})
  };
}
