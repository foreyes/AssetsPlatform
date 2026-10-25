import {COMMON_RENDER_PROFILES} from './shared/common-render-profiles.mjs';
import {normalizeLegacyProfile,listCompatibleProfiles,resolvePreference,stablePreviewKey} from './shared/render-profile-registry.mjs';
import {isModelAsset} from './library-model.js';
import {RENDERER_BUILD} from './renderer-build.js';
export const DEFAULT_PROFILE='entity_current';
export const PROFILE_STORAGE_KEY='entity-review-render-profile-v1';
const common={materialMode:'source',toneMapping:'aces-filmic',outputColorSpace:'srgb',exposure:1,hemisphereIntensity:2.5,keyIntensity:3,background:0xe9ece5};
const specs=[
 {id:DEFAULT_PROFILE,label:'源材质',classification:'browser-approximation',algorithmId:'entity-gltf-materials/v1',materialPolicy:'source-gltf-materials-unchanged',parameters:common,colorPipeline:'gltf-linear-aces-to-srgb',limitations:['保留已提供的 GLTF 材质，不等同于原 Unity Shader。']},
 {id:'entity_unlit',label:'无光照',classification:'browser-approximation',algorithmId:'entity-unlit-albedo/v1',materialPolicy:'gltf-base-color-alpha-only',parameters:{...common,materialMode:'unlit',toneMapping:'none',hemisphereIntensity:0,keyIntensity:0},colorPipeline:'gltf-base-linear-to-srgb',limitations:['只显示基础色/纹理与 alpha，忽略原照明、金属度、粗糙度、法线和发光。','不支持 CozyMKMaterial 或原游戏自定义 shader hook。']},
 {id:'entity_wireframe',label:'线框',classification:'inspection',algorithmId:'entity-wireframe/v1',materialPolicy:'diagnostic-wireframe-no-albedo',parameters:{...common,materialMode:'wireframe',toneMapping:'none',hemisphereIntensity:0,keyIntensity:0},colorPipeline:'diagnostic-linear-to-srgb',limitations:['诊断显示全部三角边，故意不应用材质透明裁切；不是原物件外观。']},
];
for(const p of COMMON_RENDER_PROFILES)specs.push({id:p.id,label:p.label,classification:'browser-approximation',algorithmId:'shared-inspection/'+p.id+'/v1',materialPolicy:'preview-owned-materials-source-unchanged',parameters:{...common,materialMode:p.mode==='clay'?'clay':p.mode==='toon'?'toon':'soft',toneMapping:'none',style:p.parameters},colorPipeline:'linear-inspection-to-srgb',limitations:p.unsupportedFeatures});
export const ENTITY_PROFILES=specs.map(spec=>normalizeLegacyProfile({schemaVersion:'asset-review.render-profile/v1',...spec,aliases:[],revision:'1',sourceSite:'entity',algorithmRevision:RENDERER_BUILD.revision,backendSupport:{'entity-three':{implemented:true,requires:['model']}},postPipeline:spec.parameters.toneMapping==='aces-filmic'?'aces-filmic/exposure-1/no-additional-post':'none',evidence:[],legacy:null},'entity'));
export const ENTITY_CAPABILITIES=Object.freeze({backendId:'entity-three',revision:RENDERER_BUILD.revision,environment:'browser-webgl',capabilities:['static-inspection','generic-gltf-materials'],profiles:ENTITY_PROFILES});
export function availableProfiles(asset){return listCompatibleProfiles({modelSHA256:isModelAsset(asset)?(asset.preview_sha256||asset.sha256||null):null,capabilities:isModelAsset(asset)?['gltf']:[]},ENTITY_CAPABILITIES);}
export function profileById(id){return ENTITY_PROFILES.find(p=>p.id===id)||null;}
export function restorePreference(saved,asset){const available=availableProfiles(asset);try{return{id:resolvePreference(saved,available,DEFAULT_PROFILE),notice:null};}catch(error){if(!['UNKNOWN_PROFILE','INVALID_DATA'].includes(error.code))throw error;return{id:resolvePreference(null,available,DEFAULT_PROFILE),notice:'旧渲染偏好无效，已恢复当前默认；未修改审阅选择。'};}}
export function chooseProfile(id,asset){const available=availableProfiles(asset),resolved=resolvePreference(id,available,DEFAULT_PROFILE),entry=available.find(p=>p.id===resolved);if(!entry.available)throw Error(entry.reason);return entry.profile;}
export function freezeSnapshot(value){if(value&&typeof value==='object'){Object.values(value).forEach(freezeSnapshot);Object.freeze(value);}return value;}
export function previewKey(snapshot){return stablePreviewKey(snapshot);}
