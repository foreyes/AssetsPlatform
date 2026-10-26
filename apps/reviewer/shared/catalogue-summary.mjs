// Counts describe declared catalogue records; none are rendering-verification receipts.
export function activeConditions(state) {
  const labels = {query:'搜索', type:'技术类型', category:'目录类别', review:'审阅', preview:'预览入口', animation:'动画/特效'};
  const result = Object.entries(labels).filter(([key]) => state[key] && state[key] !== 'all').map(([key,label]) => ({key,label,value:state[key]}));
  for (const [key,value] of Object.entries(state.facets || {})) if (value && value !== 'all') result.push({key:'facet:'+key,label:'facet '+key,value});
  for (const [key,value] of Object.entries(state.semantic || {})) {
    if (!value || value === 'all' || Array.isArray(value) && !value.length) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      for(const [mode,values] of Object.entries(value)) {
        if(Array.isArray(values) && !values.length)continue;
        result.push({key:`semantic:${key}:${mode}`,label:`语义 ${key} ${mode}`,value:Array.isArray(values)?values.join(' / '):values===null?'未知':String(values)});
      }
    } else result.push({key:'semantic:'+key,label:'语义 '+key,value:Array.isArray(value)?value.join(' / '):String(value)});
  }
  return result;
}
export function catalogueSummary({config,objects=[],resources=[],matched=[],page={start:0,end:0},state={}}) {
  const byType = Object.create(null);
  for (const resource of resources) byType[resource.type || 'other'] = (byType[resource.type || 'other'] || 0) + 1;
  const declaredCoverage = objects.filter(item => item.coverage && ['root','child','technical-preview'].includes(item.coverage.role));
  const known=new Set(objects.map(item=>item.id));
  const declaredLinks = objects.flatMap(item => (Array.isArray(item.coverage?.contains) ? [...new Set(item.coverage.contains.filter(id=>typeof id==='string'))] : []).map(id => [item.id,id]));
  const contains=declaredLinks.filter(([parent,id])=>parent!==id&&known.has(id));
  const unresolved=declaredLinks.length-contains.length;
  const parents = new Map();
  for (const [parent,id] of contains) { const list=parents.get(id)||[]; list.push(parent); parents.set(id,list); }
  return {
    projectId:config.projectId || config.id || '未知',datasetId:config.datasetId || '未知',
    objects:objects.length,resources:resources.length,byType,matched:matched.length,
    range:matched.length ? `${page.start}–${page.end}` : '0–0',
    modelEntrances:objects.filter(item => item.modelUrl || item.modelAsset).length,
    coverage:declaredCoverage.length ? {declared:declaredCoverage.length,unknown:objects.length-declaredCoverage.length,contains:contains.length,unresolved,overlaps:[...parents.values()].filter(list=>list.length>1).length} : null,
    conditions:activeConditions(state)
  };
}
export function clearCondition(state,key) {
  if (key.startsWith('facet:')) state.facets[key.slice(6)]='all';
  else if (key.startsWith('semantic:')) { const [,field,mode]=key.split(':'); if(mode) {delete state.semantic[field][mode];if(!Object.keys(state.semantic[field]).length)delete state.semantic[field];} else delete state.semantic[field]; }
  else state[key]=key==='query'?'':'all';
  state.page=1;
}
