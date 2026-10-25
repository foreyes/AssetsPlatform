import {resolveSelectionAssets,fetchDeliveryShard} from './selection-manifest.mjs';
/** One shared UI module for both asset review sites; local drafts are never called shared. */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export async function mountPartnerSelections({enabled=true,siteId,legacyKey,items,getSelected,replaceSelected,openItem,getProfile}) {
 if(!enabled)return {changed(){},decorateDownloads(){}};
 const root=document.createElement('section');root.className='partner-selections';root.setAttribute('aria-label','身份与伙伴选择');
 root.innerHTML='<div class="partner-heading"><div><strong>我的身份与选择</strong><p id="partner-identity">正在核验站内登录身份…</p></div><button id="partner-refresh" class="light-btn">刷新共享清单</button></div><div id="partner-controls" hidden><label>展示昵称 <input id="partner-nickname" maxlength="32" placeholder="例如：肥猫"></label><button id="partner-publish" class="primary-btn">发布我的选择</button><button id="partner-load" class="light-btn">载入服务器版本</button><button id="partner-export" class="light-btn">导出我的 manifest</button><button id="partner-legacy" class="light-btn" hidden>导入此浏览器旧选择</button></div><p id="partner-status" role="status">勾选先存本浏览器。只有点击“发布我的选择”后，现有伙伴才可看到。</p><details class="partner-shared"><summary>伙伴的共享选择 <span id="partner-total"></span></summary><div id="partner-lists"></div></details><details class="partner-help"><summary>交给本地 dot / agent 与 Unity 导入边界</summary><p>导出 manifest 后交给你的本地 agent，并使用你自己的站点或 Drive 登录下载。清单不含凭据。GLB 是浏览器预览，不能保证拖入 Unity 即可用；仅明确标为已验证的 Unity 包可按其 README 导入。</p><p>网页渲染为近似，原 Shader 与引擎/管线版本须按交付包说明核验。审阅备注仍只保存在本浏览器，不会随选择发布。</p><p><a href="/AGENT-DOWNLOAD.md" target="_blank" rel="noopener">本地 agent 下载与 Unity 安全导入说明</a></p><div id="partner-delivery">交付状态载入中…</div></details>';
 document.querySelector('main > header').after(root);
 const $=id=>root.querySelector('#'+id),map=new Map(items.map(i=>[i.id,i]));
 let identity=null,mine=null,key=null,dirty=false,busy=false,draftNickname='',knownServerRevision=0;
 const status=(s)=>$('partner-status').textContent=s;
 const valid=ids=>Array.isArray(ids)?[...new Set(ids)].filter(id=>map.has(id)):[];
 const saveDraft=()=>{if(!key)return;try{localStorage.setItem(key,JSON.stringify({ids:[...getSelected()],nickname:$('partner-nickname').value,baseRevision:knownServerRevision,updatedAt:new Date().toISOString()}))}catch{status('本浏览器存储不可用，请导出备份。')}};
 const api=async(path,options={})=>{const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});let body;try{body=await r.json()}catch{throw Error('登录或网络不可用，请重新登录后刷新。')}if(!r.ok)throw Object.assign(Error(body.error||String(r.status)),{status:r.status});return body};
 const safeRun=fn=>async()=>{if(busy)return;busy=true;try{await fn()}catch(e){status(e.status===409?'服务器版本已变化。草稿未丢失，请先刷新并载入服务器版本，再合并所需选择。':`操作未完成：${e.message}。本地草稿未自动分享。`)}finally{busy=false}};
 const download=(name,value)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 const exportSelection=async(selection,filename,warnings=[])=>{
  const data=await fetch('/delivery-index.json',{credentials:'same-origin'}).then(r=>{if(!r.ok)throw Error('交付索引读取失败');return r.json()});
  const ids=valid(selection.ids),resolved=await resolveSelectionAssets(data,ids,fetchDeliveryShard);
  download(filename,{schema:'asset-review-selection-manifest/1',siteId,siteUrl:location.origin,generatedAt:new Date().toISOString(),selection:{...selection,ids},assets:resolved.map(a=>({...a,selected:ids.includes(a.id),files:a.files.map(f=>({...f,url:new URL(f.path,location.origin).href}))})),rendererProfile:getProfile(),rendererProfiles:data.rendererProfiles,delivery:data.delivery,access:{authenticationRequired:true,instruction:'Use your own authorized login; this manifest carries no credentials. Drive access is governed by your own existing permission, not link visibility.'},warnings:[...warnings,'GLB browser previews are not import-ready Unity packages.','Dependency references are not proof of full Unity dependency closure.','Browser shader modes are approximations, not original game shaders.']});
 };
 const renderLists=lists=>{$('partner-total').textContent=`(${lists.length})`;$('partner-lists').replaceChildren();for(const list of lists){const box=document.createElement('article');box.className='partner-list';box.innerHTML=`<div><strong>${esc(list.nickname)}的选择${list.userId===identity.userId?'（我）':''}</strong> · ${list.ids.length} 项</div><small>站内 ID：${esc(list.userId)} · 版本 ${list.revision} · ${esc(list.updatedAt)}</small><div class="partner-list-actions"><button class="light-btn" data-manifest>导出此清单 manifest</button><button class="light-btn" data-copy>将这些项加入我的草稿</button></div><details><summary>查看资产</summary><div class="partner-items"></div></details>`;box.querySelector('[data-manifest]').onclick=safeRun(async()=>{const plan=await api('/api/selections/manifest?user='+encodeURIComponent(list.userId));await exportSelection({...plan.selection,scope:'server-shared-selection'},`selection-${siteId}-${plan.selection.revision}.json`);status('已导出服务器共享清单的完整资源 manifest，不含登录凭据。')});box.querySelector('[data-copy]').onclick=()=>{replaceSelected(valid([...getSelected(),...list.ids]));changed();status('已加入你的本地草稿。未修改对方清单，也未自动发布。')};const entries=box.querySelector('.partner-items');for(const id of list.ids){const item=map.get(id),button=document.createElement('button');button.className='text-btn';button.textContent=item?.name||id;button.disabled=!item;button.onclick=()=>openItem(item);entries.append(button)}$('partner-lists').append(box)}if(!lists.length)$('partner-lists').textContent='还没有人发布选择。'};
 const refresh=async()=>{const data=await api('/api/selections');renderLists(data.lists);const current=data.lists.find(x=>x.userId===identity.userId);mine=current||null;if(current&&current.revision!==knownServerRevision)status('服务器清单已更新。本地草稿保留；点击“载入服务器版本”会替换当前草稿。');return data};
 const changed=()=>{if(!identity)return;dirty=true;saveDraft();status(`本浏览器草稿 ${getSelected().size} 项，尚未发布给伙伴。`)};
 $('partner-refresh').onclick=safeRun(async()=>{await refresh();status('共享清单已刷新。本地勾选仍是你的草稿。')});
 $('partner-nickname').oninput=changed;
 $('partner-publish').onclick=safeRun(async()=>{const nickname=$('partner-nickname').value.trim();if(!nickname)throw Error('请先设置昵称');const result=await api('/api/selections/me',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname,ids:[...getSelected()],revision:knownServerRevision})});mine=result.mine;knownServerRevision=mine.revision;dirty=false;saveDraft();await refresh();status(`已发布 ${mine.ids.length} 项，现有站点伙伴可查看。昵称不改变真实站内 ID。`)});
 $('partner-load').onclick=safeRun(async()=>{await refresh();if(dirty&&!confirm('这会用服务器版本替换当前浏览器草稿。继续吗？'))return;replaceSelected(valid(mine?.ids||[]));$('partner-nickname').value=mine?.nickname||'';knownServerRevision=mine?.revision||0;dirty=false;saveDraft();status('已载入本人服务器版本。其他人的清单未改变。')});
 $('partner-export').onclick=safeRun(async()=>{await exportSelection({userId:identity.userId,nickname:$('partner-nickname').value,ids:[...getSelected()],scope:'local-draft-not-shared',baseRevision:knownServerRevision},`selection-${siteId}-local-draft.json`,['Local draft is not visible to partners until published.']);status('已导出本地草稿 manifest；不会因此发布给伙伴。')});
 try{const session=await api('/api/selection/session');identity=session;mine=session.mine;knownServerRevision=mine?.revision||0;key=`asset-review-selection-v1:${siteId}:${identity.userId}`;$('partner-identity').textContent=`${session.email||'已登录'} · 站内 ID：${identity.userId}`;$('partner-controls').hidden=false;let saved=null;try{saved=JSON.parse(localStorage.getItem(key)||'null')}catch{};if(saved){replaceSelected(valid(saved.ids));draftNickname=saved.nickname||mine?.nickname||'';knownServerRevision=Number.isSafeInteger(saved.baseRevision)?saved.baseRevision:knownServerRevision;dirty=!same(getSelected(),mine?.ids||[])||draftNickname!==(mine?.nickname||'')}else{replaceSelected(valid(mine?.ids||[]));draftNickname=mine?.nickname||''}$('partner-nickname').value=draftNickname;status(dirty?'已恢复本浏览器草稿，尚未发布。':'勾选自动保存到当前身份的浏览器草稿；点击发布才会给伙伴看。');let legacy=[];try{legacy=valid(JSON.parse(localStorage.getItem(legacyKey)||'{}').selected)}catch{}if(legacy.length){$('partner-legacy').hidden=false;$('partner-legacy').onclick=()=>{replaceSelected(valid([...getSelected(),...legacy]));changed();$('partner-legacy').hidden=true;status('旧选择已加入当前身份的草稿，未自动发布。')}}await refresh()}catch(e){$('partner-identity').textContent='无法核验当前身份。请重新登录后刷新。';status('共享选择暂不可用；不会用昵称代替身份，也不会把旧浏览器选择自动归给当前账号。');}
 fetch('/delivery-status.json',{credentials:'same-origin'}).then(r=>r.json()).then(d=>{const el=$('partner-delivery');el.replaceChildren();for(const line of d.notes||[]){const p=document.createElement('p');p.textContent=line;el.append(p)}for(const pack of d.packages||[]){const p=document.createElement('p');p.textContent=`${pack.name}：${pack.statusLabel}`;if(pack.downloadUrl){const a=document.createElement('a');a.href=pack.downloadUrl;a.target='_blank';a.rel='noopener';a.textContent=pack.provider==='same-origin-site'?' 下载候选源码（未验证）':' 查看文件（按你的权限下载）';p.append(a)}el.append(p)}}).catch(()=>$('partner-delivery').textContent='交付包状态暂未核验；不提供无权限下载承诺。');
 let deliveryIndexPromise=null;const shardCache=new Map();
 async function decorateDownloads(item,container){
  container.dataset.deliveryItem=item.id;
  try{
   if(!deliveryIndexPromise)deliveryIndexPromise=fetch('/delivery-index.json',{credentials:'same-origin'}).then(r=>r.json());
   const index=await deliveryIndexPromise,pointer=index.assets[item.id];if(!pointer)return;
   if(!shardCache.has(pointer))shardCache.set(pointer,fetchDeliveryShard(pointer));
   const asset=(await shardCache.get(pointer))[item.id];if(container.dataset.deliveryItem!==item.id)return;
   const box=document.createElement('div');box.className='partner-downloads';
   const note=document.createElement('p');note.textContent=asset?.driveSources?.length?'对应 Drive 档案：使用你自己的既有权限下载。':'当前未核实这项资产的精确 Drive 包内对应关系；可先导出 manifest，保留来源 ID 与本站文件哈希。';box.append(note);
   for(const source of asset?.driveSources||[])appendDriveSource(box,source);
   container.querySelector('.partner-downloads')?.remove();container.append(box);
  }catch{/* Existing original download links stay intact. */}
 }
 return {changed,decorateDownloads};
}

/** Download presentation only; identity, local drafts and server writes are unchanged. */
export function appendDriveSource(container,source){
 const split=source.kind==='split-static-derived-texture-evidence';
 const link=(name,url)=>{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=name;container.append(a);};
 link(source.name+(split?' · 静态纹理证据，非Unity包':source.membership==='exact-member-byte-hash-verified'?' · 包内文件哈希已匹配':' · 来源ID已匹配，Unity仍为候选'),source.url);
 if(split){
  const p=document.createElement('p');p.textContent='需下载全部4分卷，核对每卷及合并后的SHA256后按编号合并；须使用你自己的既有Drive权限。来源ID、索引路径及站内像素与包清单/ZIP目录已对应，未逐项回读原包像素，也未验证Unity导入。';container.append(p);
  for(const part of source.archiveParts||[])link(`分卷 ${part.number}/4 · ${part.name}（${part.bytes} bytes）`,part.url);
 }
}
