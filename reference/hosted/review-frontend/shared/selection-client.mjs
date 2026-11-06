import {resolveSelectionAssets,fetchDeliveryShard} from './selection-manifest.mjs';
import {browserStorage} from './selection-state.mjs';
/** One shared UI module for both asset review sites; local drafts are never called shared. */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const normalizeNickname = value => String(value ?? '').trim();
const draftWriterId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let draftWriteSequence = 0;
const nextDraftWriteId = () => `${draftWriterId}-${++draftWriteSequence}`;
export async function mountPartnerSelections({enabled=true,siteId,legacyKey,items,getSelected,replaceSelected,openItem,getProfile,localSelectionStorageKey,exportLocalDraft}) {
 if(!enabled)return {changed(){},decorateDownloads(){}};
 const root=document.createElement('section');root.className='partner-selections';root.setAttribute('aria-label','身份与伙伴选择');
 root.innerHTML='<div class="partner-heading"><div><strong>我的身份与选择</strong><p id="partner-identity">正在核验站内登录身份…</p></div><button id="partner-refresh" class="light-btn">刷新共享清单</button></div><div id="partner-controls" hidden><label>展示昵称 <input id="partner-nickname" maxlength="32" placeholder="例如：肥猫"></label><button id="partner-publish" class="primary-btn">发布我的选择</button><button id="partner-load" class="light-btn">载入服务器版本</button><button id="partner-export" class="light-btn">导出我的 manifest</button><button id="partner-legacy" class="light-btn" hidden>导入此浏览器旧选择</button></div><p id="partner-status" role="status">勾选先存本浏览器。只有点击“发布我的选择”后，现有伙伴才可看到。</p><details class="partner-shared"><summary>伙伴的共享选择 <span id="partner-total"></span></summary><div id="partner-lists"></div></details><details class="partner-help"><summary>交给本地 dot / agent 与 Unity 导入边界</summary><p>导出 manifest 后交给你的本地 agent，并使用你自己的站点或 Drive 登录下载。清单不含凭据。GLB 是浏览器预览，不能保证拖入 Unity 即可用；仅明确标为已验证的 Unity 包可按其 README 导入。</p><p>网页渲染为近似，原 Shader 与引擎/管线版本须按交付包说明核验。审阅备注仍只保存在本浏览器，不会随选择发布。</p><p><a href="/AGENT-DOWNLOAD.md" target="_blank" rel="noopener">本地 agent 下载与 Unity 安全导入说明</a></p><div id="partner-delivery">交付状态载入中…</div></details>';
 document.querySelector('main > header').after(root);
 const $=id=>root.querySelector('#'+id),map=new Map(items.map(i=>[i.id,i]));
 let identity=null,mine=null,key=null,dirty=false,busy=false,knownServerRevision=0,refreshGeneration=0;
 const status=(s)=>$('partner-status').textContent=s;
 if (exportLocalDraft) {
  const recovery = document.createElement('button');
  recovery.id = 'partner-recovery-export';
  recovery.className = 'light-btn';
  recovery.textContent = '导出当前选择与审阅备份';
  recovery.onclick = exportLocalDraft;
  root.append(recovery);
 }
 const storageWarning=document.createElement('p');
 storageWarning.id='partner-storage-warning';
 storageWarning.hidden=true;
 storageWarning.setAttribute('role','status');
 storageWarning.textContent='浏览器无法读取或保存账号草稿。未发布的选择请及时导出备份。';
 $('partner-status').after(storageWarning);
 $('partner-refresh').disabled=true;
 status('正在读取账号草稿…');
 const valid=ids=>Array.isArray(ids)?[...new Set(ids)].filter(id=>map.has(id)):[];
 const readDraft=key=>{
  try{return JSON.parse(browserStorage.getItem(key)||'null')}
  catch{storageWarning.hidden=false;return null}
 };
 const draftRevision = draft => Number.isSafeInteger(draft?.baseRevision) && draft.baseRevision >= 0 ? draft.baseRevision : 0;
 const draftLineage = draft => draft?.lineage ?? `revision:${draftRevision(draft)}`;
 let lineage;
 const readAccountDraft = (bytes = browserStorage.getItem(key)) => {
  const latest = JSON.parse(bytes || 'null');
  if (latest !== null && (!latest || typeof latest !== 'object' || Array.isArray(latest) || !Array.isArray(latest.ids))) throw Error('Invalid account draft');
  if (latest && (latest.ids.some(id => typeof id !== 'string' || !id.trim()) ||
    (latest.nickname !== undefined && typeof latest.nickname !== 'string') ||
    (latest.baseRevision !== undefined && (!Number.isSafeInteger(latest.baseRevision) || latest.baseRevision < 0)) ||
    (latest.lineage !== undefined && typeof latest.lineage !== 'string'))) throw Error('Invalid account draft fields');
  return latest;
 };
 let pendingSelection = [], pendingNickname, pendingAcknowledgement, pendingReplacement;
 const snapshotSelection = () => {
  if (pendingReplacement && pendingReplacement.originalBytes === undefined) return {selected: [...getSelected()], ok: false};
  try {
   const bytes = browserStorage.getItem(key);
   const latest = pendingReplacement?.originalBytes === bytes ? pendingReplacement.draft : readAccountDraft(bytes);
   const ids = new Set(latest ? latest.ids : getSelected());
   for (const change of pendingSelection) {
    if (change.clear) ids.clear();
    for (const id of valid(change.add)) ids.add(id);
    for (const id of valid(change.remove)) ids.delete(id);
   }
   return {selected: [...ids], ok: true};
  } catch {
   return {selected: [...getSelected()], ok: false};
  }
 };
 const saveDraft=originalBytes=>{
  if(!identity)return false;
  const replacement = {ids:[...getSelected()],nickname:$('partner-nickname').value,baseRevision:knownServerRevision,lineage};
  pendingSelection = [];
  pendingNickname = undefined;
  pendingAcknowledgement = undefined;
  try{
   browserStorage.setItem(key,JSON.stringify({...replacement,writeId:nextDraftWriteId(),updatedAt:new Date().toISOString()}));
   pendingReplacement = undefined;
   storageWarning.hidden=true;
   return true;
  }catch{
   pendingReplacement = {originalBytes, draft: replacement};
   storageWarning.hidden=false;
   return false;
  }
 };
 // Ordinary edits rebase only their explicit intent; explicit server loads retain
 // the intentional whole-draft save above. Failed intents remain exportable in memory.
 const saveSelection = (intent, acknowledgedNickname) => {
  if (intent) pendingSelection.push(intent);
  if (!identity) return false;
  try {
   const originalBytes = browserStorage.getItem(key);
   // A failed destructive load is only retryable against the exact draft that
   // was confirmed. Even a same-revision edit invalidates that permission.
   const latest = pendingReplacement?.originalBytes === originalBytes ? pendingReplacement.draft : readAccountDraft(originalBytes);
   const ids = new Set(latest ? latest.ids : getSelected());
   for (const change of pendingSelection) {
    if (change.clear) ids.clear();
    for (const id of valid(change.add)) ids.add(id);
    for (const id of valid(change.remove)) ids.delete(id);
   }
   let nickname = pendingNickname ?? latest?.nickname ?? $('partner-nickname').value;
   if (acknowledgedNickname !== undefined && normalizeNickname(nickname) === acknowledgedNickname) nickname = acknowledgedNickname;
   let baseRevision = latest ? draftRevision(latest) : knownServerRevision;
   const nextLineage = latest ? draftLineage(latest) : lineage;
   if (pendingAcknowledgement?.fromRevision === baseRevision && pendingAcknowledgement.lineage === nextLineage) {
    baseRevision = pendingAcknowledgement.toRevision;
   }
   browserStorage.setItem(key, JSON.stringify({ids: [...ids], nickname, baseRevision, lineage: nextLineage, writeId: nextDraftWriteId(), updatedAt: new Date().toISOString()}));
   pendingSelection = [];
   pendingNickname = undefined;
   pendingAcknowledgement = undefined;
   pendingReplacement = undefined;
   const selectionChanged = !same(getSelected(), ids);
   dirty ||= selectionChanged || normalizeNickname($('partner-nickname').value) !== normalizeNickname(nickname);
   knownServerRevision = baseRevision;
   lineage = nextLineage;
   $('partner-nickname').value = nickname;
   if (selectionChanged) replaceSelected([...ids]);
   storageWarning.hidden = true;
   return true;
  } catch {
   storageWarning.hidden = false;
   return false;
  }
 };
 const api=async(path,options={})=>{const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});let body;try{body=await r.json()}catch{throw Error('登录或网络不可用，请重新登录后刷新。')}if(!r.ok)throw Object.assign(Error(body.error||String(r.status)),{status:r.status});return body};
 const readSession = async () => {
  const controller = new AbortController();
  const sessionTimeoutMs = 10000;
  let timer;
  try {
   return await Promise.race([
    api('/api/selection/session', {signal: controller.signal}),
    new Promise((_, reject) => {timer = setTimeout(() => {
     controller.abort();
     reject(Error('身份核验超时'));
    }, sessionTimeoutMs);})
   ]);
  } finally { clearTimeout(timer); }
 };
 const safeRun=fn=>async()=>{if(busy)return;busy=true;try{await fn()}catch(e){status(e.status===409?'服务器版本已变化。草稿未丢失，请先刷新并载入服务器版本，再合并所需选择。':`操作未完成：${e.message}。本地草稿未自动分享。`)}finally{busy=false}};
 const download=(name,value)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 const exportSelection=async(selection,filename,warnings=[])=>{
  const data=await fetch('/delivery-index.json',{credentials:'same-origin'}).then(r=>{if(!r.ok)throw Error('交付索引读取失败');return r.json()});
  if(!Array.isArray(selection.ids))throw Error('清单缺少所选资源 ID');
  const ids=[...new Set(selection.ids.filter(id=>typeof id==='string'&&id.trim()))];
  const resolved=await resolveSelectionAssets(data,ids,fetchDeliveryShard);
  download(filename,{schema:'asset-review-selection-manifest/1',siteId,siteUrl:location.origin,generatedAt:new Date().toISOString(),selection:{...selection,ids},assets:resolved.map(a=>({...a,selected:ids.includes(a.id),files:a.files.map(f=>({...f,url:new URL(f.path,location.origin).href}))})),rendererProfile:getProfile(),rendererProfiles:data.rendererProfiles,delivery:data.delivery,access:{authenticationRequired:true,instruction:'Use your own authorized login; this manifest carries no credentials. Drive access is governed by your own existing permission, not link visibility.'},warnings:[...warnings,'GLB browser previews are not import-ready Unity packages.','Dependency references are not proof of full Unity dependency closure.','Browser shader modes are approximations, not original game shaders.']});
 };
 const renderLists=lists=>{$('partner-total').textContent=`(${lists.length})`;$('partner-lists').replaceChildren();for(const list of lists){const box=document.createElement('article');box.className='partner-list';box.innerHTML=`<div><strong>${esc(list.nickname)}的选择${list.userId===identity.userId?'（我）':''}</strong> · ${list.ids.length} 项</div><small>站内 ID：${esc(list.userId)} · 版本 ${list.revision} · ${esc(list.updatedAt)}</small><div class="partner-list-actions"><button class="light-btn" data-manifest>导出此清单 manifest</button><button class="light-btn" data-copy>将这些项加入我的草稿</button></div><details><summary>查看资产</summary><div class="partner-items"></div></details>`;box.querySelector('[data-manifest]').onclick=safeRun(async()=>{const plan=await api('/api/selections/manifest?user='+encodeURIComponent(list.userId));await exportSelection({...plan.selection,scope:'server-shared-selection'},`selection-${siteId}-${plan.selection.revision}.json`);status('已导出服务器共享清单的完整资源 manifest，不含登录凭据。')});box.querySelector('[data-copy]').onclick=()=>{replaceSelected([...new Set([...getSelected(),...valid(list.ids)])]);changed({add: valid(list.ids)});status('已加入你的本地草稿。未修改对方清单，也未自动发布。')};const entries=box.querySelector('.partner-items');for(const id of list.ids){const item=map.get(id),button=document.createElement('button');button.className='text-btn';button.textContent=item?.name||id;button.disabled=!item;button.onclick=()=>openItem(item);entries.append(button)}$('partner-lists').append(box)}if(!lists.length)$('partner-lists').textContent='还没有人发布选择。'};
 const refresh=async()=>{
  const generation=++refreshGeneration;
  try{
   const data=await api('/api/selections');
   if(generation!==refreshGeneration)return;
   renderLists(data.lists);
   mine=data.lists.find(list=>list.userId===identity.userId)||null;
   return data;
  }catch(error){
   if(generation===refreshGeneration)throw error;
  }
 };
 const refreshInBackground=()=>refresh().catch(error=>{
  $('partner-lists').textContent=`共享清单读取失败：${error.message}。请刷新共享清单。`;
 });
 const hasNewServerRevision=()=>mine&&mine.revision!==knownServerRevision;
 const newServerRevisionMessage='服务器清单已更新。本地草稿保留；点击“载入服务器版本”会替换当前草稿。';
 const changed=intent=>{
  if(!identity)return false;
  dirty=true;
  const isSaved=saveSelection(intent);
  status(`本浏览器草稿 ${getSelected().size} 项，尚未发布给伙伴。`);
  return isSaved;
 };
 $('partner-refresh').onclick=safeRun(async()=>{
  if(!identity||!await refresh())return;
  status(hasNewServerRevision()?newServerRevisionMessage:'共享清单已刷新。本地勾选仍是你的草稿。');
 });
 $('partner-nickname').oninput=()=>{pendingNickname=$('partner-nickname').value;changed();};
 $('partner-publish').onclick=safeRun(async()=>{
  const nicknameInput=$('partner-nickname'),draftNickname=nicknameInput.value;
  const snapshot={nickname:normalizeNickname(draftNickname),ids:[...getSelected()],revision:knownServerRevision};
  const submittedLineage = lineage;
  if(!snapshot.nickname)throw Error('请先设置昵称');
  const result=await api('/api/selections/me',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
  mine=result.mine;
  const fromRevision = pendingAcknowledgement?.lineage === submittedLineage && pendingAcknowledgement.toRevision === snapshot.revision
   ? pendingAcknowledgement.fromRevision : snapshot.revision;
  pendingAcknowledgement = {fromRevision, toRevision: mine.revision, lineage: submittedLineage};
  // Advance only descendants of the submitted draft, never an unrelated Load
  // or older stored snapshot. Ordinary edits retain their lineage across tabs.
  const isDraftSaved = saveSelection(undefined, snapshot.nickname);
  if (!isDraftSaved && lineage === submittedLineage && knownServerRevision === snapshot.revision) knownServerRevision = mine.revision;
  dirty = !isDraftSaved || knownServerRevision !== mine.revision || !same(getSelected(), snapshot.ids) || normalizeNickname(nicknameInput.value) !== normalizeNickname(draftNickname);
  status(!isDraftSaved
   ? `已发布提交时的 ${mine.ids.length} 项，但浏览器草稿未能同步确认；请保留当前页面并导出备份。`
   : knownServerRevision !== mine.revision ? '已发布提交时的选择。当前草稿基于其他服务器版本，未自动更新基线；请载入服务器版本后再合并。'
   : dirty ? `已发布提交时的 ${mine.ids.length} 项。其他草稿改动仍未发布。`
   : `已发布 ${mine.ids.length} 项，现有站点伙伴可查看。昵称不改变真实站内 ID。`);
  refreshInBackground();
 });
 $('partner-load').onclick=safeRun(async()=>{
  await refresh();
  const serverIds = mine?.ids || [], serverNickname = mine?.nickname || '';
  let needsConfirmation = dirty, unreadable = false, originalBytes;
  try {
   originalBytes = browserStorage.getItem(key);
   const latest = readAccountDraft(originalBytes);
   needsConfirmation ||= latest !== null && (!same(latest.ids, serverIds) || normalizeNickname(latest.nickname) !== normalizeNickname(serverNickname));
  } catch {
   unreadable = true;
   needsConfirmation = true;
   storageWarning.hidden = false;
  }
  const message = unreadable
   ? '无法读取当前浏览器草稿。这会用服务器版本替换它，原内容可能无法恢复。继续吗？'
   : '这会用服务器版本替换当前浏览器草稿。继续吗？';
  if (needsConfirmation && !confirm(message)) return;
  replaceSelected(serverIds);
  $('partner-nickname').value = serverNickname;
  knownServerRevision = mine?.revision || 0;
  lineage = nextDraftWriteId();
  dirty = false;
  const isSaved = saveDraft(originalBytes);
  status(isSaved ? '已载入本人服务器版本。其他人的清单未改变。' : '已在当前页面载入服务器版本，但浏览器草稿未能保存；请导出备份。');
 });
 $('partner-export').onclick=safeRun(async()=>{
  const selection = {userId:identity.userId,nickname:$('partner-nickname').value,ids:[...getSelected()],scope:'local-draft-not-shared',baseRevision:knownServerRevision};
  try {
   await exportSelection(selection,`selection-${siteId}-local-draft.json`,['Local draft is not visible to partners until published.']);
   status('已导出本地草稿 manifest；不会因此发布给伙伴。');
  } catch (error) {
   const exported = exportLocalDraft?.();
   status(exported
    ? `交付 manifest 未完成：${error.message}。已另存选择与审阅备份，不恢复账号或昵称；暂不可用的 ID 须待目录恢复后再导入，不会自动发布。`
    : `交付 manifest 未完成：${error.message}。未导出可恢复备份，请保留当前页面，不要刷新或关闭。`);
  }
 });
 try{
  const session=await readSession();
  identity=session;
  mine=session.mine;
  knownServerRevision=mine?.revision||0;
  key=`asset-review-selection-v1:${siteId}:${identity.userId}`;
  let saved;
  try {saved=readAccountDraft();} catch {storageWarning.hidden=false;}
  const serverNickname=mine?.nickname||'';
  replaceSelected(saved?.ids || mine?.ids || []);
  const draftNickname=saved?.nickname??serverNickname;
  if(saved){
   knownServerRevision=draftRevision(saved);
   dirty=!same(getSelected(),mine?.ids||[])||normalizeNickname(draftNickname)!==normalizeNickname(serverNickname);
  }
  lineage = saved ? draftLineage(saved) : `revision:${knownServerRevision}`;
  $('partner-nickname').value=draftNickname;
  const legacy=valid(readDraft(legacyKey)?.selected);
  if(legacy.length){
   $('partner-legacy').hidden=false;
   $('partner-legacy').onclick=()=>{
    replaceSelected([...new Set([...getSelected(),...legacy])]);
    changed({add: legacy});
    $('partner-legacy').hidden=true;
    status('旧选择已加入当前身份的草稿，未自动发布。');
   };
  }
  $('partner-identity').textContent=`${session.email||'已登录'} · 站内 ID：${identity.userId}`;
  $('partner-controls').hidden=false;
  $('partner-refresh').disabled=false;
  status(dirty?'已恢复本浏览器草稿，尚未发布。':'点击发布后，站点伙伴才可查看你的选择。');
  if(hasNewServerRevision())status(newServerRevisionMessage);
  refreshInBackground();
 }catch(e){
  $('partner-identity').textContent='无法核验当前身份。当前选择未关联账号。';
  status(localSelectionStorageKey
   ? '共享选择暂不可用。选择仍按本浏览器本地存储状态保存，不会自动归给账号；重新登录前可先导出备份。'
   : '当前选择仅保留在此页面，关闭或刷新会丢失。请先导出当前选择与审阅备份，再重新登录；不会自动归给账号。');
 }
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
 return {changed,decorateDownloads,saveDraft,saveSelection,snapshotSelection,authenticated:!!identity};
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
