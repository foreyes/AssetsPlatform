import * as backend from '../viewer.mjs';
let configuration;
export async function configureRenderer(config){configuration=config;return {};}
export function createViewer(host,url,options){return backend.createViewer(host,url,options);}
export function createThumbnailRenderer(options){return backend.createThumbnailRenderer(options);}
export function renderIdentity(item,profile,rules){return configuration.projectId+':'+configuration.datasetId+':'+item.id+':'+JSON.stringify(profile)+':'+rules.version;}
export async function downloadResource(){return {supported:false,reason:'Use the asset source links.'};}
