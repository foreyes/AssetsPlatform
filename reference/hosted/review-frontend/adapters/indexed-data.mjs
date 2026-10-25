// Pure indexed Assets-folder adapter, used by Paradise Marsh and Sulfur.
// No DOM, events, storage, or interaction state belongs in data adapters.
import { getResourceResolver, mapResourceData } from '../shared/resource-url.mjs';
export async function readAssetShards(urls, readJSON, {
  maxShards = 256,
  concurrency = 4
} = {}) {
  const maximum = Number.isFinite(maxShards) && maxShards > 0 ? Math.min(Math.floor(maxShards), 1024) : 256;
  if (!Array.isArray(urls) || urls.length > maximum) throw Error(`assets/catalog.json.assetShards: shard count exceeds ${maximum}`);
  const output = new Array(urls.length);
  let next = 0,
    failed = false;
  await Promise.all(Array.from({
    length: Math.min(urls.length, Math.max(1, Math.min(Number.isFinite(concurrency) ? Math.floor(concurrency) : 4, 8)))
  }, async () => {
    while (!failed && next < urls.length) {
      const index = next++,
        url = urls[index];
      try {
        const shard = await readJSON(url);
        if (!Array.isArray(shard)) throw Error(`${url}: asset shard must be an array`);
        output[index] = shard;
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }));
  return output.flat();
}
export async function loadData({
  readJSON,
  config,
  baseUrl = config.assetRoot
}) {
  const resolver = getResourceResolver({
    ...config,
    assetRoot: baseUrl
  });
  const read = async (path, required = true) => mapResourceData(await readJSON(resolver.resolve(path), required), resolver);
  const catalog = await read('assets/catalog.json');
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw Error('assets/catalog.json: expected object');
  if (catalog.assetShards !== undefined && (!Array.isArray(catalog.assetShards) || !catalog.assetShards.every(url => typeof url === 'string' && url.trim()))) throw Error('assets/catalog.json.assetShards: expected path array');
  if (!catalog.assetShards && !Array.isArray(catalog.assets)) throw Error('assets/catalog.json.assets: required array');
  const assets = catalog.assetShards ? (await readAssetShards(catalog.assetShards, readJSON, config.jsonLimits || {})).map(r => mapResourceData(r, resolver)) : catalog.assets;
  const objectCatalog = await read('assets/objects-catalog.json');
  if (!objectCatalog || typeof objectCatalog !== 'object' || Array.isArray(objectCatalog) || !Array.isArray(objectCatalog.objects || objectCatalog.assets)) throw Error('assets/objects-catalog.json.objects: required array');
  if (config.categoryRules) objectCatalog.objects = (objectCatalog.objects || objectCatalog.assets || []).map(record => ({
    ...record,
    objectCategory: classifyCategory(record, config.categoryRules)
  }));
  const diagnostics = config.objectDiagnosticsUrl ? await read(config.objectDiagnosticsUrl) : null;
  const evidence = await read(objectCatalog.profilesUrl || 'assets/render-profiles.json', false);
  const materialRules = (await read('assets/canopy-rules.json', false)) || {
    version: 1,
    flatCanopySourceMaterialIds: []
  };
  const animationIndex = config.verifiedAnimation ? await read(config.animationCatalogUrl, false) : null;
  const actionIndex = config.verifiedAnimation ? await read(config.actionsCatalogUrl, false) : null;
  return {
    catalog: {
      ...catalog,
      assets
    },
    objectCatalog,
    diagnostics,
    evidence,
    materialRules,
    animationIndex,
    actionIndex,
    // Data-only evidence, rendered by the existing common evidence panel. No uploaded code.
    loadEvidence: async item => item.previewEvidenceUrl ? readJSON(resolver.resolve(item.previewEvidenceUrl)) : null
  };
}
export function classifyCategory(record, rules) {
  for (const rule of rules) {
    if (rule.field) {
      const value = record[rule.field];
      if (!value || (rule.exclude || []).includes(value)) continue;
      if (rule.values && !rule.values.includes(value)) continue;
      if (rule.pattern && !new RegExp(rule.pattern, rule.flags || 'i').test(value)) continue;
      if (rule.notPattern && new RegExp(rule.notPattern, rule.flags || 'i').test(value)) continue;
      return rule.category || value;
    }
    return rule.category;
  }
  return record.objectCategory || record.category || 'other';
}
