import {applyEntitySupplementalPreviews,readSupplementalSnapshot} from './entity-supplemental-data.mjs';
import {supplementalPin,supplementalRoot} from '../shared/entity-supplemental-pins.mjs';
import {getResourceResolver} from '../shared/resource-url.mjs';
/** Entity v17 -> common review data. No rendering, interaction, storage, or fetch. */
export const defaultFilters = Object.freeze({publication:'eligible', status:'available', source:'all', type:'all', renderer:'all', coverage:'all', libraryDataset:'verified'});

const sourceLabels = Object.freeze({HamstersAway:'Hamsters Away', CozyIsland:'Cozy Island', ParadiseMarsh:'Paradise Marsh', Sulfur:'SULFUR'});
const typeLabels = Object.freeze({decal_sprite:'2D 贴花 / Sprite', skinned_object_candidate:'蒙皮物件候选', prefab_without_explicit_renderable_component:'未见显式渲染组件', static_object_candidate:'静态物件候选', ui_or_layout_candidate:'UI / 布局候选', vfx_object_candidate:'特效物件候选', recovered_room_hierarchy_candidate:'恢复房间层级'});
const statusLabels = Object.freeze({available:'当前已供应主预览', unavailable:'尚未供应主预览', 'batch-unprocessed':'尚未转换', 'batch-failed':'批处理异常', 'batch-runtime':'需要运行时生成组合', 'batch-no-render':'默认状态无渲染物件', preview:'完整预览', 'any-preview':'任意预览或关联模型', 'associated-model':'关联模型', 'static-preview':'默认静态装配', 'partial-preview':'部分几何', 'sprite-preview':'2D 源图', 'no-preview':'无预览记录', dependencies:'依赖待核', validated:'Unity 有证据验证', research:'仅研究'});
const options = labels => Object.entries(labels).map(([value,label])=>({value,label}));
const array = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values)];

function pathAt(base, path) {
  if (!path) return null;
  if (path.startsWith('/')) return path;
  return `${base.replace(/\/$/,'')}/${path.replace(/^\.\//,'')}`;
}

function remember(reader) {
  const pending = new Map();
  return (key, ...args) => {
    if (!pending.has(key)) pending.set(key, Promise.resolve().then(()=>reader(key, ...args)).catch(error=>{pending.delete(key); throw error;}));
    return pending.get(key);
  };
}

function statusFacets(entity, model) {
  const has = model.hasPreview(entity);
  const memberships = [entity.availablePrimaryPreview ? 'available' : 'unavailable'];
  const batch = entity.batchProcessing?.state;
  if (!batch || batch === 'unprocessed') memberships.push('batch-unprocessed');
  if (model.batchFailed(entity)) memberships.push('batch-failed');
  if (batch === 'runtime_spawn_required') memberships.push('batch-runtime');
  if (batch === 'no_default_renderers') memberships.push('batch-no-render');
  if (model.fullPreview(entity)) memberships.push('preview');
  if (has || entity.modelPreviewCount > 0) memberships.push('any-preview');
  if (entity.associatedModelCount > 0) memberships.push('associated-model');
  if (model.staticPreview(entity)) memberships.push('static-preview');
  if (model.partialPreview(entity)) memberships.push('partial-preview');
  if (model.spritePreview(entity)) memberships.push('sprite-preview');
  if (!has && !(entity.modelPreviewCount > 0)) memberships.push('no-preview');
  if (model.needsDependencies(entity)) memberships.push('dependencies');
  if (model.isValidated(entity)) memberships.push('validated');
  if (entity.provenance === 'research-only' || entity.researchOnly) memberships.push('research');
  return memberships;
}

async function nativeHelpers(config, injected) {
  if (injected) return injected;
  const base = config.nativeModuleBase || '/entity/';
  const [library, model, profiles] = await Promise.all([
    import(getResourceResolver(config).resolve(pathAt(base,'library-model.js'),{kind:'module'})),
    import(getResourceResolver(config).resolve(pathAt(base,'model.js'),{kind:'module'})),
    import(getResourceResolver(config).resolve(pathAt(base,'entity-render-profiles.js'),{kind:'module'})),
  ]);
  return {library, model, profiles};
}

