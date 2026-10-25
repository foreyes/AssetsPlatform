// A portable review export is an index, not a recursive runtime asset snapshot.
// Keep stable IDs and source links; nested source/renderer records can be huge.
const fields = ['id', 'sourceId', 'name', 'type', 'category', 'modelUrl', 'metadataUrl'];
export function exportAssetIndex(items) {
  return items.map(item => Object.fromEntries(fields.filter(key => typeof item[key] === 'string' || typeof item[key] === 'number').map(key => [key, item[key]])));
}
export function reviewBackupIdentity(config) {
  if (typeof config.projectId !== 'string' || !config.projectId.trim() || typeof config.datasetId !== 'string' || !config.datasetId.trim()) throw Error('Review backup requires projectId and datasetId');
  return {
    format: config.importFormat,
    version: 2,
    projectId: config.projectId,
    datasetId: config.datasetId
  };
}
