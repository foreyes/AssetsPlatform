// DOM/UI composition belongs only in the common frontend, never data adapters.
export function configureShell({project,state,onFacets,onLayout,onDataset,onProjectLeave}){
 const {config,directory,entry}=project,$=id=>document.getElementById(id);
 document.title=config.label+' · 资产检查站';
 $('project-brand').textContent='ASSET REVIEW';$('project-label').textContent=config.label;$('project-footer').textContent=config.label.toUpperCase()+' · ASSET REVIEW';
 const select=$('project-switch');select.replaceChildren();for(const p of directory.projects){const option=document.createElement('option');option.value=p.id;option.textContent=p.label||p.id;select.append(option)}select.value=entry.id;
 select.onchange=()=>{if(!directory.projects.some(p=>p.id===select.value))throw Error('Unknown registered project');onProjectLeave?.();const url=new URL(location.href);url.searchParams.set('project',select.value);location.assign(url.href)};
 // Full navigation intentionally terminates the old renderer/queue/storage realm.
 // The new descriptor receives a fresh project+dataset cache namespace.
 for(const [id,visible]of [['animation-filter',config.capabilities.animationFilters],['animation-filter-hint',config.capabilities.animationFilters],['offline-consumer-link',config.sharedSelections]]){const control=$(id);if(control)control.hidden=!visible};

 $('default-profile-note').textContent='保留此浏览器已选模式 · '+(config.defaultProfileLabel||'按项目能力提供');
 const stats=[['可预览物件','有模型资源可供查看'],['物件总数','当前目录收录的物件'],['资源总数','模型、贴图、材质等关联资源']];
 document.querySelectorAll('.stats > div').forEach((el,i)=>{if(i<3){el.querySelector('span').textContent=stats[i][0];el.querySelector('small').textContent=stats[i][1]}});
 const facets=$('facet-filters');facets.replaceChildren();for(const spec of config.facets||[]){const label=document.createElement('label');label.textContent=spec.label;const control=document.createElement('select');control.dataset.facet=spec.key;control.setAttribute('aria-label',spec.label);for(const option of spec.options){const el=document.createElement('option');el.value=option.value;el.textContent=option.label;control.append(el)}control.value=state.facets[spec.key]??'all';control.onchange=()=>onFacets(spec.key,control.value);label.append(control);facets.append(label)}
 for(const layout of ['grid','list'])$('layout-'+layout).onclick=()=>{onLayout(layout);for(const other of ['grid','list'])$('layout-'+other).setAttribute('aria-pressed',String(layout===other))};
 $('dataset-select').onchange=event=>onDataset(event.target.value);
}
export function renderEvidenceSections(container,evidence,{pageSize=50}={}){
 container.replaceChildren();container.hidden=!evidence?.sections?.length;
 for(const section of evidence?.sections||[]){const panel=document.createElement('details');panel.className='evidence-section';panel.open=section.open===true;const summary=document.createElement('summary');summary.textContent=section.title;panel.append(summary);
  for(const p of section.paragraphs||[]){const el=document.createElement('p');el.textContent=p;panel.append(el)}
  const rows=(target,entries)=>{const dl=document.createElement('dl');for(const[k,v]of entries||[]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=typeof v==='object'?JSON.stringify(v):String(v??'未提取');dl.append(dt,dd)}target.append(dl)};
  rows(panel,section.rows);if(section.raw!==undefined){const raw=document.createElement('pre');raw.textContent=JSON.stringify(section.raw,null,2);panel.append(raw)}
  if(section.records?.length){const records=section.records,types=[...new Set(records.map(r=>r.type).filter(Boolean))];let selected='all',limit=pageSize;const list=document.createElement('div'),more=document.createElement('button');more.className='light-btn';more.textContent='再显示 '+pageSize+' 条';const count=document.createElement('p');
   const render=()=>{list.replaceChildren();const shown=records.filter(r=>selected==='all'||r.type===selected);count.textContent=`显示 ${Math.min(limit,shown.length)} / ${shown.length} 条`;for(const record of shown.slice(0,limit)){const item=document.createElement('details'),title=document.createElement('summary');title.textContent=record.title||record.id||record.type||'源记录';item.append(title);rows(item,record.rows);if(record.raw!==undefined){const pre=document.createElement('pre');pre.textContent=JSON.stringify(record.raw,null,2);item.append(pre)}list.append(item)}more.hidden=limit>=shown.length};
   if(types.length>1){const filter=document.createElement('select');filter.setAttribute('aria-label',section.title+'类型');for(const type of ['all',...types]){const option=document.createElement('option');option.value=type;option.textContent=type==='all'?'全部类型':type;filter.append(option)}filter.onchange=()=>{selected=filter.value;limit=pageSize;render()};panel.append(filter)}
   more.onclick=()=>{limit+=pageSize;render()};panel.append(count,list,more);render();
  }container.append(panel)
 }
}
