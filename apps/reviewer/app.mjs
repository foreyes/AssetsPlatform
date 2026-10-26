import { semanticViewScope } from './shared/semantic-workbench.mjs';
import { mountSemanticUI } from './shared/semantic-ui.mjs';
import { catalogueSummary, clearCondition } from './shared/catalogue-summary.mjs';
import { imageObjectPreviewLabel } from './shared/preview-status.mjs';
import { createJSONBudget, readBoundedJSON } from './shared/json-budget.mjs';
import { importReviewBackup, canRestoreReviewSnapshot, restoreReviewSnapshot } from './shared/review-import.mjs';
import { commonIndexedProfiles } from './shared/common-render-profiles.mjs';
import { exportAssetIndex, reviewBackupIdentity } from './shared/review-export.mjs';
import { describePreviewFailure, showPreviewFailure } from './shared/preview-failure-5e4d0bcf88f3.mjs';
import { guardStartup } from './shared/startup-state.mjs';
import { mountPartnerSelections } from './shared/selection-client.mjs';
let partnerSelections = null,
  legacySelected = [];
import { createViewer, createThumbnailRenderer, configureRenderer, renderIdentity, downloadResource } from './shared/viewer-adapter.mjs';
import { createPreviewQueue } from './shared/preview-queue.mjs';
import { createWorkbench, createWorkbenchState } from './shared/workbench.mjs';
import { loadProject, loadProjectData, objectCategory, assetURL } from './shared/project-loader.mjs';
import { loadReviewState, saveReviewState } from './shared/selection-state.mjs';
import { configureShell as mountShell, renderEvidenceSections } from './shared/shell-controller.mjs';
import { getResourceResolver, createProjectScope } from './shared/resource-url.mjs';
const project = await guardStartup(() => loadProject());
const {
  config,
  typeLabels,
  categoryLabels,
  objectNames
} = project;
// Project descriptors select data, not executable project-specific integrations.
const resourceResolver = getResourceResolver(config),
  resourceScope = createProjectScope(resourceResolver),
  jsonBudget = createJSONBudget(config);
let defaultProfiles = project.defaultProfiles;
await guardStartup(() => configureRenderer(config));
import { createPlaybackTimeline } from './shared/playback-timeline.mjs';
import { verifiedAnimationRecord, resolveAnimation, verifiedViewerClips } from './shared/animation-contract.mjs';
const {
  REVIEW_STATUSES,
  sanitizeReviews,
  parseReviewImport,
  countByType,
  availableProfile,
  readDefaultProfile,
  writeDefaultProfile,
  PAGE_SIZE,
  pageSlice,
  paginationTokens
} = createWorkbench(config);
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[char]);
const fmt = value => value === undefined || value === null ? '未提取' : Number(value).toLocaleString('zh-CN');
const KEY = config.reviewKey;
const icons = {
  mesh: '◇',
  texture: '▧',
  material: '◒',
  animation: '▷',
  shader: '⌁',
  audio: '♫',
  object: '◈'
};
let catalog,
  objectCatalog,
  profileSources = [],
  resources = [],
  objects = [],
  profiles = [...defaultProfiles],
  items = [],
  itemMap = new Map(),
  resourceMap = new Map(),
  sourceMap = new Map();
let state = {
  ...createWorkbenchState(),
  animation: 'all',
  semantic: {},
  facets: {
    ...(config.defaultFacets || {})
  },
  layout: 'grid'
};
let semanticUI = null;
let projectData,
  currentVariant = null,
  hierarchyRequest = 0,
  resourceRequest = 0,
  hierarchyAbort = null,
  resourceAbort = null;
let reviews = Object.create(null),
  selected = new Set(),
  storageOK = true,
  current = null,
  filtered = [],
  comparison = false,
  viewerA = null,
  viewerB = null,
  viewerRequest = 0,
  viewerLoading = false,
  viewerAbort = null,
  syncing = false,
  profileA = config.defaultProfile,
  profileB = 'toon',
  defaultProfile = config.defaultProfile,
  commentTimer,
  toastTimer;
function selectedAnimationRecord(item) {
  return resolveAnimation({enabled:config.verifiedAnimation,item,base:animationRecords.get(item.id),references:relatedResources(item,'animation')}).record;
}
let thumbnailObserver,
  thumbnailEpoch = 0,
  previewQueue,
  animationRecords = new Map(),
  animationClips = [],
  animationPauseEpoch = 0;
