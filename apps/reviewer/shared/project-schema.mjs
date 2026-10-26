// Validate external configuration and catalogs before UI state or storage is touched.
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export function requireField(ok, path, message) {
  if (!ok) throw new TypeError(`${path}: ${message}`);
}
export function validateProjectDescriptor(descriptor, entry, path = 'project-config.json') {
  requireField(record(descriptor), path, 'expected descriptor object');
  for (const field of ['id', 'datasetId', 'assetRoot', 'dataKind']) requireField(nonempty(descriptor[field]), `${path}.${field}`, 'required non-empty string');
  requireField(descriptor.id === entry.id, `${path}.id`, 'registered project identity mismatch');
  requireField(descriptor.dataKind === 'indexed', `${path}.dataKind`, 'unsupported data adapter');
  requireField(record(descriptor.renderer) && descriptor.renderer.kind === 'three', `${path}.renderer.kind`, 'expected three');
  if (descriptor.renderer.kind === 'three') requireField(nonempty(descriptor.renderer.module), `${path}.renderer.module`, 'required module path');
  requireField(record(descriptor.config), `${path}.config`, 'required object');
  for (const field of ['label', 'reviewKey', 'renderPreferenceKey', 'importFormat', 'exportPrefix', 'defaultProfile']) requireField(nonempty(descriptor.config[field]), `${path}.config.${field}`, 'required non-empty string');
  if (descriptor.config.selectionStorageKey !== undefined) requireField(nonempty(descriptor.config.selectionStorageKey), `${path}.config.selectionStorageKey`, 'expected non-empty string');
  requireField(Number.isFinite(descriptor.config.importLimitMiB) && descriptor.config.importLimitMiB > 0, `${path}.config.importLimitMiB`, 'expected positive number');
  for (const field of ['typeLabels', 'categoryLabels', 'objectNames']) if (descriptor[field] !== undefined) requireField(record(descriptor[field]), `${path}.${field}`, 'expected object');
  if (descriptor.defaultProfiles !== undefined) requireField(Array.isArray(descriptor.defaultProfiles), `${path}.defaultProfiles`, 'expected array');
  return descriptor;
}
export function validateProjectStorage(descriptors) {
  const keys = new Map();
  for (const descriptor of descriptors) for (const field of ['reviewKey', 'renderPreferenceKey', 'selectionStorageKey']) {
    const key = descriptor.config[field];
    if (key === undefined) continue;
    requireField(!keys.has(key), `project ${descriptor.id}.config.${field}`, `storage key collides with ${keys.get(key)}`);
    keys.set(key, `${descriptor.id}.${field}`);
  }
}
export function validateCatalogData(data, context = 'catalog') {
  const seen = new Map();
  const validateItem = (item, at, allowAlias = false) => {
    requireField(record(item), at, 'expected record');
    requireField(nonempty(item.id) && !['__proto__', 'prototype', 'constructor'].includes(item.id), `${at}.id`, 'required safe non-empty string');
    requireField(!seen.has(item.id) || allowAlias && seen.get(item.id) === item, `${at}.id`, `duplicate/conflicting asset/object ID ${item.id}`);
    seen.set(item.id, item);
    requireField(nonempty(item.name), `${at}.name`, 'required non-empty string');
    for (const [key, value] of Object.entries(item)) if (/(?:Url|URL)$/.test(key) && value !== null && value !== undefined) requireField(nonempty(value), `${at}.${key}`, 'expected non-empty path string or null');
  };
  for (const [label, catalog, field] of [['assets/catalog.json', data.catalog, 'assets'], ['assets/objects-catalog.json', data.objectCatalog, data.objectCatalog?.objects !== undefined ? 'objects' : 'assets']]) {
    const path = `${context}/${label}`;
    requireField(record(catalog), path, 'expected catalog object');
    requireField(typeof catalog.version === 'number' && Number.isFinite(catalog.version) && catalog.version > 0 || nonempty(catalog.version), `${path}.version`, 'required positive numeric or non-empty string version');
    requireField(Array.isArray(catalog[field]), `${path}.${field}`, 'required array');
    catalog[field].forEach((item, index) => validateItem(item, `${path}.${field}[${index}]`));
  }
  if (data.datasets !== undefined) {
    requireField(record(data.datasets), `${context}/datasets`, 'expected dataset map');
    for (const [key, dataset] of Object.entries(data.datasets)) {
      const at = `${context}/datasets.${key}`;
      requireField(record(dataset) && Array.isArray(dataset.resources), `${at}.resources`, 'required array');
      const local = new Set();
      dataset.resources.forEach((item, index) => {
        validateItem(item, `${at}.resources[${index}]`, true);
        requireField(!local.has(item.id), `${at}.resources[${index}].id`, 'duplicate dataset resource ID');
        local.add(item.id);
      });
    }
  }
  return data;
}
