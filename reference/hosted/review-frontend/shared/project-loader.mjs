import { createJSONBudget, readBoundedJSON } from './json-budget.mjs';
// One bootstrap and resolver for every registered project/dataset.
import { createResourceResolver, getResourceResolver, resolveResourceRoot, validateResourceReference } from './resource-url.mjs';
import { record, requireField, validateProjectDescriptor, validateProjectStorage, validateCatalogData } from './project-schema.mjs';
export { validateProjectDescriptor, validateProjectStorage, validateCatalogData } from './project-schema.mjs';
function safeConfig(value, base) {
  validateResourceReference(value);
  if (typeof value !== 'string' || /[\\\0-\x20]/.test(value) || value.startsWith('//') || value.split('/').includes('..')) throw Error('Unsafe registered project config');
  const u = new URL(value, base),
    origin = new URL(base).origin;
  if (u.origin !== origin || !['http:', 'https:'].includes(u.protocol) || u.search || u.hash || u.username || u.password) throw Error('项目配置必须位于当前已授权站点');
  return u;
}
export function resolveProjectDirectory(directory, search = '', base = 'http://localhost/') {
  requireField(record(directory) && Array.isArray(directory.projects) && directory.projects.length > 0 && directory.projects.length <= 128, 'project-directory.json.projects', 'required non-empty array');
  if (directory.schema !== undefined) requireField(directory.schema === 'asset-review-project-directory/1', 'project-directory.json.schema', 'unsupported schema');
  const entries = directory.projects,
    ids = new Set();
  for (const p of entries) {
    if (!record(p) || typeof p.id !== 'string' || !p.id || ids.has(p.id)) throw Error('Duplicate/missing registered project identity');
    ids.add(p.id);
    safeConfig(p.config, base);
  }
  const requested = new URLSearchParams(search).get('project') || directory.defaultProject,
    entry = entries.find(p => p.id === requested);
  if (!entry) throw Error('未知资产项目；不会读取未登记的目录');
  return {
    ...entry,
    url: safeConfig(entry.config, base).href
  };
}
export async function loadProject({
  fetchJSON,
  location = globalThis.location
} = {}) {
  const descriptorBudget = createJSONBudget({
    jsonLimits: {
      downloadBytes: 2 * 1024 * 1024,
      decodedBytes: 2 * 1024 * 1024,
      totalDownloadBytes: 16 * 1024 * 1024,
      totalDecodedBytes: 16 * 1024 * 1024
    }
  });
  fetchJSON ??= async url => {
    const r = await fetch(url, {
      redirect: 'error'
    });
    if (!r.ok) throw Error(`${url}: 项目配置读取失败`);
    return readBoundedJSON(r, {
      budget: descriptorBudget,
      context: String(url)
    });
  };
  const directory = await fetchJSON(new URL('project-directory.json', location.href).href),
    entry = resolveProjectDirectory(directory, location.search, location.href);
  const descriptors = [];
  for (const registered of directory.projects) {
    const url = safeConfig(registered.config, location.href).href;
    try {
      descriptors.push(validateProjectDescriptor(await fetchJSON(url), registered, url));
    } catch (error) {
      throw Error(`${url}: ${error.message}`);
    }
  }
  validateProjectStorage(descriptors);
  const descriptor = descriptors.find(value => value.id === entry.id);
  const roots = new Map(descriptors.map(value => {
    const registered = directory.projects.find(p => p.id === value.id),
      url = safeConfig(registered.config, location.href).href,
      root = resolveResourceRoot(value.assetRoot, url);
    if (registered.assetRoot !== undefined && resolveResourceRoot(registered.assetRoot, url) !== root) throw Error(`${url}: descriptor root differs from registered project root`);
    return [value.id, root];
  }));
  const assetRoot = roots.get(entry.id),
    config = {
      ...descriptor.config,
      projectId: descriptor.id,
      datasetId: descriptor.datasetId || 'verified',
      assetRoot,
      nativeModuleBase: descriptor.nativeModuleBase || '/entity/',
      dataKind: descriptor.dataKind || 'indexed',
      renderer: descriptor.renderer || {
        kind: 'three',
        module: './viewer-source.mjs'
      },
      origin: new URL(location.href).origin,
      resourceMounts: descriptor.resourceMounts,
      externalOrigins: descriptor.externalOrigins || [],
      registeredProjectRoots: [...roots].filter(([id]) => id !== entry.id).map(([, root]) => root)
    };
  config.resourceResolver = createResourceResolver(config);
  return {
    config,
    typeLabels: descriptor.typeLabels || {},
    categoryLabels: descriptor.categoryLabels || {},
    objectNames: descriptor.objectNames || {},
    defaultProfiles: descriptor.defaultProfiles || [],
    directory,
    entry,
    descriptor
  };
}
export function assetURL(config, path) {
  return getResourceResolver(config).resolve(path);
}
export async function loadProjectData(project, readJSON) {
  const module = project.config.dataKind === 'entity' ? await import('../adapters/entity-data.mjs') : await import('../adapters/indexed-data.mjs');
  return validateCatalogData(await (module.loadData || module.loadEntityData)({
    readJSON,
    config: project.config,
    baseUrl: project.config.assetRoot
  }), project.config.projectId);
}
export function objectCategory(record) {
  return record.objectCategory || record.category || 'other';
}