const playback = createPlaybackTimeline({
  onFrame: applyAnimationFrame,
  onState: updateAnimationControls
});
const thumbnailKey = (item, profileId = defaultProfile) => renderIdentity(item, viewerProfile(profileById(profileId)));
function showToast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').hidden = true, 4200);
}
function reviewOf(item) {
  return reviews[item.id] || {
    status: 'pending',
    comment: ''
  };
}
function persist() {
  storageOK = saveReviewState(localStorage, config, {
    reviews,
    selected,
    legacySelected
  });
  $('#storage-warning').hidden = storageOK;
  partnerSelections?.changed();
  return storageOK;
}
function loadState() {
  const saved = loadReviewState(localStorage, config);
  reviews = saved.reviews;
  selected = new Set(saved.selected);
  legacySelected = saved.legacySelected;
  storageOK = saved.ok;
}
function categoryLabel(id) {
  return categoryLabels[id] || objectCatalog?.categories?.find(c => c.id === id)?.label || catalog?.categories?.find(c => c.id === id)?.label || id || '其他';
}
function normalizeResource(record) {
  return {
    ...record,
    id: String(record.id),
    name: record.name || '未命名资产',
    type: record.type || 'other',
    isObject: false,
    originalUrl: record.imageUrl || record.originalUrl,
    notes: Array.isArray(record.notes) ? record.notes : [record.notes].filter(Boolean)
  };
}
function normalizeObject(record) {
  const base = resources.find(a => record.assetId && a.id === record.assetId || record.sourceId && a.sourceId === record.sourceId) || {};
  const merged = {
    ...base,
    ...record
  };
  const rawName = record.name || base.name || record.id;
  return {
    ...merged,
    id: String(record.id),
    name: record.displayName || objectNames[rawName] || rawName,
    originalName: record.originalName || rawName,
    originalUrl: record.imageUrl || record.originalUrl,
    type: 'object',
    isObject: true,
    category: objectCategory(merged),
    modelUrl: record.modelUrl || base.modelUrl,
    previewUrl: record.previewUrl || record.thumbnailUrl || base.previewUrl,
    notes: Array.isArray(record.notes) ? record.notes : Array.isArray(base.notes) ? base.notes : [],
    provenance: record.provenance || base.provenance || {},
    assemblyStatus: record.assemblyStatus || '目录声明 · 未验证'
  };
}
function allRelatedIds(object) {
  if (Array.isArray(object.assetIds)) {
    const ids = new Set(object.assetIds.filter(id => resourceMap.has(id)));
    return [...ids];
  }
  const ids = new Set();
  const accept = value => {
    if (!value) return;
    if (typeof value === 'string') {
      if (resourceMap.has(value)) ids.add(value);else if (sourceMap.has(value)) ids.add(sourceMap.get(value).id);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(accept);
      return;
    }
    if (typeof value === 'object') {
      accept(value.id);
      accept(value.assetId);
      accept(value.sourceId);
      accept(value.meshId);
      accept(value.materialId);
      accept(value.textureId);
      accept(value.animationId);
      accept(value.materials);
      accept(value.textures);
      accept(value.textureLinks);
    }
  };
  ['assetIds', 'resourceIds', 'meshIds', 'materialIds', 'textureIds', 'animationIds', 'assetId', 'meshLinks', 'materialLinks', 'textureLinks', 'animationLinks', 'components', 'links', 'relations'].forEach(k => accept(object[k]));
  if (object.sourceId && sourceMap.has(object.sourceId)) ids.add(sourceMap.get(object.sourceId).id);
  for (const id of [...ids]) {
    const resource = resourceMap.get(id);
    if (resource?.type === 'material') accept(resource.textureLinks);
  }
  for (const id of [...ids]) {
    const resource = resourceMap.get(id);
    if (resource?.type === 'material') accept(resource.textureLinks);
  }
  return [...ids];
}
function relatedResources(object, type) {
  return (object.relatedIds || []).map(id => resourceMap.get(id)).filter(a => a && (!type || a.type === type));
}
function relatedCount(object, type) {
  return relatedResources(object,type).length;
}
function searchText(item) {
  return [item.source, item.sourceLabel, item.nativeType, item.typeLabel, item.description, item.nativeProvenance, item.provenance?.sourceBundle, item.provenance?.serializedFile, ...(item.usagePaths || []), item.id, item.name, item.originalName, item.sourceId, item.category, item.provenance?.sourceFile, item.provenance?.pathId, ...(item.tags || []), ...(item.relatedIds || []).map(id => resourceMap.get(id)?.name), ...(canPlayAnimation(item) ? ['已验证动画'] : [])].filter(v => v !== undefined && v !== null).join(' ').toLowerCase();
}
function normalizeProfiles(data) {
  const list=Array.isArray(data)?data:data?.profiles||[];
  return list.map(record=>({
    ...record,
    label:record.label||record.name||record.id,
    mode:record.mode||'material',
    parameters:record.parameters||{},
    implemented:record.implemented===true&&['material','clay','toon'].includes(record.mode||'material'),
    description:record.description||'用户声明的预览参数；不是外观验证结论。',
    unsupportedFeatures:record.unsupportedFeatures||[]
  }));
}
async function readJSON(url, required = true, options = {}) {
  return resourceScope.run(async signal => {
    const resolved = new URL(resourceResolver.resolve(url)),
      key = resolved.hash ? resolved.hash.slice(1) : null;
    resolved.hash = '';
    const path = resolved.href;
    const response = await fetch(path, {
      ...options,
      signal,
      redirect: 'error'
    });
    if (!response.ok) {
      if (!required) return null;
      throw Error(`${path} 读取失败 (${response.status})`);
    }
    const data = await readBoundedJSON(response, {
      budget: jsonBudget,
      context: path,
      gzip: path.endsWith('.gz')
    });
    if (options.signal?.aborted) throw new DOMException('动作读取已取消', 'AbortError');
    if (!key) return data;
    const record = data.records?.[decodeURIComponent(key)];
    if (!record && required) throw Error('索引分片缺少对应源记录');
    return record || null;
  }, {
    signal: options.signal
  });
}
async function init() {
  loadState();
  try {
    projectData = await loadProjectData(project, readJSON);
    catalog = projectData.catalog;
    objectCatalog = projectData.objectCatalog;
    if (projectData.profiles) defaultProfiles = projectData.profiles;
    if (projectData.defaultFilters && !config.defaultFacets) state.facets = {
      ...projectData.defaultFilters
    };
    resources = (catalog.assets || []).map(normalizeResource);
    resourceMap = new Map(resources.map(a => [a.id, a]));
    sourceMap = new Map(resources.filter(a => a.sourceId).map(a => [a.sourceId, a]));
    objects = (objectCatalog.objects || objectCatalog.assets || []).map((record, index) => ({
      ...normalizeObject(record),
      catalogOrder: index
    }));
    if (!objects.length) throw Error('物件目录暂不可用');
    for (const object of objects) object.relatedIds = allRelatedIds(object);
    const animationIndex=projectData.animationIndex;
    animationRecords=new Map((animationIndex?.objects||[]).filter(record=>objects.some(object=>object.id===record.objectId&&object.sourceId===record.sourceId)).map(record=>[record.objectId,record]));
    const evidence = projectData.evidence;
    profileSources = evidence?.sources || [];
    profiles = commonIndexedProfiles([...defaultProfiles, ...normalizeProfiles(evidence)]);
    defaultProfile = readDefaultProfile(localStorage, profiles);
    profileA = defaultProfile;
    profileB = profiles.find(p=>p.id===config.compareProfile&&availableProfile(p))?.id || profiles.find(p => p.id !== profileA && availableProfile(p))?.id || profileA;
    items = [...objects, ...resources];
    itemMap = new Map(items.map(a => [a.id, a]));
    for (const item of items) item.searchText = searchText(item);
    if (projectData.datasets) {
      for (const dataset of Object.values(projectData.datasets)) for (const raw of dataset.resources || []) {
        if (!itemMap.has(raw.id)) {
          const item = normalizeResource(raw);
          item.searchText = searchText(item);
          itemMap.set(item.id, item);
          items.push(item);
        }
      }
    }
    const known = new Set(itemMap.keys());
    reviews = sanitizeReviews(reviews, known);
    selected = new Set([...selected].filter(id => known.has(id)));
    configureSemanticUI();
    configureShell();
    buildProfiles();
    buildAudit();
    renderNavigation();
    render();
    partnerSelections = await mountPartnerSelections({
      enabled: config.sharedSelections,
      siteId: config.siteId,
      legacyKey: KEY,
      items,
      getSelected: () => selected,
      replaceSelected: ids => {
        selected = new Set(ids);
        renderNavigation();
        render();
      },
      openItem: item => item.isObject ? openDetail(item) : openResource(item),
      getProfile: () => profileById(defaultProfile)
    });
  } catch (error) {
    $('#load-error').hidden = false;
    $('#load-error').textContent = `${error.message}。请刷新重试；已保留当前审阅记录。`;
    $('#result-description').textContent = '物件目录尚未成功载入';
    console.error(error);
  }
  $('#storage-warning').hidden = storageOK;
}
function isObjectView() {
  return state.view === 'objects';
}
function activeCollection() {
  return state.view === 'objects' ? objects : state.view === 'technical' ? activeResources() : state.view === 'selected' ? items.filter(a => selected.has(a.id)) : items.filter(a => reviewOf(a).status !== 'pending');
}
function renderNavigation() {
  if (projectData?.filterOptions) renderDynamicFacets();
  const objectMode = isObjectView(),
    collection = activeCollection();
  $('#side-category-label').textContent = objectMode ? '物件类别' : '技术资源类别';
  const groups = objectMode ? [...new Set(objects.map(a => a.category))] : Object.keys(typeLabels).filter(type => resources.some(a => a.type === type));
  $('#side-categories').innerHTML = groups.map(group => `<button class="nav" data-${objectMode ? 'category' : 'type'}="${esc(group)}"><span>${objectMode ? '◇' : icons[group] || '◈'}</span>${esc(objectMode ? categoryLabel(group) : typeLabels[group] || group)}<b>${(objectMode ? objects : resources).filter(a => (objectMode ? a.category : a.type) === group).length}</b></button>`).join('');
  $('#tabs').innerHTML = `<button class="tab active" data-${objectMode ? 'category' : 'type'}="all" role="tab" aria-selected="true">${objectMode ? '全部物件' : '全部资源'} <span>${collection.length}</span></button>` + groups.map(group => `<button class="tab" data-${objectMode ? 'category' : 'type'}="${esc(group)}" role="tab">${esc(objectMode ? categoryLabel(group) : typeLabels[group] || group)} <span>${(objectMode ? objects : resources).filter(a => (objectMode ? a.category : a.type) === group).length}</span></button>`).join('');
  $('#category-filter').innerHTML = '<option value="all">全部目录类别</option>' + [...new Set(collection.map(a => a.category))].map(category => `<option value="${esc(category)}">${esc(categoryLabel(category))}</option>`).join('');
  $('#category-filter').value = state.category;
  $('#category-filter').hidden = objectMode;
  $$('[data-type]').forEach(button => button.onclick = () => {
    state.type = button.dataset.type;
    state.page = 1;
    render();
  });
  $$('[data-category]').forEach(button => button.onclick = () => {
    state.category = button.dataset.category;
    state.page = 1;
    render();
  });
}
function renderStats() {
  const resourceCount = activeResources().length;
  $('#object-count').textContent = objects.length;
  $('#all-count').textContent = resourceCount;
  $('#stat-total').textContent = objects.filter(a => a.modelUrl || a.modelAsset).length;
  $('#stat-mesh').textContent = objects.length;
  $('#stat-preview').textContent = resourceCount;
  const reviewed = items.filter(a => reviewOf(a).status !== 'pending').length;
  $('#stat-reviewed').textContent = reviewed;
  $('#stat-progress').textContent = ' / ' + items.length;
  $('#stat-reviewed-caption').textContent = '当前浏览器的审阅记录';
  $('#selected-count').textContent = selected.size;
  $('#reviewed-count').textContent = reviewed;
  $('#selection-bar').hidden = !selected.size;
  $('#selection-number').textContent = selected.size;
  $('#compare-btn').disabled = selected.size < 2 || selected.size > 4;
}
function canPlayAnimation(item) {
  const record = animationRecords.get(item.id);
  return item.isObject && record?.status === 'ready' && record.skinBindingVerified === true && record.sourceCurvesVerified === true && record.pixelVerified === true && typeof record.dataUrl === 'string' && typeof record.modelUrl === 'string' && Array.isArray(record.playableClipIds) && record.playableClipIds.length > 0 && Array.isArray(record.verifiedPlayableClipIds) && record.playableClipIds.every(id => record.verifiedPlayableClipIds.includes(id));
}
function hasAnimationReferences(item) {
  return item.isObject ? relatedResources(item, 'animation').length > 0 || (item.animationLinks || []).length > 0 : item.type === 'animation' && !!item.sourceId;
}
function animationFilterMatches(item) {
  return state.animation==='all'||state.animation==='references'&&hasAnimationReferences(item)||state.animation==='playable'&&canPlayAnimation(item);
}
function renderAnimationFilterCounts() {
  const scope=filterItems(true),references=scope.filter(hasAnimationReferences).length,playable=scope.filter(canPlayAnimation).length;
  $('#animation-filter').innerHTML=`<option value="all">全部动画状态</option><option value="references">含动画引用（${references}）</option><option value="playable">已验证片段（${playable}）</option>`;
  $('#animation-filter').value=state.animation;
  $('#animation-filter-hint').textContent=`${references} 项含动画引用 · ${playable} 个物件有已验证片段。引用、解析和验证互不等同。`;
}
function hasPreview(item) {
  return !!(item.previewUrl || item.modelUrl || item.modelAsset || item.imageUrl || item.originalUrl);
}
function facetMatches(item) {
  return Object.entries(state.facets).every(([key, value]) => value === 'all' || value === false || value === '' || (Array.isArray(item.facets?.[key]) ? item.facets[key].includes(value) : item.facets?.[key] === value));
}
function filterItems(ignoreAnimation = false) {
  const query = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  let result = activeCollection().filter(a => (!semanticUI || semanticUI.model.matches(a,state.semantic)) && facetMatches(a) && (state.type === 'all' || a.type === state.type) && (state.category === 'all' || a.category === state.category) && query.every(q => a.searchText.includes(q)) && (state.review === 'all' || reviewOf(a).status === state.review) && (state.preview === 'all' || state.preview === 'yes' === hasPreview(a)) && (!config.capabilities.animationFilters || ignoreAnimation || animationFilterMatches(a)));
  result.sort((a, b) => state.sort === 'triangles' ? (b.triangleCount ?? -1) - (a.triangleCount ?? -1) || a.name.localeCompare(b.name) : state.sort === 'name' ? a.name.localeCompare(b.name, undefined, {
    numeric: true
  }) : state.sort === 'type' ? a.type.localeCompare(b.type) || a.name.localeCompare(b.name) : Number(!!b.featured) - Number(!!a.featured) || (b.sortRank || 0) - (a.sortRank || 0) || Number(hasPreview(b)) - Number(hasPreview(a)) || (a.isObject && b.isObject ? a.catalogOrder - b.catalogOrder : 0) || a.name.localeCompare(b.name, undefined, {
    numeric: true
  }));
  return result;
}
function previewLabel(item) {
  if (item.previewStatusLabel) return item.previewStatusLabel;
  if (config.presentation === 'indexed-source') {
    if (item.isObject && !item.modelUrl && !item.modelAsset) return imageObjectPreviewLabel(item);
    if (item.isObject) return item.materialReady === false ? '模型入口 · 材质待补' : '源层级与材质 · 静态预览';
    return {
      'mesh-clay': '真实网格 · 中性材质',
      'original-texture': '原始贴图',
      'linked-texture': '关联贴图，不是材质效果',
      'metadata-only': '仅元数据',
      'hierarchy-clay': '源层级白模'
    }[item.previewMode] || '源资源预览';
  }
  if (item.isObject && neutralFallbacks(item).length) return '源材质组合 · 含未实现程序材质';
  if (item.isObject) return item.materialReady === false ? '模型入口 · 材质待补' : '源材质组合预览';
  return {
    'mesh-clay': '中性材质预览',
    'original-texture': '原始贴图',
    'linked-texture': '关联贴图，不是材质效果',
    'metadata-only': '仅元数据',
    'hierarchy-clay': '层级白模'
  }[item.previewMode] || '源资源预览';
}
function imageHTML(item, original = false, renderMode = false) {
  if (renderMode && item.modelUrl) {
    const cached = previewQueue?.peek(thumbnailKey(item));
    return `<span class="rendered-preview" data-render-id="${esc(item.id)}"><img src="${esc(cached || item.previewUrl || assetURL(config, config.pendingPreview || 'assets/preview-pending.svg'))}" alt="${esc(item.name)} · ${esc(cached ? profileTitle(profileById(defaultProfile)) : '源材质缩略图')}" loading="lazy" decoding="async"><span class="render-preview-state ${cached ? 'ready' : 'pending'}">${esc(cached ? profileTitle(profileById(defaultProfile)) : item.previewUrl ? '源材质缩略图 · 可见后更新模式' : '真实 GLB · 等待生成预览')}</span></span>`;
  }
  const url = original ? item.originalUrl || item.imageUrl || item.previewUrl : item.previewUrl || item.imageUrl || item.originalUrl;
  return url ? `<img src="${esc(url)}" alt="${esc(item.name)} · ${esc(previewLabel(item))}" loading="lazy" decoding="async">` : `<div class="placeholder-preview"><strong>${icons[item.type] || '◈'}</strong><span>${item.type === 'animation' ? '动画元数据 · 无播放预览' : '没有可视预览，保留真实源记录'}</span></div>`;
}
function cardHTML(item) {
  const status = reviewOf(item).status,
    counts = item.isObject ? ['mesh', 'material', 'texture'].map(type => [type, relatedCount(item, type)]) : [];
  return `<article class="asset-card ${item.isObject ? 'object-card' : ''} ${selected.has(item.id) ? 'selected' : ''}" data-id="${esc(item.id)}"><input class="card-check" type="checkbox" aria-label="选择 ${esc(item.name)}" ${selected.has(item.id) ? 'checked' : ''}><span class="card-review ${status}">${REVIEW_STATUSES[status]}</span><button class="card-preview ${state.bg}" aria-label="查看 ${esc(item.name)}">${imageHTML(item, false, true)}<span class="card-type">${esc(item.isObject ? categoryLabel(item.category) : typeLabels[item.type] || item.type)}${item.modelUrl ? ' · 3D' : ''}</span>${item.isObject ? `<span class="recovery-badge">${esc(item.recoveryLabel || '目录声明 · 未验证')}</span>` : ''}</button><div class="card-body" role="button" tabindex="0" aria-label="查看 ${esc(item.name)} 详情"><h3 title="${esc(item.name)}">${esc(item.name)}</h3>${item.isObject ? `<p class="card-description">${esc(item.description || item.originalName || '原始层级、材质与贴图的完整组合')}</p><div class="component-chips">${counts.filter(([, count]) => count).map(([type, count]) => `<span>${count} ${typeLabels[type]}</span>`).join('')}${canPlayAnimation(item) ? `<span class="animation-chip">▶ ${animationRecords.get(item.id).playableClipIds.length} 已验证片段</span>` : ''}<span>${fmt(item.triangleCount)} 面</span></div>` : `<div class="card-meta"><span>${item.triangleCount !== undefined ? fmt(item.triangleCount) + ' 三角面' : previewLabel(item)}</span><span>${esc(categoryLabel(item.category))}</span></div>`}${semanticCardHTML(item)}<div class="card-source">${esc(item.provenance?.sourceFile || item.sourceId || item.id)}${item.provenance?.pathId !== undefined ? ' · #' + esc(item.provenance.pathId) : ''}</div></div></article>`;
}
function render() {
  document.body.dataset.mode = isObjectView() ? 'objects' : 'technical';
  filtered = filterItems();
  const page = pageSlice(filtered, state.page);
  state.page = page.page;
  $('#grid').className = 'grid' + (isObjectView() ? ' object-grid' : '') + (state.layout === 'list' ? ' list-view' : '');
  $('#grid').innerHTML = page.items.map(cardHTML).join('');
  $('#empty').hidden = filtered.length > 0;
  $('#result-count').textContent = filtered.length;
  $('#view-title').firstChild.textContent = {
    objects: (config.objectViewLabel || '完整物件') + ' ',
    technical: '技术资源 ',
    selected: '我的选择 ',
    reviewed: '已审阅 '
  }[state.view];
  $('#view-hint').textContent = isObjectView() ? '打开一个物件，把几何、材质、贴图与层级放在一起看。' : state.view === 'technical' ? '底层资源库用于溯源和细查；完整效果请回到“完整物件”。' : '选择和审阅记录仅保存在当前浏览器。';
  $('#render-summary').hidden = !isObjectView();
  $('#result-description').textContent = `共 ${fmt(filtered.length)} ${isObjectView() ? '个物件' : '项资源'}${state.query ? ' · 搜索「' + state.query + '」' : ''}`;
  renderPagination(page);
  renderCatalogueSummary(page);
  semanticUI?.update();
  if (config.capabilities.animationFilters) renderAnimationFilterCounts();
  $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  $$('[data-type]').forEach(button => button.classList.toggle('active', button.dataset.type === state.type));
  $$('[data-category]').forEach(button => button.classList.toggle('active', button.dataset.category === state.category));
  $$('.asset-card').forEach(card => {
    const item = itemMap.get(card.dataset.id);
    card.querySelector('.card-check').onchange = event => {
      toggleSelection(item.id, event.target.checked);
      if (state.view === 'selected') render();else card.classList.toggle('selected', event.target.checked);
    };
    card.querySelector('.card-preview').onclick = () => openDetail(item);
    card.querySelector('.card-body').onclick = () => openDetail(item);
    card.querySelector('.card-body').onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetail(item);
      }
    };
    const image = card.querySelector('img');
    if (image) image.onerror = () => image.replaceWith(Object.assign(document.createElement('div'), {
      className: 'placeholder-preview',
      textContent: '缩略图读取失败 · 可打开真实模型'
    }));
  });
  renderStats();
  scheduleCardPreviews();
}
function semanticCatalogItems() {
  return [...new Map([...objects,...activeResources()].map(item=>[item.id,item])).values()];
}
function configureSemanticUI() {
  semanticUI?.dispose();
  let storage;
  try { storage=localStorage; } catch { /* UI reports nonpersistent mode below. */ }
  semanticUI=mountSemanticUI({host:$('#semantic-workbench'),identity:{projectId:config.projectId || config.id,datasetId:config.datasetId},items:semanticCatalogItems(),storage,
    getScope:()=>semanticViewScope(semanticCatalogItems(),filtered,pageSlice(filtered,state.page).items),
    getQuery:()=>state.semantic,setQuery:query=>{state.semantic=query;state.page=1;},onChange:render,download,notify:showToast});
}
function semanticCardHTML(item) {
  if(!semanticUI)return '';
  const value=semanticUI.model.effective(item);
  return `<p class="semantic-card">${esc(value.dimension)} · ${esc([...value.directCategories,...value.tags].join(' / ') || '未标注')}${value.needsReview?' · 待语义复核':''}</p>`;
}
function renderCatalogueSummary(page) {
  const summary = catalogueSummary({config,objects,resources:activeResources(),matched:filtered,page,state});
  $('#catalogue-identity').textContent = `projectId: ${summary.projectId} · datasetId: ${summary.datasetId}`;
  $('#catalogue-counts').textContent = `全目录 ${summary.objects} 个物件 / ${summary.resources} 项技术资源 · ${Object.entries(summary.byType).map(([type,count])=>`${type}: ${count}`).join(' / ')} · 当前匹配 ${summary.matched} · 本页 ${summary.range}`;
  $('#catalogue-evidence').textContent = `${summary.modelEntrances} 个模型入口（不等于完整物件） · 覆盖/包含：${summary.coverage ? `声明 ${summary.coverage.declared}，未知 ${summary.coverage.unknown}，闭合包含声明 ${summary.coverage.contains}，悬空/自引用 ${summary.coverage.unresolved}，重叠子项 ${summary.coverage.overlaps}` : '未知（未声明根/子层级/技术预览关系）'}。准备状态、CPU 数值、GPU 加载、外观和动画证据彼此独立；未提供证据即未知。`;
  const host=$('#active-conditions'); host.replaceChildren();
  for(const condition of summary.conditions) {
    const button=document.createElement('button'); button.className='light-btn';
    button.textContent=`${condition.label}: ${condition.value} ×`; button.setAttribute('aria-label',`清除 ${condition.label}: ${condition.value}`);
    button.onclick=()=>{clearCondition(state,condition.key); $('#search').value=state.query; $('#category-filter').value=state.category; $('#review-filter').value=state.review; $('#preview-filter').value=state.preview; renderFacetControls(); renderNavigation(); render();}; host.append(button);
  }
  if(!summary.conditions.length) host.textContent='无活动筛选（当前视图范围独立于筛选）';
}
function renderPagination(page) {
  $('#shown-count').textContent = page.total ? `显示 ${fmt(page.start)}–${fmt(page.end)} / ${fmt(page.total)} 项` : '显示 0 / 0 项';
  $('#page-summary').textContent = page.total ? `第 ${page.page} / ${page.totalPages} 页 · 每页 ${PAGE_SIZE} 项` : `没有匹配结果 · 每页 ${PAGE_SIZE} 项`;
  $('#page-prev').disabled = !page.hasPrevious;
  $('#page-next').disabled = !page.hasNext;
  $('#page-numbers').innerHTML = paginationTokens(page.page, page.totalPages).map(token => typeof token === 'number' ? `<button class="page-number ${token === page.page ? 'active' : ''}" data-page="${token}" aria-label="第 ${token} 页" ${token === page.page ? 'aria-current="page"' : ''}>${token}</button>` : '<span class="page-ellipsis" aria-hidden="true">…</span>').join('');
  $$('[data-page]').forEach(button => button.onclick = () => goToPage(Number(button.dataset.page)));
  $('#grid').setAttribute('aria-label', page.total ? `第 ${page.page} 页，显示第 ${page.start} 至 ${page.end} 项，共 ${page.total} 项` : '没有匹配资产');
}
function goToPage(requestedPage) {
  state.page = pageSlice(filtered, requestedPage).page;
  render();
  const grid = $('#grid');
  grid.focus({
    preventScroll: true
  });
  grid.scrollIntoView?.({
    block: 'start',
    behavior: 'auto'
  });
}
function toggleSelection(id, on) {
  if (on) selected.add(id);else selected.delete(id);
  persist();
  renderStats();
}
function metricHTML(item) {
  let rows;
  if (item.isObject) rows = [['模型资源', relatedCount(item, 'mesh') || item.meshCount || '未关联'], ['关联材质', relatedCount(item, 'material')], ['关联贴图', relatedCount(item, 'texture')], ['原始节点', item.nodeCount ?? '见层级']];else if (item.type === 'texture') rows = [['尺寸', `${item.width ?? '未知'} × ${item.height ?? '未知'}`], ['格式', item.format || '未提取'], ['Path ID', item.provenance?.pathId], ['预览', previewLabel(item)]];else if (item.type === 'animation') rows = [['时长', item.duration === undefined ? '未提取' : item.duration + ' 秒'], ['采样率', item.sampleRate], ['循环', item.loop === undefined ? '未提取' : item.loop ? '是' : '否'], ['播放', '本页未实现']];else if (item.type === 'material') rows = [['Shader', item.shaderName], ['关联贴图', item.textureCount], ['浮点参数', item.floatParameterCount], ['颜色参数', item.colorParameterCount]];else rows = [['顶点', fmt(item.vertexCount)], ['三角面', fmt(item.triangleCount)], ['材质', item.materialIds?.length ?? '未关联'], ['骨骼', item.boneCount ?? '未提取']];
  return rows.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value ?? '未提取')}</strong></div>`).join('');
}
function coverageText(item) {
  const c = item.sourceCoverage || {};
  return [[c.nodeCount, '源节点'], [c.visibleMeshInstances, '可见网格实例'], [c.referencedMaterials, '材质引用'], [c.referencedTextures, '贴图引用'], [c.linkedAnimationClips, '动作元数据'], [c.omittedRenderers, '未显示渲染器']].filter(([n]) => n !== undefined && n > 0).map(([n, label]) => n + ' ' + label).join(' · ');
}
function printable(value) {
  return value === null || value === undefined ? '未提取' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}
function provenanceHTML(item) {
  const p = item.provenance || {},
    rows = [['资源包', p.sourceBundle], ['序列化文件', p.serializedFile], ['目录状态', p.label || item.assemblyStatus], ['源文件', p.sourceFile], ['Path ID', p.pathId], ['稳定标识', item.sourceId || item.id], ['源归档', p.archive], ['原始名称', item.originalName], ['顶点 / 面', item.vertexCount !== undefined ? `${fmt(item.vertexCount)} / ${fmt(item.triangleCount)}` : null], ['数据通道', item.channels], ['原始 Shader', item.shaderName], ['使用位置', item.usagePaths], ['坐标转换', item.coordinateSystem || item.boundsCoordinateSystem], ['源对象 SHA256', p.sourceObjectSha256], [animationRecords.has(item.id) ? '动画来源说明' : '说明', item.notes?.join('；')]];
  return rows.filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(printable(value))}</dd>`).join('');
}
function downloadsHTML(item) {
  return [[item.metadataUrl,'目录元数据'],[item.modelAsset?null:item.modelUrl,'GLB 模型'],[item.originalUrl,'原始图像'],...(item.downloads||[]).filter(d=>d.kind==='url').map(d=>[d.url,d.label])].filter(([url])=>url).map(([url,label])=>`<a class="light-btn" href="${esc(url)}" download>↓ ${esc(label)}</a>`).join('');
}
function relationGroupHTML(type, linked, label = type === 'animation' ? '动作元数据' : typeLabels[type] || {
  material: '材质',
}[type] || type, empty = '目录没有声明此类关联。') {
  return `<details class="relation-group" ${['material', 'texture'].includes(type) ? 'open' : ''}><summary>${esc(label)}<span>${linked.length} 项</span></summary>${linked.length ? `${type === 'animation' ? '<p class="relation-empty">只有带 ▶ 的条目能播放独立片段；其余仅打开源元数据，尚未转换或验证。原始 Clip 完整时域不等于完整游戏动作；纯事件片段也不代表骨骼运动。</p>' : ''}<div class="relation-list">${linked.map(resource => `<button data-related="${esc(resource.id)}" title="${esc(resource.name)}">${esc(resource.name)}${type === 'animation' ? '<small>引用 · 未转换 · 查看元数据 ↗</small>' : ''}</button>`).join('')}</div>${type === 'texture' ? `<div class="relation-thumbnails">${linked.filter(a => a.previewUrl).slice(0, 12).map(resource => `<button data-related="${esc(resource.id)}" aria-label="查看贴图 ${esc(resource.name)}"><img src="${esc(resource.previewUrl)}" alt="${esc(resource.name)}"></button>`).join('')}</div>` : ''}` : `<div class="relation-empty">${esc(empty)}</div>`}</details>`;
}
function relationsHTML(item) {
  if(!item.isObject)return '';
  return '<h3>目录声明的组成资源</h3>'+['mesh','material','texture','animation'].map(type=>relationGroupHTML(type,relatedResources(item,type),undefined,'目录没有声明此类关联。')).join('');
}
function profileById(id) {
  return profiles.find(p => p.id === id && availableProfile(p)) || profiles.find(availableProfile);
}
function profileTitle(profile) {
  return profile.status === 'evidence-based-approximation' && !/近似/.test(profile.label) ? profile.label + ' · 参数近似' : profile.label;
}
function viewerProfile(profile) {
  if(!availableProfile(profile))throw Error('不支持的预览模式');
  const mode = profile.mode;
  return {
    ...profile,
    mode,
    parameters: profile.parameters || {}
  };
}
function buildProfiles() {
  const implemented = profiles.filter(availableProfile);
  const options = implemented.map(profile => `<option value="${esc(profile.id)}">${esc(profileTitle(profile))}</option>`).join('');
  for (const [id, value] of [['default-profile', defaultProfile], ['profile-a', profileA], ['profile-b', profileB]]) {
    $('#' + id).innerHTML = options;
    $('#' + id).value = value;
  }
  $('#profiles-content').innerHTML = '<p>渲染方式只改变预览，不修改资产。风格预设用于比较形体、颜色和光照，不等同于原游戏画面。</p>' + profiles.map(p => `<section class="profile-evidence-card"><h3>${esc(p.label)}</h3><p>${esc(availableProfile(p) ? p.description || '可用于当前预览。' : '此模式尚不支持，仅保留来源说明。')}</p>${p.unsupportedFeatures?.length ? `<details><summary>限制与技术参数</summary><p>${esc(p.unsupportedFeatures.join('；'))}</p><code>${esc(JSON.stringify(p.parameters || {}))}</code></details>` : ''}</section>`).join('');
}
function updateProfileNotes() {
  for (const [suffix, id] of [['a', profileA], ['b', profileB]]) {
    const profile = profileById(id);
    $(`#profile-note-${suffix}`).textContent = profile.description;
  }
}
function syncCamera(camera, source) {
  if (syncing) return;
  syncing = true;
  try {
    (source === 'a' ? viewerB : viewerA)?.setCamera(camera);
  } finally {
    syncing = false;
  }
}
function pausePlayback() {
  animationPauseEpoch++;
  playback.pause();
}
function formatAnimationTime(seconds) {
  return (Number.isFinite(seconds) ? seconds : 0).toFixed(2) + ' s';
}
function applyAnimationFrame(state) {
  try {
    for (const viewer of [viewerA, viewerB]) {
      if (!viewer) continue;
      if (state.clipId) viewer.setAnimationTime?.(state.clipId, state.time);else viewer.resetAnimation?.();
    }
  } catch (error) {
    pausePlayback();
    $('#animation-controls').hidden = true;
    $('#animation-status').textContent = '动作预览已停止：' + error.message + '。保留静态几何与源元数据。';
  }
}
function updateAnimationControls(state) {
  $('#animation-toggle').textContent = state.playing ? 'Ⅱ 暂停' : '▶ 播放';
  $('#animation-toggle').setAttribute('aria-label', state.playing ? '暂停当前原始动作' : '播放当前原始动作');
  $('#animation-toggle').setAttribute('aria-pressed', String(state.playing));
  $('#animation-clip').value = state.clipId || '';
  $('#animation-speed').value = String(state.speed);
  $('#animation-seek').value = state.duration ? String(Math.round(state.time / state.duration * 1000)) : '0';
  $('#animation-seek').setAttribute('aria-valuetext', formatAnimationTime(state.time) + ' / ' + formatAnimationTime(state.duration));
  $('#animation-time').textContent = formatAnimationTime(state.time) + ' / ' + formatAnimationTime(state.duration);
  const clip = animationClips.find(clip => clip.id === state.clipId);
  $('#animation-repeat').value = state.loopMode || 'source';
  $('#animation-current-summary').textContent=clip?`${clip.name} · ${formatAnimationTime(clip.duration)} · 独立片段`:'';
  for(const id of ['animation-toggle','animation-repeat','animation-seek','animation-speed'])$('#'+id).disabled=!clip;
  $('#animation-source').hidden = !sourceMap.has(clip?.sourceId);
  $('#animation-loop').textContent = clip ? state.loopMode === 'repeat' ? '重复当前选择' : state.loopMode === 'once' ? '仅一次' : clip.loop ? '源设置：循环' : '源设置：单次' : '';
  const clipNote = clip?.limitations?.[0] || '';
  if ($('#animation-clip-note').textContent !== clipNote) $('#animation-clip-note').textContent = clipNote;
  $('#animation-clip-note').hidden = !clipNote;
  const clipEvidence = clip?.limitations?.join('；') || '';
  if ($('#animation-clip-limitations-text').textContent !== clipEvidence) $('#animation-clip-limitations-text').textContent = clipEvidence;
  $('#animation-clip-limitations').hidden = !clipEvidence;
}
function showAnimationAvailability(item, record) {
  $('#animation-heading-label').textContent=record?'已验证动画片段':'动画引用';
  const hasReferences = item.isObject && relatedResources(item, 'animation').length > 0;
  $('#animation-panel').hidden = !hasReferences && !record;
  $('#animation-controls').hidden = true;
  $('#animation-status').textContent = record ? '正在核验原始动作与节点绑定…' : hasReferences ? '此物件有动作引用，但尚未恢复可验证的播放曲线；下列条目仍仅为元数据。' : '';
  $('#animation-source').hidden = true;
  $('#animation-loop').textContent = '';
  $('#animation-limitations').hidden = true;
  $('#animation-limitations').innerHTML = '';
  $('#animation-overall-limitations').hidden = true;
  $('#animation-overall-limitations-text').textContent = '';
}
function bindAnimationControls(item,record,preserved,animationData) {
  animationClips=verifiedViewerClips(record,viewerA?.getAnimationClips?.()||[]).map(clip=>({...clip,sourceId:clip.sourceId||clip.sourceClipId}));
  playback.configure(animationClips);
  $('#animation-controls').hidden=!animationClips.length;
  $('#animation-panel').hidden=!animationClips.length&&!record&&!relatedResources(item,'animation').length;
  $('#animation-clip').disabled=false;
  $('#animation-clip').innerHTML=animationClips.map(clip=>`<option value="${esc(clip.id)}">${esc(clip.name||clip.id)} · ${formatAnimationTime(clip.duration)}</option>`).join('');
  const unavailable=animationData?.unsupportedClips||[];
  $('#animation-limitations').hidden=!unavailable.length;
  $('#animation-limitations').innerHTML=unavailable.length?`<summary>未支持的片段</summary><ul>${unavailable.map(clip=>`<li>${esc(clip.name||clip.sourceClipId)}：${esc(clip.reason||'曲线未验证')}</li>`).join('')}</ul>`:'';
  const warnings=viewerA?.getAnimationDiagnostics?.()||[],limitations=[...(record?.limitations||[]),...warnings.map(w=>w.reason||String(w))];
  $('#animation-overall-limitations').hidden=!limitations.length;
  $('#animation-overall-limitations-text').textContent=limitations.join('；');
  $('#animation-status').textContent=animationClips.length?`${animationClips.length} 个独立已验证片段；不执行脚本、事件或物理。`:record?'绑定或曲线验证未通过，保留静态预览。'+limitations.join('；'):$('#animation-status').textContent;
  if(preserved&&animationClips.some(clip=>clip.id===preserved.clipId)) {
    playback.select(preserved.clipId);playback.setSpeed(preserved.speed);playback.setLoopMode(preserved.loopMode||'source');playback.seek(preserved.time);
    if(preserved.playing&&preserved.resumeEpoch===animationPauseEpoch&&!document.hidden)playback.play();
  }
  updateAnimationControls(playback.getState());
  $('#animation-evidence-link').hidden=!record?.metadataUrl;
  if(record?.metadataUrl)$('#animation-evidence-link').href=record.metadataUrl;
  for(const button of $$('#object-relations [data-related]')) {
    const resource=resourceMap.get(button.dataset.related),clip=animationClips.find(c=>c.sourceId===resource?.sourceId);
    if(resource?.type==='animation'&&clip)button.onclick=()=>selectPlayableClip(clip.id,true);
  }
}
function selectPlayableClip(id, autoplay = false) {
  pausePlayback();
  const clip = animationClips.find(clip => clip.id === id);
  if (!clip || !playback.select(id)) return;
  playback.setSpeed(clip.duration < 0.2 ? 0.1 : 1);
  if (autoplay) playback.play();
  $('.preview-panel').focus({
    preventScroll: true
  });
}
async function startViewers(preserveCamera = false, preservePlayback = true) {
  const previousCamera = preserveCamera ? viewerA?.getCamera?.() : undefined,
    preserved = preserveCamera && preservePlayback ? {
      ...playback.getState(),
      resumeEpoch: animationPauseEpoch
    } : null;
  playback.pause();
  animationClips = [];
  viewerAbort?.abort();
  const abort = new AbortController();
  viewerAbort = abort;
  const request = ++viewerRequest;
  viewerA?.dispose();
  viewerB?.dispose();
  viewerA = null;
  viewerB = null;
  playback.configure([]);
  const item = current;
  if (!item) return;
  const rendered = currentVariant ? {
    ...item,
    ...currentVariant
  } : item;
  viewerLoading = true;
  $('#toggle-render-compare').disabled = true;
  const candidateRecord = item.isObject ? selectedAnimationRecord(item) : null;
  const animationRecord = canPlayAnimation(item) ? candidateRecord : null;
  showAnimationAvailability(item, animationRecord);
  const stageA = $('#preview-stage'),
    stageB = $('#preview-stage-b');
  stageA.className = 'preview-stage ' + state.bg;
  stageB.className = 'preview-stage ' + state.bg;
  stageA.innerHTML = imageHTML(item, true);
  stageB.innerHTML = imageHTML(item, true);
  $('#compare-pane').hidden = !comparison;
  $('#render-viewports').classList.toggle('comparing', comparison);
  $('#toggle-render-compare').textContent = comparison ? '关闭同机位对比' : '开启同机位对比';
  $('#toggle-render-compare').hidden = false;
  $('#toggle-render-compare').title = config.renderer.compare === false ? '当前格式暂不支持双视图' : '对比两种渲染方式';
  $('#profile-a').disabled = !rendered.modelUrl;
  $('#profile-b').disabled = !rendered.modelUrl;
  $('#wireframe-btn').hidden = !rendered.modelUrl;
  $('#reset-camera').hidden = !rendered.modelUrl;
  $('#wireframe-btn').classList.remove('active');
  updateProfileNotes();
  if (!rendered.modelUrl) {
    $('#preview-caption').textContent = previewLabel(item);
    viewerLoading = false;
    $('#toggle-render-compare').disabled = config.renderer.compare === false;
    return;
  }
  $('#preview-caption').textContent = '正在读取真实物件几何与材质…';
  let animationData = null;
  if (animationRecord?.dataUrl) {
    try {
      animationData = await readJSON(animationRecord.dataUrl, true, {
        signal: abort.signal
      });
    } catch {
      if (request !== viewerRequest) return;
      $('#animation-status').textContent = '动作数据读取失败，保留静态物件与元数据。';
    }
    if (request !== viewerRequest) return;
  }
  try {
    const modelUrl = animationRecord?.modelUrl || rendered.modelUrl;
    const a = await createViewer(stageA, modelUrl, {
      profile: viewerProfile(profileById(profileA)),
      modelAsset: rendered.modelAsset,
      resourceBaseUrl: rendered.resourceBaseUrl,
      signal: abort.signal,
      camera: previousCamera,
      animationData,
      onCameraChange: camera => syncCamera(camera, 'a')
    });
    if (request !== viewerRequest) {
      a.dispose();
      return;
    }
    viewerA = a;
    if (comparison) {
      const b = await createViewer(stageB, modelUrl, {
        profile: viewerProfile(profileById(profileB)),
        modelAsset: rendered.modelAsset,
        resourceBaseUrl: rendered.resourceBaseUrl,
          signal: abort.signal,
        camera: a.getCamera?.(),
        animationData,
        onCameraChange: camera => syncCamera(camera, 'b')
      });
      if (request !== viewerRequest) {
        b.dispose();
        return;
      }
      viewerB = b;
    }
    bindAnimationControls(item, animationRecord, preserved, animationData);
    if (animationClips.length) $('#preview-disclaimer').textContent = '当前仅播放通过目录门禁及节点绑定校验的 glTF 坐标动画侧车；不执行脚本、事件、物理或原工程运行时。';
    $('#preview-caption').textContent = (currentVariant?.label ? currentVariant.label + ' · ' : '') + (comparison ? '双视图联动机位与动作时间 · 拖动旋转 · 滚轮缩放' : '拖动旋转 · 滚轮缩放' + (config.renderer.compare === false ? '' : ' · 可开启同机位对比'));
  } catch (error) {
    if (request !== viewerRequest) return;
    viewerA?.dispose();
    viewerB?.dispose();
    viewerA = null;
    viewerB = null;
    abort.abort();
    pausePlayback();
    $('#animation-controls').hidden = true;
    const failure = describePreviewFailure(error);
    $('#preview-caption').textContent = failure.title;
    $('#preview-disclaimer').textContent = failure.guidance + ' ' + $('#preview-disclaimer').textContent;
    stageA.innerHTML = item.originalUrl || item.previewUrl ? imageHTML(item, true) : '';
    stageB.innerHTML = item.originalUrl || item.previewUrl ? imageHTML(item, true) : '';
    showPreviewFailure(stageA, failure);
    if (comparison) showPreviewFailure(stageB, failure);
    $('#wireframe-btn').hidden = true;
    $('#reset-camera').hidden = true;
  } finally {
    if (request === viewerRequest) {
      viewerLoading = false;
      $('#toggle-render-compare').disabled = config.renderer.compare === false;
    }
  }
}
async function openDetail(item) {
  thumbnailObserver?.disconnect();
  previewQueue?.cancel();
  if (current) saveComment();
  current = item;
  currentVariant = (item.variants || []).find(v => v.modelAsset === item.modelAsset) || (item.variants || [])[0] || null;
  const variants = $('#resource-variant');
  variants.hidden = !(item.variants || []).length;
  variants.innerHTML = (item.variants || []).map(v => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('');
  variants.value = currentVariant?.id || '';
  profileA = defaultProfile;
  if (profileB === profileA) {
    profileB = profiles.find(profile => availableProfile(profile) && profile.id !== profileA)?.id || profileA;
    $('#profile-b').value = profileB;
  }
  $('#profile-a').value = profileA;
  $('#detail-modal').showModal();
  $('#detail-title').textContent = item.name;
  $('#render-object-name').textContent = item.name;
  $('#detail-id').textContent = item.sourceId || item.id;
  const index = filtered.findIndex(a => a.id === item.id);
  $('#detail-index').textContent = index >= 0 ? `${index + 1} / ${filtered.length}` : '';
  $('#detail-tags').innerHTML = `<span>${item.isObject ? esc(config.objectViewLabel || '完整物件') : esc(typeLabels[item.type] || item.type)}</span><span>${esc(categoryLabel(item.category))}</span><span>${esc(previewLabel(item))}</span>`;
  $('#detail-selected').checked = selected.has(item.id);
  $('#detail-metrics').innerHTML = metricHTML(item);
  $('#detail-provenance').innerHTML = provenanceHTML(item);
  $('#detail-downloads').innerHTML = downloadsHTML(item);
  partnerSelections?.decorateDownloads(item, $('#detail-downloads'));
  $('#object-relations').innerHTML = relationsHTML(item);
  $('#object-relations').hidden = !item.isObject;
  $$('[data-related]').forEach(button => button.onclick = () => openResource(resourceMap.get(button.dataset.related)));
  $('#comment').value = reviewOf(item).comment || '';
  updateReviewButtons();
  $('#save-status').textContent = storageOK ? '仅保存在当前浏览器，不会自动跨设备同步' : '存储不可用，请导出备份';
  $('#preview-disclaimer').textContent = item.isObject ? '显示目录声明的模型、材质和图像关系；不凭名称猜配，不执行源项目。动画仅在验证通过后提供播放器。' : item.type === 'animation' ? '这是动画元数据，不提供播放，不虚构与完整物件的绑定。' : item.type === 'material' ? '关联贴图仅用于溯源，不是材质球渲染。请在完整物件里查看材质与几何组合。' : '当前是独立技术资源；独立白模不包含完整原材质组合。项目渲染模式仅用于光照检视，完整效果请回到“完整物件”。';
  $('#assembly-evidence').hidden = !item.isObject;
  $('#assembly-evidence').innerHTML = item.isObject ? `<strong>${esc(item.assemblyStatusLabel || item.assemblyStatus || '有来源的整体，不是碎片拼贴')}</strong>${esc(item.description || '几何、层级变换、材质槽与贴图引用保留来源关系。')}${item.sourceCoverage ? '<br>' + esc(coverageText(item)) : ''}` : '';
  if (item.displayWarning) {
    const warning = document.createElement('p');
    warning.className = 'source-fallback-warning';
    warning.textContent = item.displayWarning;
    $('#assembly-evidence').append(warning);
  }
  $('.detail-info').scrollTop = 0;
  loadObjectHierarchy(item);
  loadItemEvidence(item);
  bindResourceDownloads(item, $('#detail-downloads'));
  await startViewers();
}
async function openResource(resource) {
  if (!resource) return;
  if (resource.modelUrl) {
    await openDetail(resource);
    return;
  }
  pausePlayback();
  resourceAbort?.abort();
  resourceAbort = new AbortController();
  const resourceId = resource.id,
    request = ++resourceRequest;
  $('#resource-modal').dataset.resourceId = resourceId;
  $('#resource-title').textContent = resource.name;
  $('#resource-content').innerHTML = (resource.previewUrl ? imageHTML(resource, true) : '') + `<div class="detail-metrics">${metricHTML(resource)}</div><p class="resource-note">${esc(previewLabel(resource))}。${esc(resource.notes?.join('；') || '')}</p><dl>${provenanceHTML(resource)}</dl><div class="detail-downloads">${downloadsHTML(resource)}</div>`;
  $('#resource-modal').showModal();
  bindResourceDownloads(resource, $('#resource-content'));
  if (resource.metadataUrl) {
    try {
      const metadata = await readJSON(resource.metadataUrl, true, {
        signal: resourceAbort.signal
      });
      if (request !== resourceRequest || $('#resource-modal').dataset.resourceId !== resourceId) return;
      const sections = [['源浮点参数', metadata.floatParameters], ['源颜色参数', metadata.colorParameters], ['源 Shader 关键字', metadata.shaderKeywords], ['原始动画统计', metadata.animation || metadata.curveCounts]];
      for (const [label, data] of sections) {
        if (!data) continue;
        const detail = document.createElement('details');
        detail.className = 'source-parameters';
        const summary = document.createElement('summary');
        summary.textContent = label;
        detail.append(summary);
        const note = document.createElement('p');
        note.textContent = '这是源记录，不表示网页着色器已实现全部参数。';
        detail.append(note);
        const list = document.createElement('dl');
        for (const [key, value] of Object.entries(data)) {
          const term = document.createElement('dt'),
            description = document.createElement('dd');
          term.textContent = key;
          description.textContent = printable(value);
          list.append(term, description);
        }
        detail.append(list);
        $('#resource-content').append(detail);
      }
    } catch {
      if (request !== resourceRequest || $('#resource-modal').dataset.resourceId !== resourceId) return;
      const notice = document.createElement('p');
      notice.className = 'resource-note';
      notice.textContent = '完整元数据读取失败；仍可使用下载链接重试。';
      $('#resource-content').append(notice);
    }
  }
}
async function loadObjectHierarchy(item) {
  if (!item.isObject || !item.metadataUrl) return;
  hierarchyAbort?.abort();
  hierarchyAbort = new AbortController();
  const sequence = ++hierarchyRequest;
  try {
    const metadata = await readJSON(item.metadataUrl, true, {
      signal: hierarchyAbort.signal
    });
    if (sequence !== hierarchyRequest || current?.id !== item.id) return;
    const nodes = metadata.sourceHierarchy?.nodes;
    if (!Array.isArray(nodes) || !nodes.length) return;
    const detail = document.createElement('details');
    detail.className = 'hierarchy-tree';
    const summary = document.createElement('summary');
    summary.textContent = `原始层级 · ${nodes.length} 个节点`;
    detail.append(summary);
    const list = document.createElement('div');
    list.className = 'hierarchy-nodes';
    for (const node of nodes) {
      const row = document.createElement('div');
      row.className = 'hierarchy-node' + (node.active === false ? ' inactive' : '');
      const depth = Math.max(0, (node.hierarchy_path || '').split('/').filter(Boolean).length - 1);
      row.style.paddingLeft = Math.min(depth, 10) * 12 + 'px';
      row.textContent = (depth ? '↳ ' : '') + (node.name || node.hierarchy_path || '未命名节点') + (node.active === false ? ' · 源禁用' : '');
      row.title = node.hierarchy_path || '';
      list.append(row);
    }
    detail.append(list);
    $('#assembly-evidence').append(detail);
  } catch {}
}
function updateReviewButtons() {
  $$('.review-buttons button').forEach(button => button.classList.toggle('active', button.dataset.status === reviewOf(current).status));
}
function saveComment() {
  clearTimeout(commentTimer);
  if (!current) return;
  const comment = $('#comment').value,
    old = reviewOf(current);
  if (comment !== old.comment) {
    reviews[current.id] = {
      ...old,
      comment,
      updatedAt: new Date().toISOString()
    };
    persist();
    $('#save-status').textContent = storageOK ? '✓ 已保存到当前浏览器' : '⚠ 保存失败，请导出备份';
  }
}
function closeDetail() {
  hierarchyAbort?.abort();
  hierarchyRequest++;
  evidenceSequence++;
  viewerAbort?.abort();
  viewerAbort = null;
  viewerLoading = false;
  $('#toggle-render-compare').disabled = config.renderer.compare === false;
  pausePlayback();
  animationClips = [];
  saveComment();
  viewerRequest++;
  viewerA?.dispose();
  viewerB?.dispose();
  viewerA = null;
  viewerB = null;
  current = null;
  render();
}
function resetFilters() {
  state = {
    ...state,
    type: 'all',
    category: 'all',
    query: '',
    review: 'all',
    preview: 'all',
    animation: 'all',
    semantic: {},
    facets: {
      ...(config.defaultFacets || {})
    },
    page: 1
  };
  if (config.capabilities.animationFilters) $('#animation-filter').value = 'all';
  $('#search').value = '';
  $('#category-filter').value = 'all';
  $('#review-filter').value = 'all';
  $('#preview-filter').value = 'all';
  renderFacetControls();
  renderNavigation();
  render();
}
function changeView(view) {
  state.view = view;
  resetFilters();
  if (view === 'selected' || view === 'reviewed') {
    for (const key of Object.keys(state.facets)) state.facets[key] = 'all';
    renderFacetControls();
    render();
  }
}
function download(name, content, type) {
  const blob = new Blob([content], {
      type
    }),
    url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportJSON(all = false) {
  const subset = all ? items : items.filter(a => selected.has(a.id));
  const payload = {
    ...reviewBackupIdentity(config),
    exportedAt: new Date().toISOString(),
    catalogVersion: catalog.version,
    objectCatalogVersion: objectCatalog.version,
    scope: all ? 'full-catalogue' : 'selected',
    notice: '包含目录索引、选择和审阅记录，可导入恢复审阅；不包含模型字节、完整依赖或原工程备份。个人审阅记录来自当前浏览器，不自动同步。',
    selected: [...selected],
    reviews: Object.fromEntries(Object.entries(reviews).filter(([id]) => all || selected.has(id))),
    ...(config.compactExports ? {
      animationPreviewRecords: [...animationRecords.values()]
    } : {}),
    assetMetadataOnly: true,
    assets: exportAssetIndex(subset)
  };
  download(`${config.exportPrefix}_${all ? 'Catalogue' : 'Review'}_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
  showToast(all ? '完整目录与审阅记录已导出' : '所选物件与审阅记录已导出');
}
function exportCSV() {
  const rows = [['ID', 'Name', 'Type', 'Source file', 'Path ID', 'Vertices', 'Triangles', 'Preview mode', 'Review', 'Comment'], ...items.filter(a => selected.has(a.id)).map(a => [a.id, a.name, a.type, a.provenance?.sourceFile, a.provenance?.pathId, a.vertexCount, a.triangleCount, previewLabel(a), REVIEW_STATUSES[reviewOf(a).status], reviewOf(a).comment])];
  const safe = value => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  download(config.exportPrefix + "_Review.csv", '\ufeff' + rows.map(row => row.map(safe).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  showToast('所选条目的审阅 CSV 已导出');
}
function buildAudit() {
  const content = $('#audit-content');
  content.replaceChildren();
  const intro = document.createElement('p');
  intro.textContent = `${config.label} · ${objects.length} 个物件目录记录，${resources.length} 项技术资源。可用预览、静态来源证据和完整运行时是不同范围。`;
  content.append(intro);
  for (const section of config.auditSections || []) {
    const heading = document.createElement('h3');
    heading.textContent = section.title;
    const paragraph = document.createElement('p');
    paragraph.textContent = section.text;
    content.append(heading, paragraph);
  }
  for (const note of objectCatalog.scopeNotes || []) {
    const p = document.createElement('p');
    p.textContent = note;
    content.append(p);
  }
  const button = document.createElement('button');
  button.className = 'primary-btn';
  button.textContent = '导出目录与审阅记录';
  button.onclick = () => exportJSON(true);
  content.append(button);
  const load = document.createElement('button');
  load.className = 'light-btn';
  load.textContent = '导入审阅记录';
  load.onclick = () => $('#import-file').click();
  content.append(load);
  const restore = document.createElement('button');
  restore.id = 'restore-review-btn';
  restore.className = 'light-btn';
  restore.textContent = '精确恢复完整审阅备份（替换）';
  restore.disabled = !canRestoreReviewSnapshot(config);
  restore.title = restore.disabled ? '仅支持单存储键的本地审阅' : '替换当前审阅与选择；请先导出完整备份';
  restore.onclick = () => $('#restore-file').click();
  content.append(restore);
}
function compareSelected() {
  const list = items.filter(a => selected.has(a.id));
  if (list.length < 2 || list.length > 4) {
    showToast('请选择 2–4 项比较');
    return;
  }
  $('#compare-grid').style.setProperty('--cols', list.length);
  $('#compare-grid').innerHTML = list.map(item => `<section class="compare-item"><div class="compare-image ${state.bg}">${imageHTML(item, false, true)}</div><h3>${esc(item.name)}</h3><div class="detail-metrics">${metricHTML(item)}</div><dl><dt>类型</dt><dd>${esc(typeLabels[item.type] || item.type)}</dd><dt>结论</dt><dd>${esc(REVIEW_STATUSES[reviewOf(item).status])}</dd><dt>备注</dt><dd data-comment="${esc(item.id)}"></dd></dl><button class="primary-btn" data-open="${esc(item.id)}">打开整体与渲染比较</button></section>`).join('');
  $$('[data-comment]').forEach(element => element.textContent = reviewOf(itemMap.get(element.dataset.comment)).comment || '未填写');
  $$('[data-open]').forEach(button => button.onclick = () => {
    $('#compare-modal').close();
    openDetail(itemMap.get(button.dataset.open));
  });
  $('#compare-modal').showModal();
  scheduleCardPreviews();
}
$$('[data-view]').forEach(button => button.onclick = () => changeView(button.dataset.view));
$('.brand').onclick = event => {
  event.preventDefault();
  changeView('objects');
};
$('#search').oninput = event => {
  state.query = event.target.value.trim();
  state.page = 1;
  render();
};
$('#category-filter').onchange = event => {
  state.category = event.target.value;
  state.page = 1;
  render();
};
$('#review-filter').onchange = event => {
  state.review = event.target.value;
  state.page = 1;
  render();
};
$('#preview-filter').onchange = event => {
  state.preview = event.target.value;
  state.page = 1;
  render();
};
$('#sort').onchange = event => {
  state.sort = event.target.value;
  state.page = 1;
  render();
};
$('#clear-filters').onclick = resetFilters;
$('#empty-reset').onclick = resetFilters;
$('#page-prev').onclick = () => goToPage(state.page - 1);
$('#page-next').onclick = () => goToPage(state.page + 1);
$$('[data-bg]').forEach(button => button.onclick = () => {
  state.bg = button.dataset.bg;
  $$('[data-bg]').forEach(other => other.classList.toggle('active', other === button));
  render();
  $('#preview-stage').className = 'preview-stage ' + state.bg;
  $('#preview-stage-b').className = 'preview-stage ' + state.bg;
});
$('#clear-selection').onclick = () => {
  selected.clear();
  persist();
  render();
};
$('#compare-btn').onclick = compareSelected;
$('#export-csv').onclick = exportCSV;
$('#export-json').onclick = () => exportJSON(false);
$('#export-all').onclick = () => exportJSON(true);
$('#audit-btn').onclick = () => $('#audit-modal').showModal();
$('#profiles-btn').onclick = () => $('#profiles-modal').showModal();
$('#import-btn').onclick = () => $('#import-file').click();
$('#mobile-import').onclick = () => $('#import-file').click();
$('#mobile-audit').onclick = () => $('#audit-modal').showModal();
$('#resource-variant').onchange = event => {
  currentVariant = (current?.variants || []).find(v => v.id === event.target.value) || null;
  startViewers(false, false);
};
$('#detail-selected').onchange = event => {
  if (current) toggleSelection(current.id, event.target.checked);
};
$$('.close-modal').forEach(button => button.onclick = () => button.closest('dialog').close());
$('#detail-modal').addEventListener('close', closeDetail);
$('#resource-modal').addEventListener('close', () => {
  resourceAbort?.abort();
  resourceRequest++;
});
$('#compare-modal').addEventListener('close', () => {
  if (!$('#detail-modal').open) scheduleCardPreviews();
});
$$('.review-buttons button').forEach(button => button.onclick = () => {
  if (!current) return;
  saveComment();
  reviews[current.id] = {
    ...reviewOf(current),
    status: button.dataset.status,
    updatedAt: new Date().toISOString()
  };
  persist();
  updateReviewButtons();
  renderStats();
  $('#save-status').textContent = storageOK ? '✓ 审阅结论已保存到当前浏览器' : '⚠ 保存失败，请导出备份';
});
$('#comment').oninput = () => {
  clearTimeout(commentTimer);
  $('#save-status').textContent = '正在保存…';
  commentTimer = setTimeout(saveComment, 350);
};
$('#reset-camera').onclick = () => {
  viewerA?.reset();
  if (viewerA?.getCamera) viewerB?.setCamera(viewerA.getCamera());else viewerB?.reset();
};
$('#wireframe-btn').onclick = () => {
  const button = $('#wireframe-btn');
  button.classList.toggle('active');
  viewerA?.wireframe(button.classList.contains('active'));
  viewerB?.wireframe(button.classList.contains('active'));
};
$('#toggle-render-compare').onclick = () => {
  if (viewerLoading || config.renderer.compare === false) return;
  comparison = !comparison;
  startViewers(true);
};
$('#default-profile').onchange = event => setDefaultPreview(event.target.value);
$('#profile-a').onchange = event => {
  profileA = event.target.value;
  viewerA?.setProfile(viewerProfile(profileById(profileA)));
  updateProfileNotes();
};
$('#profile-b').onchange = event => {
  profileB = event.target.value;
  viewerB?.setProfile(viewerProfile(profileById(profileB)));
  updateProfileNotes();
};
function adjacent(direction) {
  if (!current || !filtered.length) return;
  const index = filtered.findIndex(item => item.id === current.id);
  openDetail(filtered[(index + direction + filtered.length) % filtered.length]);
}
$('#prev-asset').onclick = () => adjacent(-1);
$('#next-asset').onclick = () => adjacent(1);
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$$('dialog[open]').length) {
    event.preventDefault();
    $('#search').focus();
  }
});
$('#animation-stop').onclick = () => {
  pausePlayback();
  playback.seek(0);
};
$('#animation-toggle').onclick = () => {
  if (playback.getState().playing) pausePlayback();else playback.play();
};
$('#animation-clip').onchange = event => selectPlayableClip(event.target.value);
$('#animation-repeat').onchange = event => playback.setLoopMode(event.target.value);
$('#animation-seek').oninput = event => playback.seek(Number(event.target.value) / 1000 * playback.getState().duration);
$('#animation-speed').onchange = event => playback.setSpeed(event.target.value);
$('#animation-source').onclick = () => {
  const clip = animationClips.find(clip => clip.id === playback.getState().clipId);
  openResource(sourceMap.get(clip?.sourceId));
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pausePlayback();
    thumbnailObserver?.disconnect();
    ++thumbnailEpoch;
    previewQueue?.cancel();
  } else if (!$('#detail-modal').open) scheduleCardPreviews();
});
window.addEventListener('pagehide', () => {
  semanticUI?.cancelPending?.();
  ++restoreGeneration;
  resourceScope.invalidate();
  resourceAbort?.abort();
  hierarchyAbort?.abort();
  hierarchyRequest++;
  resourceRequest++;
  pausePlayback();
  viewerAbort?.abort();
  viewerRequest++;
  evidenceSequence++;
  viewerA?.dispose();
  viewerB?.dispose();
  viewerA = viewerB = null;
});
window.addEventListener('pagehide', saveComment);
window.addEventListener('pagehide', event => {
  thumbnailObserver?.disconnect();
  if (event.persisted) {
    previewQueue?.cancel();
  } else {
    previewQueue?.dispose();
    previewQueue = null;
  }
});
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    if (current && $('#detail-modal').open) startViewers(false, false);else scheduleCardPreviews();
  }
});
let restoreGeneration = 0;
$('#import-file').onchange = async event => {
  const generation = ++restoreGeneration;
  const identity = [config.projectId, config.datasetId, config.reviewKey];
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > config.importLimitMiB * 1024 * 1024) throw Error(`文件超过 ${config.importLimitMiB} MB，请使用本站导出的审阅 JSON`);
    const text = await file.text();
    if (generation !== restoreGeneration || identity.some((value, index) => value !== [config.projectId, config.datasetId, config.reviewKey][index])) return;
    const imported = importReviewBackup({
      text,
      knownIds: new Set(itemMap.keys()),
      parse: parseReviewImport,
      config,
      confirmLegacy: message => window.confirm(message)
    });
    if (!imported) {
      event.target.value = '';
      return;
    }
    Object.assign(reviews, imported.reviews);
    imported.selected.forEach(id => selected.add(id));
    persist();
    render();
    showToast(`已合并 ${Object.keys(imported.reviews).length} 条有效记录，忽略未知 ID；同一资产采用导入记录。`);
  } catch (error) {
    showToast('导入失败：' + error.message);
  }
  if (generation === restoreGeneration) event.target.value = '';
};
$('#restore-file').onchange = async event => {
  const generation = ++restoreGeneration;
  const identity = [config.projectId, config.datasetId, config.reviewKey, config.sharedSelections, config.selectionStorageKey];
  const knownIds = new Set(itemMap.keys());
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > config.importLimitMiB * 1024 * 1024) throw Error(`文件超过 ${config.importLimitMiB} MB`);
    const text = await file.text();
    if (generation !== restoreGeneration || identity.some((value, index) => value !== [config.projectId, config.datasetId, config.reviewKey, config.sharedSelections, config.selectionStorageKey][index])) return;
    const snapshot = restoreReviewSnapshot({
      text, knownIds, parse: parseReviewImport,
      config, storage: localStorage, confirmReplace: message => window.confirm(message)
    });
    if (!snapshot) return;
    // Persist succeeded; only now replace memory and discard the old comment timer.
    clearTimeout(commentTimer);
    reviews = snapshot.reviews;
    selected = new Set(snapshot.selected);
    legacySelected = [];
    storageOK = true;
    $('#storage-warning').hidden = true;
    if (current) {
      $('#comment').value = reviewOf(current).comment;
      $('#detail-selected').checked = selected.has(current.id);
      updateReviewButtons();
      $('#save-status').textContent = '✓ 已恢复到当前浏览器';
    }
    render();
    showToast(`已精确恢复 ${Object.keys(reviews).length} 条审阅和 ${selected.size} 项选择；原记录已替换。`);
  } catch (error) {
    showToast('恢复失败：' + error.message);
  } finally {
    if (generation === restoreGeneration) event.target.value = '';
  }
};
function setDefaultPreview(value) {
  const result = writeDefaultProfile(localStorage, value, profiles);
  defaultProfile = result.profileId;
  $('#default-profile').value = defaultProfile;
  $('#default-profile-note').textContent = result.saved ? '已记住此浏览器默认 · 卡片与详情视图 A 同步使用' : '本次已应用，但浏览器无法保存；刷新后会恢复默认';
  profileA = defaultProfile;
  $('#profile-a').value = profileA;
  if (current) {
    viewerA?.setProfile(viewerProfile(profileById(profileA)));
    updateProfileNotes();
  }
  render();
}
function scheduleCardPreviews() {
  thumbnailObserver?.disconnect();
  const epoch = ++thumbnailEpoch;
  previewQueue?.cancel();
  const scope = $('#compare-modal').open ? $('#compare-modal') : $('#grid');
  const nodes = [...scope.querySelectorAll('[data-render-id]')];
  if (!nodes.length) return;
  previewQueue ??= createPreviewQueue({
    rendererFactory: () => createThumbnailRenderer({
      width: 384,
      height: 320,
      cacheSize: 4,
      onInvalidate: invalidatePreviews
    }),
    maxEntries: config.renderer.maxEntries || 512
  });
  const submitted = new Map(),
    visible = new Set();
  const id = defaultProfile,
    profile = viewerProfile(profileById(id)),
    title = profileTitle(profileById(id));
  const load = node => {
    if (epoch !== thumbnailEpoch || document.hidden) return;
    const item = itemMap.get(node.dataset.renderId),
      image = node.querySelector('img'),
      label = node.querySelector('.render-preview-state');
    if (!item || !image || !label) return;
    const key = thumbnailKey(item, id);
    if (submitted.get(node) === key) return;
    submitted.set(node, key);
    const cached = previewQueue.peek(thumbnailKey(item, id));
    if (!cached) {
      label.textContent = `正在重绘 ${title} · 当前为源缩略图`;
      label.className = 'render-preview-state pending';
    }
    previewQueue.request(thumbnailKey(item, id), item.modelUrl, {
      profile,
      modelAsset: item.modelAsset,
      resourceBaseUrl: item.resourceBaseUrl
    }, result => {
      if (epoch !== thumbnailEpoch || !node.isConnected || submitted.get(node) !== key) return;
      if (result.status === 'ready') {
        image.src = result.url;
        image.alt = item.name + ' · ' + title;
        label.textContent = title;
        label.className = 'render-preview-state ready';
      } else {
        label.textContent = '此模式缩略图生成失败 · 当前为源缩略图';
        label.className = 'render-preview-state error';
      }
    });
  };
  if (typeof IntersectionObserver === 'function') {
    thumbnailObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);else {
          visible.delete(entry.target);
          submitted.delete(entry.target);
        }
      }
      for (const node of visible) load(node);
      previewQueue.retain([...visible].map(node => {
        const item = itemMap.get(node.dataset.renderId);
        return item ? thumbnailKey(item, id) : null;
      }).filter(Boolean));
    }, {
      rootMargin: '160px'
    });
    nodes.forEach(node => thumbnailObserver.observe(node));
  } else nodes.forEach(load);
}
if (config.capabilities.animationFilters) $('#animation-filter').onchange = event => {
  state.animation = event.target.value;
  state.page = 1;
  render();
};
function invalidatePreviews() {
  thumbnailObserver?.disconnect();
  thumbnailEpoch++;
  previewQueue?.dispose();
  previewQueue = null;
  if (!document.hidden && !$('#detail-modal').open) queueMicrotask(scheduleCardPreviews);
}
function activeResources() {
  return projectData?.datasets?.[config.datasetId]?.resources?.map(raw => itemMap.get(raw.id) || raw) || resources;
}
function renderDynamicFacets() {
  const host = $('#facet-filters');
  host.replaceChildren();
  const keys = isObjectView() ? ['publication', 'source', 'type', 'status', 'renderer'] : state.view === 'technical' ? ['librarySource', 'status'] : [];
  for (const key of keys) {
    const label = document.createElement('label');
    label.textContent = {
      publication: '发布范围',
      source: '来源项目',
      type: '物件类型',
      status: '预览状态',
      renderer: '渲染组件',
      librarySource: '资源来源'
    }[key];
    const control = document.createElement('select');
    control.dataset.facet = key;
    const options = key === 'librarySource' ? (projectData.datasets?.[config.datasetId]?.sources || []).map(s => ({
      value: s.id,
      label: s.label || s.id
    })) : projectData.filterOptions[key] || [];
    for (const option of [{
      value: 'all',
      label: '全部'
    }, ...options]) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      control.append(el);
    }
    control.value = state.facets[key] ?? 'all';
    control.onchange = () => {
      state.facets[key] = control.value;
      if (key === 'publication' && control.value === 'quarantined') {
        state.facets.status = 'all';
        renderFacetControls();
      }
      state.page = 1;
      render();
    };
    label.append(control);
    host.append(label);
  }
}
function renderFacetControls() {
  for (const control of $$('[data-facet]')) control.value = state.facets[control.dataset.facet] ?? 'all';
}
function configureShell() {
  if (projectData.filterOptions) {
    config.facets = (config.facetKeys || ['publication', 'source', 'type', 'status', 'renderer']).map(key => ({
      key,
      label: {
        publication: '发布范围',
        source: '来源项目',
        type: '物件类型',
        status: '预览状态',
        renderer: '渲染组件'
      }[key] || key,
      options: [{
        value: 'all',
        label: '全部'
      }, ...(projectData.filterOptions[key] || [])]
    }));
  }
  mountShell({
    project,
    state,
    onFacets: (key, value) => {
      state.facets[key] = value;
      if (key === 'publication' && value === 'quarantined') {
        state.facets.status = 'all';
        renderFacetControls();
      }
      state.page = 1;
      render();
    },
    onLayout: layout => {
      state.layout = layout;
      render();
    },
    onDataset: changeDataset,
    onProjectLeave: () => {
      ++restoreGeneration;
      resourceScope.invalidate();
      resourceAbort?.abort();
      hierarchyAbort?.abort();
      viewerAbort?.abort();
      viewerRequest++;
      evidenceSequence++;
      hierarchyRequest++;
      resourceRequest++;
      pausePlayback();
      thumbnailObserver?.disconnect();
      previewQueue?.dispose();
      previewQueue = null;
      viewerA?.dispose();
      viewerB?.dispose();
      viewerA = viewerB = null;
    }
  });
  if (projectData.datasets) {
    const select = $('#dataset-select');
    select.hidden = false;
    for (const dataset of Object.values(projectData.datasets)) {
      const option = document.createElement('option');
      option.value = dataset.id;
      option.textContent = dataset.label;
      select.append(option);
    }
    select.value = config.datasetId;
  }
}
function changeDataset(id) {
  if (!projectData.datasets?.[id] || id === config.datasetId) return;
  ++restoreGeneration;
  resourceScope.invalidate();
  resourceAbort?.abort();
  hierarchyAbort?.abort();
  resourceRequest++;
  hierarchyRequest++;
  evidenceSequence++;
  viewerAbort?.abort();
  viewerRequest++;
  viewerA?.dispose();
  viewerB?.dispose();
  viewerA = viewerB = null;
  pausePlayback();
  previewQueue?.dispose();
  previewQueue = null;
  thumbnailObserver?.disconnect();
  thumbnailEpoch++;
  if ($('#detail-modal').open) $('#detail-modal').close();
  config.datasetId = id;
  state.semantic = {};
  configureSemanticUI();
  for (const key of ['source', 'type', 'librarySource']) state.facets[key] = 'all';
  state.facets.libraryDataset = id;
  state.view = 'technical';
  state.page = 1;
  renderNavigation();
  render();
}
let evidenceSequence = 0;
async function loadItemEvidence(item) {
  const sequence = ++evidenceSequence,
    container = $('#item-evidence');
  container.replaceChildren();
  container.hidden = true;
  if (!projectData.loadEvidence) return;
  try {
    const evidence = await projectData.loadEvidence(item, {
      readJSON
    });
    if (sequence !== evidenceSequence || current?.id !== item.id) return;
    renderEvidenceSections(container, evidence);
  } catch {
    if (sequence !== evidenceSequence || current?.id !== item.id) return;
    container.hidden = false;
    container.textContent = '资源详情读取失败；原始目录与下载链接仍保留，请重新打开重试。';
  }
}
function bindResourceDownloads(item, container) {
  if (!item.modelAsset || !['glb', 'gltf'].includes(item.modelAsset.format)) return;
  const button = document.createElement('button');
  button.className = 'light-btn';
  button.textContent = '下载已校验的 ' + (item.modelAsset.format || '模型').toUpperCase();
  if (item.modelAsset.format === 'gltf') {
    button.disabled = true;
    button.textContent = '闭合 glTF · 需保留完整依赖目录';
    button.title = '此处不提供不完整的单文件下载；来源与依赖证据保留。';
  }
  button.onclick = async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await downloadResource(item, {
        resourceBaseUrl: item.resourceBaseUrl
      });
      if (!result || result.supported === false) throw Error(result?.reason || '此格式未提供已验证下载');
      const url = URL.createObjectURL(result.blob || new Blob([result.bytes], {
          type: result.type || 'application/octet-stream'
        })),
        link = document.createElement('a');
      link.href = url;
      link.download = result.filename || item.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showToast('下载未完成：' + error.message);
    } finally {
      button.disabled = false;
    }
  };
  container.append(button);
}
init();
