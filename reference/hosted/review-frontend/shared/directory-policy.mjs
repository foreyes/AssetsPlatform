// Deploy-time reviewed fixed samples, never populated from ingest manifests.
// Same-origin Site authentication and unchanged audience cover these resources.
export const REVIEWED_PREVIEW_PROJECTS = Object.freeze([Object.freeze({
 id:'sulfur-m3-reviewed', label:'Sulfur · M3 完整物件样本',
 config:'/entity/trusted-sulfur-m3/project-config.json',
 assetRoot:'/entity/trusted-sulfur-m3/',
})]);

// The directory includes the fixed Entity entry and deploy-time reviewed samples.
export const MAX_ACTIVE_DATASETS = 128;
export const MAX_DIRECTORY_PROJECTS = MAX_ACTIVE_DATASETS + 1 + REVIEWED_PREVIEW_PROJECTS.length;
