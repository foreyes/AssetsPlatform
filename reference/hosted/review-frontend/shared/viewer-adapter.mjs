import {getResourceResolver} from './resource-url.mjs';
// Common resource-capability boundary. No project interaction controller here.
let backend,configuration;
export async function configureRenderer(config){
 configuration=config;
 const url=config.renderer.kind==='entity'?new URL('../adapters/entity-viewer.mjs',import.meta.url):new URL(getResourceResolver(config).resolve(config.renderer.module,{kind:'module'}));
 backend=await import(url.href);
 backend.configureEntityRenderer?.({nativeBase:config.nativeModuleBase});
 return backend.capabilities||{};
}
export function rendererOptions(options={}){
 if(!options.resourceBaseUrl)return options;
 const resolver=getResourceResolver(configuration),origin=new URL(configuration.assetRoot),url=new URL(options.modelAsset?.supplementalEntityLink?resolver.resolveSupplementalBase(options.modelAsset,options.resourceBaseUrl):resolver.resolve(options.resourceBaseUrl));
 if(url.origin!==origin.origin||url.search||url.hash||url.username||url.password)throw Error('资源目录必须位于当前项目站点');
 return {...options,resourceBaseUrl:url.pathname};
}
export function createViewer(host,url,options){if(!backend)throw Error('资源渲染器未初始化');return backend.createViewer(host,url,rendererOptions(options))}
export function createThumbnailRenderer(options){if(!backend)throw Error('资源渲染器未初始化');const renderer=backend.createThumbnailRenderer(options);return {...renderer,...(renderer.prepare?{prepare:(url,request)=>renderer.prepare(url,rendererOptions(request))}:{}),render:(url,request)=>renderer.render(url,rendererOptions(request))}}
export function renderIdentity(item,profile,materialRules){const normalized=rendererOptions({modelAsset:item.modelAsset,resourceBaseUrl:item.resourceBaseUrl});return configuration.projectId+':'+configuration.datasetId+':'+(backend.thumbnailIdentity?.(item.modelAsset?normalized:item,profile)||`${materialRules.version}:${profile.id}:${item.id}`)}
export async function downloadResource(item,options){const asset=item.modelAsset||item;return backend.downloadResource?.(asset,rendererOptions({...options,modelAsset:asset}))}