/** Inject native helpers in non-browser tests; runtime imports exact existing modules. */
export async function loadEntityData({readJSON, config = {}, baseUrl = config.dataBaseUrl || '/entity/', helpers} = {}) {
  if (typeof readJSON !== 'function') throw new TypeError('loadEntityData requires readJSON');
  const read = remember(readJSON);
  const resolver=getResourceResolver({...config,assetRoot:baseUrl,dataKind:'entity'});
  const dataPath=path=>path===''?resolver.assetRoot:resolver.resolve(path);
  const modelPath=asset=>{if(asset.nativeReadOnlyBatch){resolver.registerNativeAsset(asset);return resolver.resolve(asset.delivery.url,{kind:'native'})}if(asset.supplementalEntityLink)return resolver.resolveSupplementalModel(asset,supplementalRoot(supplementalPin(asset.supplementalEntityLink.entityId)));return dataPath(asset.preview_uri)};
  const [sourceCatalog, publication, rawLibraryManifest, native, folderManifest, supplementalSnapshot] = await Promise.all([
    read(dataPath('data/catalog.json')),
    read(dataPath('publication.json')),
    read(dataPath('library-manifest.json')),
    nativeHelpers(config, helpers),
    read(dataPath('folder-adapter/manifest.json'),false).catch(()=>null),
    config.supplementalPreviews===true?readSupplementalSnapshot(read,dataPath('supplemental-preview-links.json')):null,
  ]);
  if (sourceCatalog?.schemaVersion !== 'entity-review-ui/1.0' || !Array.isArray(sourceCatalog.entities)) throw new TypeError('Unsupported Entity catalog');
  const {library, model} = native;
  const supplement=applyEntitySupplementalPreviews({sourceCatalog,libraryManifest:rawLibraryManifest,snapshot:supplementalSnapshot,resolver,renderableAsset:library.renderableAsset});
  const libraryManifest=config.supplementalPreviews===true?supplement.library:rawLibraryManifest;
  const nativeProfiles = array(native.profiles?.ENTITY_PROFILES || native.profiles);
  const profiles = nativeProfiles.map(profile=>({...profile, nativeProfile:profile, implemented:true, mode:'material', status:profile.classification || 'browser-approximation', description:array(profile.limitations).join(' '), unsupportedFeatures:array(profile.limitations)}));
  const sourceEntities = new Map(sourceCatalog.entities.map(entity=>[entity.id,entity]));
  if (sourceEntities.size !== sourceCatalog.entities.length) throw new TypeError('Duplicate Entity ID');

  function dataset(manifest, id, prefix = '') {
    if (!manifest) return null;
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources)) throw new TypeError('Unsupported Entity library');
    const result = [], ids = new Set();
    for (const source of manifest.sources) for (const asset of array(source.assets)) {
      if (typeof asset.resource_id !== 'string' || !asset.resource_id || ids.has(asset.resource_id)) throw new TypeError('Duplicate or missing resource ID');
      ids.add(asset.resource_id);
      // Original records remain authoritative and are passed unchanged to native rendering.
      const renderable = library.renderableAsset(asset);
      const entityIds = array(asset.entity_ids);
      const projects = unique(entityIds.map(id=>sourceEntities.get(id)?.source).filter(Boolean));
      const isModel = library.isModelAsset(asset);
      const modelUrl = renderable && isModel ? ((asset.nativeReadOnlyBatch||asset.supplementalEntityLink)?modelPath(asset):dataPath(prefix+asset.preview_uri)) : null;
      const imageUrl = renderable && !isModel ? dataPath(prefix + asset.preview_uri) : null;
      const facets = {source:projects.length===1 ? projects[0] : 'multiple', type:isModel?'mesh':'texture', publication:'resource', status:[renderable?'available':'unavailable'], renderer:'all', coverage:asset.coverage || 'none', libraryDataset:id, librarySource:source.id};
      result.push({...asset, id:asset.resource_id, sourceId:asset.resource_id, librarySourceId:source.id, sourceLabel:source.label, source:projects.length===1?projects[0]:null, projectSources:projects, datasetId:id, tags:unique([...array(asset.tags),asset.guid,asset.format,source.label].filter(Boolean)), type:isModel?'mesh':'texture', category:isModel?'models':'textures', isObject:false, entity_ids:asset.entity_ids, downloads:renderable?[...(isModel?[{kind:"verified-model",label:"下载已验证模型",filename:asset.name+".glb"}]:[{kind:"url",label:"下载源图",url:imageUrl}]),{kind:"url",label:"资源清单与来源",url:dataPath(id==="verified"?"library-manifest.json":"folder-adapter/manifest.json")}]:[], modelAsset:asset, rawAsset:asset, sourceRecord:asset, modelUrl, imageUrl, originalUrl:imageUrl, previewUrl:imageUrl, resourceBaseUrl:asset.supplementalEntityLink?resolver.resolveSupplementalBase(asset,supplementalRoot(supplementalPin(asset.supplementalEntityLink.entityId))):dataPath(prefix), renderable, availablePrimaryPreview:renderable, triangleCount:asset.evidence?.visibleTriangleCount ?? asset.validation?.conversion?.triangles, vertexCount:asset.validation?.vertices, nodeCount:asset.evidence?.hierarchyNodes, previewStatusLabel:library.assetScopeLabel(asset), facets, notes:array(asset.limitations), relatedIds:entityIds, provenance:{sourceFile:asset.source_path, guid:asset.guid, sha256:asset.sha256}, metadataUrl:dataPath(id==='verified'?'library-manifest.json':'folder-adapter/manifest.json')});
    }
    return {id, label:id==='verified'?'已核验资源清单':'文件夹适配资源', manifest, resources:result, assets:result.map(resource=>resource.modelAsset), sources:manifest.sources};
  }

  const verified = dataset(libraryManifest,'verified');
  const alternate = dataset(folderManifest,'adapter','folder-adapter/');
  const resources = verified.resources;
  const linked = new Map();
  for (const resource of resources) for (const id of unique(array(resource.entity_ids))) {
    if (!linked.has(id)) linked.set(id,[]);
    linked.get(id).push(resource);
  }
  const objects = sourceCatalog.entities.map((record,catalogOrder)=>{
    const related = linked.get(record.id) || [];
    const supplementalPreviewStatus=config.supplementalPreviews===true?supplement.statuses.get(record.id)||null:null;
    // Same coverage-first choice as the native Entity card; associated models never become assemblies.
    const primary = related.find(resource=>resource.renderable && resource.coverage !== 'associated-model');
    const primaryModel = related.find(resource=>resource.renderable && library.isModelAsset(resource.modelAsset) && resource.coverage !== 'associated-model');
    const quarantined = record.publication?.state === 'quarantined';
    const derived = {...record, modelPreviewCount:related.filter(resource=>resource.renderable && library.isModelAsset(resource.modelAsset)).length, availablePrimaryPreview:!!primary, associatedModelCount:related.filter(resource=>resource.coverage==='associated-model').length};
    const coverage = primary?.coverage || record.preview?.coverage || 'none';
    const facets = {source:record.source, type:record.type, publication:record.publication?.state || 'eligible', status:statusFacets(derived,model), renderer:String(!!record.inlineRenderer), coverage, libraryDataset:'verified'};
    const modelResource = !quarantined ? primaryModel : null;
    const sourceEvidence = record.preview?.evidence || {};
    return {...derived, supplementalPreviewStatus, sortRank:Number(derived.availablePrimaryPreview)*10+Number(model.hasPreview(derived))*2+Number(derived.modelPreviewCount>0),sourceRecord:record, nativeType:record.type, nativeStatus:record.status, nativeProvenance:record.provenance, sourceId:record.id, sourceLabel:sourceLabels[record.source] || record.source, type:'object', isObject:true, category:record.type, typeLabel:typeLabels[record.type] || record.type, tags:unique([...array(record.tags),record.source,sourceLabels[record.source],record.type,typeLabels[record.type],record.description].filter(Boolean)), originalName:record.name, catalogOrder, coverage, facets, publicationStatus:facets.publication, status:derived.availablePrimaryPreview?'available':'unavailable', renderable:!quarantined && !!primary, downloads:[...(modelResource?[{kind:'verified-model',label:'下载已验证模型',filename:record.name+'.glb'}]:[]),...(!quarantined&&primary?.imageUrl?[{kind:'url',label:'下载原始 RGBA PNG',url:primary.imageUrl}]:[]),{kind:'url',label:'下载候选来源证据',url:dataPath(`data/entities/${encodeURIComponent(record.id)}.json`)},...(sourceEvidence.fullEvidenceUrl?[{kind:'url',label:'下载逐 Renderer / 材质证据',url:dataPath(sourceEvidence.fullEvidenceUrl)}]:[])], modelAsset:modelResource?.modelAsset || null, variants:quarantined?[]:related.filter(resource=>resource.renderable&&library.isModelAsset(resource.modelAsset)).map(resource=>({id:resource.id,label:(resource.coverage==='associated-model'?'关联模型（不是完整物件）':'静态预览 · '+resource.coverage)+' · '+resource.name,modelUrl:resource.modelUrl,modelAsset:resource.modelAsset,resourceBaseUrl:resource.resourceBaseUrl,scope:resource.coverage})),modelAssets:quarantined?[]:related.filter(resource=>resource.renderable && library.isModelAsset(resource.modelAsset)).map(resource=>resource.modelAsset), modelUrl:modelResource?.modelUrl || null, imageUrl:!quarantined?primary?.imageUrl || null:null, previewUrl:!quarantined?primary?.imageUrl || null:null, resourceBaseUrl:primaryModel?.resourceBaseUrl||dataPath(''), metadataUrl:dataPath(`data/entities/${encodeURIComponent(record.id)}.json`), evidenceUrl:sourceEvidence.fullEvidenceUrl?dataPath(sourceEvidence.fullEvidenceUrl):null, relatedIds:related.map(resource=>resource.id), assetIds:related.map(resource=>resource.id), triangleCount:sourceEvidence.visibleTriangleCount, nodeCount:sourceEvidence.hierarchyNodes, meshCount:sourceEvidence.visibleRendererCount, materialCount:sourceEvidence.materials, previewStatusLabel:quarantined?'发布隔离 · 仅来源证据':supplementalPreviewStatus?.state==='missing'?'静态补充未供应 · 版本或身份待核':model.previewLabel(derived), recoveryLabel:quarantined?'发布隔离 · 待结构化':primary?library.assetScopeLabel(primary.modelAsset):model.previewLabel(derived), description:quarantined?'保留源审计；不加载隔离场景烘焙组合。':(record.researchOnly?'私人静态研究对象；不是完整原游戏 Entity。':'候选身份与语义粒度待归并；静态装配不是完整游戏运行。'), notes:[...array(sourceEvidence.limitations),...(supplementalPreviewStatus?.state==='missing'?['静态补充未供应：'+supplementalPreviewStatus.reason+'；保留来源证据，不改用其他账户或路径。']:[])], provenance:{kind:record.provenance, sourceProject:record.source, sourceFile:sourceEvidence.sourcePrefab || sourceEvidence.requestIdentity?.sourcePath, guid:sourceEvidence.sourceGuid, unityVersion:sourceEvidence.sourceExport?.unityVersion}, assemblyStatus:quarantined?'发布隔离 · 仅来源证据':model.previewLabel(derived), animationStatus:'reference-only-not-playable'};
  });
  const objectMap = new Map(objects.map(object=>[object.id,object]));
  const defaultObjects = objects.filter(object=>object.facets.publication!=='quarantined' && object.availablePrimaryPreview);
  const previewFirst = list => [...list].sort((a,b)=>(Number(b.availablePrimaryPreview)*10+Number(model.hasPreview(b))*2+Number(b.modelPreviewCount>0))-(Number(a.availablePrimaryPreview)*10+Number(model.hasPreview(a))*2+Number(a.modelPreviewCount>0)));

  const evidence = {
    async loadDetail(id) {
      if (!objectMap.has(id)) throw new RangeError('Unknown Entity ID');
      return read(dataPath(`data/entities/${encodeURIComponent(id)}.json`));
    },
    loadResources:()=>read(dataPath('data/resources.json')),
    loadIssues:()=>read(dataPath('data/issues.json')),
    loadProvenance:()=>read(dataPath('data/provenance.json')),
    loadSourceSummary:()=>read(dataPath('data/source-summary.json')),
    async loadDependencies(id) {
      const [detail,resourceIndex,issueIndex] = await Promise.all([this.loadDetail(id),this.loadResources(),this.loadIssues()]);
      return {detail, summary:detail.dependency_summary, resources:array(detail.resource_ids).map(id=>resourceIndex[id]).filter(Boolean), issues:array(detail.issue_ids).map(id=>issueIndex[id]).filter(Boolean)};
    },
    async loadAssetEvidence(resourceId, datasetId='verified') {
      const resource = (datasetId==='adapter'?alternate?.resources:resources)?.find(resource=>resource.id===resourceId);
      if (!resource) throw new RangeError('Unknown resource ID');
      const path = resource.modelAsset.evidence?.fullEvidenceUrl;
      return path ? read(dataPath((datasetId==='adapter'?'folder-adapter/':'')+path)) : resource.modelAsset.evidence || null;
    },
  };

  async function loadEvidence(item, {signal} = {}) {
    if (signal?.aborted) throw new DOMException('Evidence loading cancelled','AbortError');
    if (!item?.isObject) {
      const resource = resources.concat(alternate?.resources || []).find(resource=>resource.id===item?.id);
      if (!resource) throw new RangeError('Unknown resource ID');
      const asset = resource.modelAsset;
      return {sections:[{id:'resource-source',title:'资源身份与来源证据',rows:[['资源 ID',asset.resource_id],['源路径',asset.source_path || '未记录'],['GUID',asset.guid || '无 / 不适用'],['SHA-256',asset.sha256 || '未记录'],['供应状态',resource.renderable?'已供应':'未供应'],['覆盖范围',asset.coverage || '未记录']],paragraphs:array(asset.limitations),raw:asset}],dependencies:array(asset.dependencies)};
    }
    const detail = await evidence.loadDetail(item.id);
    if (signal?.aborted) throw new DOMException('Evidence loading cancelled','AbortError');
    const dependencies = await evidence.loadDependencies(item.id);
    if (signal?.aborted) throw new DOMException('Evidence loading cancelled','AbortError');
    const structure = detail.structure_summary || {}, summary = detail.dependency_summary || {};
    const sections = [
      {id:'identity',title:'候选身份与发布范围',rows:[['来源',item.sourceLabel],['物件类型',item.typeLabel],['实现性质',item.nativeProvenance],['身份状态','待归并候选，尚非已确认独立物件'],['发布状态',item.publicationStatus],['发布说明',item.publication?.reason || '未记录'],['Unity 导入 / 运行','未验证'],['预览覆盖',item.assemblyStatus]],raw:detail.source},
      {id:'processing',title:'全量处理状态',rows:[['原生结果',item.nativeExport?.state || '未记录'],['网页处理',item.batchProcessing?.state || 'unprocessed'],['关联模型',item.associatedModelCount]],paragraphs:['关联模型不是当前候选的完整外观或 Prefab 装配。原游戏完整 Entity 为 0。'],raw:{nativeExport:item.nativeExport,batchProcessing:item.batchProcessing,preview:item.preview}},
      {id:'structure',title:'结构与组成',rows:[['源 Prefab 引用',array(structure.source_prefab_references).length],['资源绑定',summary.resource_bindings],['依赖问题',summary.issue_count],['动画引用（不可播放）',summary.animation_links],['特效引用（运行未验证）',summary.vfx_links]],raw:structure},
      {id:'implementations',title:'实现',paragraphs:['Prefab 是一种 Unity 实现，不是 Entity 的同义词；同一物件可关联多个实现。'],records:array(detail.implementations).map(record=>({title:record.state || record.kind,rows:[['类型',record.kind],['路径',record.path],['SHA-256',record.sha256]],raw:record}))},
      {id:'validation',title:'静态证据与尚未验证项',rows:[['Catalog 关联',detail.validation?.static_catalog_links_checked?'已检查':'未检查'],['源文件哈希',detail.validation?.source_copy_hash_verified_in_catalog?'源目录已校验':'未校验'],['Unity 回导 / 运行 / 原游戏视觉','未验证']],paragraphs:array(detail.unverified),raw:detail.validation},
      {id:'dependencies',title:'依赖资源',paragraphs:['有模型或动画引用不等于有完整或可播放预览。依赖问题数不是缺失文件数。'],rows:[['依赖闭包',summary.closure_verified?'已核实':'未核实'],['资源绑定',summary.resource_bindings],['问题数',summary.issue_count]],records:dependencies.resources.map(record=>({title:record.path?.split('/').pop() || record.type,type:record.type,rows:[['类型',record.type],['路径',record.path],['源路径',record.source_path],['GUID',record.guid || '无'],['SHA-256',record.sha256]],raw:record})),raw:summary},
      {id:'issues',title:'依赖问题证据',records:dependencies.issues.map(record=>({title:record.status,type:record.status,rows:[['证据',record.evidence || record.reason || '详见原始问题记录']],raw:record}))},
      {id:'license',title:'授权范围',paragraphs:[item.researchOnly?'仅私人研究审阅；商业使用未授权。':'来源工程不能证明资产所有权；商业许可与再分发权利待核。','本站未扩大原资产授权。'],raw:detail.license},
      {id:'source-record',title:'完整候选来源记录',raw:detail},
    ];
    if(item.supplementalPreviewStatus)sections.splice(1,0,{id:'static-supplement-link',title:'既有 Entity 静态补充关联',rows:[['关联状态',item.supplementalPreviewStatus.state],['供应缺口',item.supplementalPreviewStatus.reason||'无'],['动画能力','没有启用；仍为静态派生 GLB']],paragraphs:['保留原 Entity ID、选择与备注；不是完整原游戏 Entity，也不是 GPU 或真实伙伴登录验收。'],raw:item.supplementalPreviewStatus});
    return {sections,dependencies,detail};
  }

  const filterOptions = {
    source:array(sourceCatalog.sources).map(source=>({value:source.id,label:sourceLabels[source.id]||source.name||source.id,count:source.count,inventoryState:source.inventoryState})),
    type:options(typeLabels), publication:options({eligible:'范围合格',quarantined:'发布隔离 · 证据审阅'}), status:options(statusLabels),
    librarySource:unique([verified,alternate].filter(Boolean).flatMap(dataset=>dataset.sources.map(source=>source.id))).map(value=>({value,label:[verified,alternate].filter(Boolean).flatMap(dataset=>dataset.sources).find(source=>source.id===value)?.label || value})),
    renderer:options({'true':'含内联 Renderer','false':'未见内联 Renderer'}),
    coverage:unique(objects.map(object=>object.coverage)).map(value=>({value,label:value})),
    libraryDataset:[{value:'verified',label:'已核验资源清单'},...(alternate?[{value:'adapter',label:'文件夹适配资源'}]:[])],
  };
  const materialRules = {version:1, flatCanopySourceMaterialIds:[]};
  const catalog = {...sourceCatalog, version:sourceCatalog.generatedAt, assets:resources, categories:[{id:'models',label:'模型'},{id:'textures',label:'贴图'}]};
  const objectCatalog = {version:sourceCatalog.generatedAt, objects, categories:filterOptions.type.map(option=>({id:option.value,label:option.label})), scopeNotes:['Entity 身份与独立物件粒度待归并。范围合格不等于已供应或浏览器验证。','完整原游戏 Entity 为 0；原游戏视觉、Unity 回导和运行均未验证。'], publication, sourceCatalog};
  const counts = {staticSupplementLinked:objects.filter(o=>o.supplementalPreviewStatus?.state==='linked-static-preview').length,source:objects.length, eligible:objects.filter(object=>object.facets.publication!=='quarantined').length, quarantined:objects.filter(object=>object.facets.publication==='quarantined').length, defaultAvailable:defaultObjects.length, nativeBatchDefault:defaultObjects.filter(object=>object.modelAsset?.nativeReadOnlyBatch).length, verifiedResources:resources.length, renderableResources:resources.filter(resource=>resource.renderable).length, alternateResources:alternate?.resources.length || 0};
  return {kind:'entity', catalog, objectCatalog, resources, objects, defaultObjects:previewFirst(defaultObjects), defaultFilters:{...defaultFilters}, filterOptions, profiles, profileSources:[], materialRules, diagnostics:new Map(), sourceCatalog, publication, libraryManifest, datasets:{verified,...(alternate?{adapter:alternate}:{})}, datasetList:[verified,...(alternate?[alternate]:[])], alternateResources:alternate?.resources || [], evidence, loadEvidence, configFacets:filterOptions, loadDetail:evidence.loadDetail.bind(evidence), loadDependencies:evidence.loadDependencies.bind(evidence), counts};
}

export const loadData = loadEntityData;
