import {CATEGORIES,TAGS,DIMENSIONS,ANIMATION_FACTS} from './semantic-annotations.mjs';
import {createSemanticWorkbench,scopeItems} from './semantic-workbench.mjs';
const labels={categories:'内容分类',tags:'用途标签',dimensions:'表现维度',sourceTracks:'源轨道',skeletonPresent:'骨骼',bindingConfirmed:'绑定确认',conversionSupported:'转换支持',playbackVerified:'人工播放验证'};
const categoryNames={food:'食物',item:'物品',plant:'植物',environment:'环境',creature:'生物',character:'角色',firearm:'枪械',weapon:'武器',tool:'工具',structure:'设施',vehicle:'载具',effect:'特效',ui:'界面',other:'其他'};
const display=value=>categoryNames[value] ? `${categoryNames[value]} (${value})` : value;
export function mountSemanticUI({host,identity,items,storage,getScope,getQuery,setQuery,onChange,download,notify,confirmAction=message=>globalThis.confirm(message)}) {
  const document=host.ownerDocument, model=createSemanticWorkbench({identity,items,storage});
  let disposed=false,readGeneration=0,proposalPage=1;
  const el=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!==null)node.textContent=text;for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);return node;};
  const button=(text,run)=>{const b=el('button',text,{type:'button',class:'light-btn'});b.onclick=()=>attempt(run);return b;};
  const select=(name,options)=>{const wrap=el('label',name),s=el('select',null,{'aria-label':name});for(const[value,text]of options)s.append(el('option',text,{value}));wrap.append(s);return [wrap,s];};
  const attempt=run=>{try{return run();}catch(error){notify(`语义操作未完成：${error.message}`);}};
  const section=el('details',null,{class:'semantic-panel'});section.append(el('summary','语义标签与本地候选审阅'));
  section.append(el('p','内容、用途、2D/3D、技术类型与动画证据独立。默认同维度任一 (OR)，跨维度全部 (AND)。不会调用 AI、上传资产或改变播放准入。'));
  const filterBox=el('div',null,{class:'semantic-controls'}),controls={};
  for(const[field,values]of Object.entries({categories:CATEGORIES,tags:TAGS,dimensions:DIMENSIONS})) {
    const [wrap,s]=select(labels[field],values.map(v=>[v,display(v)]));s.multiple=true;s.size=4;
    const [modeWrap,mode]=select(`${labels[field]}匹配方式`,[['any','包含任一 OR'],['all','包含全部 AND'],['exclude','排除所选']]);
    controls[field]={s,mode};filterBox.append(wrap,modeWrap);
    s.onchange=mode.onchange=()=>{const query={...getQuery()},values=[...s.selectedOptions].map(o=>o.value);if(values.length)query[field]={[mode.value]:values};else delete query[field];setQuery(query);proposalPage=1;onChange();};
  }
  const toggles={};
  for(const[field,title]of [['unannotated','未标注'],['unknown','表现维度未知']]){
    const label=el('label',title),input=el('input',null,{type:'checkbox'});label.prepend(input);filterBox.append(label);toggles[field]=input;
    input.onchange=()=>{const query={...getQuery()};if(input.checked)query[field]=true;else delete query[field];setQuery(query);proposalPage=1;onChange();};
  }
  const animationControls={};
  for(const field of ANIMATION_FACTS){const[wrap,s]=select(labels[field],[['all','不限'],['true','有已记录证据'],['false','有明确否定证据'],['unknown','未知']]);animationControls[field]=s;filterBox.append(wrap);s.onchange=()=>{const query={...getQuery(),animation:{...getQuery().animation}};if(s.value==='all')delete query.animation[field];else query.animation[field]=s.value==='unknown'?null:s.value==='true';if(!Object.keys(query.animation).length)delete query.animation;setQuery(query);proposalPage=1;onChange();};}
  section.append(filterBox);
  const ops=el('div',null,{class:'semantic-controls'}),[scopeWrap,scope]=select('批量与导出范围',[['page','当前结果页（当前数据集）'],['matched','当前匹配集合（当前数据集）'],['catalog','全目录（当前数据集）']]);ops.append(scopeWrap);
  const scopeStatus=el('p','',{'aria-live':'polite'}),warning=el('p','',{role:'status'});section.append(scopeStatus,warning);
  const selected=()=>scopeItems(scope.value,getScope());
  const refresh=()=>{update();onChange();};
  const confirmScope=action=>{const count=selected().length;if(!count){notify('所选范围为 0 项，没有更改。');return false;}return confirmAction(`${action}：${scope.selectedOptions[0].textContent}，${count} 项资产。确定？`);};
  const [fieldWrap,field]=select('人工纠正字段',[['category','内容分类'],['tag','用途标签'],['dimension','表现维度']]);
  const [valueWrap,value]=select('人工纠正值',[]);const valuesForField=()=>{value.replaceChildren(el('option','清除该字段（人工留空）',{value:''}));for(const v of {category:CATEGORIES,tag:TAGS,dimension:DIMENSIONS}[field.value])value.append(el('option',display(v),{value:v}));};valuesForField();field.onchange=valuesForField;
  const lockWrap=el('label','锁定人工决策'),lock=el('input',null,{type:'checkbox'});lock.checked=true;lockWrap.prepend(lock);
  ops.append(fieldWrap,valueWrap,lockWrap,button('对范围应用人工纠正',()=>{if(confirmScope('应用人工纠正')){model.correct(selected(),field.value,value.value||null,lock.checked);refresh();}}));
  for(const[decision,title]of [['accept','批量接受待审候选'],['reject','批量拒绝待审候选']])ops.append(button(title,()=>{const pending=model.proposals(selected()).filter(p=>p.status==='pending');if(!pending.length){notify('所选范围无待审候选。');return;}if(confirmAction(`${title}：${scope.selectedOptions[0].textContent}，${pending.length} 条候选；冲突和低置信度也会包括，请先查看证据。确定？`)){model.review(pending.map(p=>p.id),decision,lock.checked);refresh();}}));
  const exportJSON=(suffix,data)=>download(`semantic-${suffix}.json`,JSON.stringify(data,null,2),'application/json');
  ops.append(button('导出范围标注侧车',()=>exportJSON('annotations',model.export(selected()))),button('导出范围候选输入（无资产字节）',()=>exportJSON('agent-input',model.agentInput(selected()))));
  const file=el('input',null,{type:'file',accept:'.json,application/json','aria-label':'导入语义候选或标注 JSON'});
  file.onchange=async()=>{
    const selectedFile=file.files?.[0],generation=++readGeneration;if(!selectedFile)return;
    try {if(selectedFile.size>8*1024*1024)throw Error('JSON 超过 8 MiB');const text=await selectedFile.text();if(disposed||generation!==readGeneration)return;const payload=JSON.parse(text);const inspection=model.inspectImport(payload);
      if(!Array.isArray(payload?.proposals) && !confirmAction(`这是人工标注备份，不是 Agent 待审候选。将从文件 ${selectedFile.name||'JSON'} 合并 ${inspection.imported.length} 项资产的已接受/锁定人工决策。仅导入可信人工备份；建议先导出当前标注。确定合并？`))return;
      if(disposed||generation!==readGeneration)return;
      const result=model.import(payload);notify(`语义导入完成：${JSON.stringify(result)}`);refresh();}catch(error){notify(`语义导入失败：${error.message}`);}finally{if(generation===readGeneration)file.value='';}
  };ops.append(file);
  const [revisionWrap,revision]=select('回滚检查点',[]);ops.append(revisionWrap,button('回滚标注',()=>{if(revision.value&&confirmAction(`回滚本目录全部标注到检查点 ${revision.value}？建议先选择全目录导出。`)){model.rollback(Number(revision.value));refresh();}}));section.append(ops);
  section.append(el('p','导入仅合并同项目/数据集的候选或标注，不读取 JSON 中的 URL。导出仅包含所选范围且不含历史；证据可能含私人引用，分享前请检查。回滚检查点保留最近 20 次；范围导出不包含历史。'));
  const list=el('div',null,{class:'semantic-proposals'}),pager=el('div',null,{class:'semantic-controls'}),pageStatus=el('span','');
  pager.append(button('上一页候选',()=>{proposalPage=Math.max(1,proposalPage-1);update();}),pageStatus,button('下一页候选',()=>{proposalPage++;update();}));section.append(list,pager);host.replaceChildren(section);scope.onchange=()=>{proposalPage=1;update();};
  function update(){
    if(disposed)return;
    const query=getQuery();for(const[field,{s,mode}]of Object.entries(controls)){const selector=query[field]||{};mode.value=Array.isArray(selector)?'any':['any','all','exclude'].find(k=>selector[k]?.length)||'any';const values=Array.isArray(selector)?selector:selector[mode.value]||[];for(const option of s.options)option.selected=values.includes(option.value);}
    for(const[field,input]of Object.entries(toggles))input.checked=query[field]===true;
    for(const[field,s]of Object.entries(animationControls))s.value=Object.hasOwn(query.animation||{},field)?query.animation[field]===null?'unknown':String(query.animation[field]):'all';
    const rows=selected(),proposals=model.proposals(rows);warning.textContent=model.warning;
    scopeStatus.textContent=`${identity.projectId} / ${identity.datasetId} · ${scope.selectedOptions[0].textContent}：${rows.length} 项资产；${proposals.filter(p=>p.status==='pending').length} 条待审候选 · 修订 ${model.state.revision}`;
    const old=revision.value;revision.replaceChildren(el('option','选择检查点',{value:''}));for(const entry of model.state.history)revision.append(el('option',String(entry.revision),{value:String(entry.revision)}));revision.value=old;
    const pages=Math.max(1,Math.ceil(proposals.length/20));proposalPage=Math.min(proposalPage,pages);pageStatus.textContent=`候选 ${proposalPage} / ${pages} 页 · 共 ${proposals.length} 条`;list.replaceChildren();
    for(const p of proposals.slice((proposalPage-1)*20,proposalPage*20)){
      const row=el('article',null),title=el('strong',`${p.assetName} · ${p.field}: ${display(p.value)} · ${p.status}${p.locked?' · 锁定':''}`);
      row.append(title,el('p',`生成 ${p.method} / ${p.version} · 置信度 ${p.confidence??'未知'}（非保证） · 输入 ${p.inputFingerprint}`),el('p',`证据：${p.evidence.map(e=>`${e.source}: ${e.reference}`).join('；')} · 冲突：${p.conflicts?.join('；')||'无声明'}`));
      if(p.status==='pending')for(const[decision,title]of [['accept','接受'],['reject','拒绝']])row.append(button(title,()=>{model.review([p.id],decision,lock.checked);refresh();}));list.append(row);
    }
    if(!proposals.length)list.append(el('p','所选范围暂无候选。可导出本地输入供授权 Agent 准备候选，或直接人工纠正；本页面不自动推断名称或图片语义。'));
  }
  update();return {model,update,cancelPending(){readGeneration++;},dispose(){disposed=true;readGeneration++;host.replaceChildren();}};
}
