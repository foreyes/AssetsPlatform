// Server-owned descriptors only. Input packages cannot supply modules, profiles,
// a Site ID, ACL, external origins, or local-storage namespaces.
import {REVIEWED_PREVIEW_PROJECTS} from './reviewed-preview-projects.mjs';
import {scope, validateManifest, rootURL} from '../incremental-candidate/manifest.mjs';
const VERSION = /^v-[a-f0-9]{64}$/;
export const MAX_DIRECTORY_DATASETS = 128;
export const DESCRIPTOR_POLICY_FILE = 'project-config-policy-v2.json';
const headers = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const reply = (value, method='GET', immutable=false) => new Response(method==='HEAD'?null:JSON.stringify(value), {headers:{...headers,'Content-Type':'application/json',...(immutable?{'Cache-Control':'private, max-age=86400, immutable'}:{})}});
function identity(project, dataset) { scope(project,dataset); return `ingest-${project}-${dataset}`; }
function root(project,dataset,version) { if (!VERSION.test(version)) throw Error('Invalid ready version'); scope(project,dataset); return `/api/review-assets/${project}/${dataset}/${version}/`; }
export async function projectDirectory(env, method='GET') {
  if(!env?.DB) throw Error('Storage unavailable');
  // One bounded query; overflow/errors fail closed, never a misleading partial list.
  const result=await env.DB.prepare('SELECT a.project,a.dataset,a.version,a.revision,v.manifest_sha FROM ingest_active a LEFT JOIN ingest_versions v ON a.project=v.project AND a.dataset=v.dataset AND a.version=v.version ORDER BY a.project,a.dataset LIMIT ?').bind(MAX_DIRECTORY_DATASETS+1).all();
  if(!Array.isArray(result.results)||result.results.length>MAX_DIRECTORY_DATASETS) throw Error('Directory unavailable');
  const entries=result.results.map(row=>{
    const assetRoot=root(row.project,row.dataset,row.version);
    if(row.manifest_sha!==row.version.slice(2)||!Number.isSafeInteger(row.revision)||row.revision<1) throw Error('Ready catalog integrity unavailable');
    return {id:identity(row.project,row.dataset),label:`${row.project} · ${row.dataset}`,config:assetRoot+DESCRIPTOR_POLICY_FILE,assetRoot};
  });
  return reply({schema:'asset-review-project-directory/1',defaultProject:'entity',projects:[{id:'entity',label:'Entity 资产库',config:'./project-config.json'},...entries,...REVIEWED_PREVIEW_PROJECTS]},method);
}
export async function readyDescriptor(env,project,dataset,version,viewer) {
  scope(project,dataset); if(!VERSION.test(version)||!env?.DB) throw Error('Not ready');
  const row=await env.DB.prepare('SELECT v.manifest_sha,p.manifest_json FROM ingest_versions v JOIN ingest_plans p ON v.project=p.project AND v.dataset=p.dataset AND v.version=p.version WHERE v.project=? AND v.dataset=? AND v.version=?').bind(project,dataset,version).first();
  if(!row) return null;
  const validated=await validateManifest(JSON.parse(row.manifest_json));
  if(validated.sha256!==row.manifest_sha||validated.version!==version||validated.manifest.projectId!==project||validated.manifest.datasetId!==dataset) throw Error('Ready catalog integrity unavailable');
  const id=identity(project,dataset),assetRoot=rootURL(validated),namespace=`entity-ingest:${project}:${dataset}`;
  return {id,datasetId:dataset,sourceProjectId:project,version,assetRoot,dataKind:'indexed',renderer:{kind:'three',module:'./'+viewer.module,compare:false,maxEntries:32},externalOrigins:[],typeLabels:{mesh:'模型',prefab:'物件',texture:'源图'},categoryLabels:{},objectNames:{},defaultProfiles:[{id:'static_source',label:'静态源颜色 · 浏览器近似',mode:'material',implemented:true,status:'evidence-based-approximation',description:'使用包内静态 GLB 的源颜色与受支持材质数据；浏览器光照近似，不是原 Unity Shader 或游戏运行。'},{id:'geometry_clay',label:'中性材质 · 几何检查',mode:'clay',implemented:true,status:'inspection',description:'同一份源网格的中性材质检查模式；不表示源颜色、贴图或原 Unity Shader。'}],config:{slug:id,label:`${project} · ${dataset}`,brand:project,projectId:id,reviewKey:namespace+':reviews-v1',selectionStorageKey:namespace+':selection-v1',renderPreferenceKey:namespace+':profile-v1',profileStorageFormat:'string',importFormat:'entity-incremental-review',exportPrefix:project,defaultProfile:'static_source',compareProfile:'geometry_clay',defaultProfileLabel:'静态源颜色 / 中性材质几何检查',statsLabels:[['已登记静态物件','仅当前 ready 的规范包，不是全项目资产库'],['已绑定源贴图物件','纯源颜色材质不计入此项'],['技术资源','仅当前包内可核验的资源记录']],verifiedAnimation:false,sharedSelections:false,compactExports:false,importLimitMiB:1,presentation:'assembled-objects',capabilities:{animationFilters:false,research:false,effects:false,weaponSpotlight:false,sourceEvidenceOnlyProfiles:false},auditSections:[{title:'规范静态增量',text:'仅显示已通过严格 indexed 静态验证的包。没有执行游戏、Unity 或上传脚本；metadata-only 不等于可播放动画。原 Entity 877 批次与旧样本保持独立；仅当前已登记的 chosen manifest，不表示四个项目资产库或完整 Drive 已载入。'}]}};
}
export function descriptorResponse(descriptor,method) { return reply(descriptor,method); }
