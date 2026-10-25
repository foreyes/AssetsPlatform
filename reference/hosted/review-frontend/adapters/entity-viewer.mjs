// Capability/resource adapter only. Canonical app.mjs owns every user control,
// selection, list and detail action. The native renderer/transport stay unchanged.
const MIB = 1024 * 1024;
export const capabilities = Object.freeze({
  staticModel: true, verifiedAnimation: false, singleExternalClock: true,
  renderCompare: false, simultaneousViewers: 1, cameraSync: false,
  bytePreparation: true, prepareConcurrency: 2, serialGPU: true,
  resourceCacheBytes: 64 * MIB,
  thumbnail: Object.freeze({width: 320, height: 200, dpr: 1, maxEntries: 32, maxVisible: 20, maxRasterBytes: 32 * MIB}),
});
let nativeBase = '/entity/', runtimePromise;
const viewers = new WeakMap(), retired = new Set();
let detailOwner = null;

// Configure only the mount point, never an alternate renderer or transport.
export function configureEntityRenderer({nativeBase: base = '/entity/'} = {}) {
  if (runtimePromise) throw Error('Entity renderer mount is already in use');
  if (typeof base !== 'string' || !/^\/(?!\/)[A-Za-z0-9_/-]*\/$/.test(base) || base.includes('..')) throw Error('Entity native mount must be a same-origin absolute directory');
  nativeBase = base;
}
async function runtime() {
  runtimePromise ??= Promise.all([
    import(nativeBase + 'model-viewer.js'), import(nativeBase + 'render-stage.js'),
    import(nativeBase + 'vendor/controls/OrbitControls.js'), import(nativeBase + 'entity-render-profiles.js'),
    import(nativeBase + 'thumbnail-runtime.js'), import(nativeBase + 'model-resource.js'),
    import(nativeBase + 'render-runtime.js'), import(nativeBase + 'asset-transport.js'), import(nativeBase + 'asset-delivery.js'),
  ]).then(([model, stage, controls, profiles, thumbnails, resources, renderer, transport, delivery]) => ({...model, ...stage, ...controls, ...profiles, ...thumbnails, ...resources, ...renderer, ...transport, ...delivery}));
  return runtimePromise;
}
function abortError() { return new DOMException('Preview cancelled', 'AbortError'); }
function check(signal) { if (signal?.aborted) throw abortError(); }
function modelAsset(urlOrAsset, options) {
  const asset = options.modelAsset ?? options.asset ?? (urlOrAsset && typeof urlOrAsset === 'object' ? urlOrAsset : null);
  if (!asset || !['gltf', 'glb'].includes(asset.format)) throw Error('Entity renderer requires the full validated modelAsset declaration, not a bare URL');
  // Do not reconstruct a declaration from a URL: closure, exact matrices, SHA,
  // delivery bundle and immutable resource metadata must reach native transport.
  return asset;
}
function profileFor(rt, value) {
  const id = typeof value === 'string' ? value : value?.id;
  const profile = rt.profileById(id || rt.DEFAULT_PROFILE);
  if (!profile) throw Error('Unknown Entity render profile: ' + id);
  return profile;
}
function retryRetired() {
  for (const viewer of retired) {
    viewer.retryCleanup();
    if (!viewer.cleanupPending && !viewer.pendingLoads) retired.delete(viewer);
  }
}
function stable(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stable);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
// Canonical cache keys bind exact transport/closure and the full profile snapshot.
// This intentionally does not use an item ID or bare URL as resource identity.
export function thumbnailIdentity(itemOrAsset, profile) {
  const asset = modelAsset(itemOrAsset, {modelAsset: itemOrAsset?.modelAsset ?? itemOrAsset?.asset});
  const sha256 = asset.preview_sha256 || asset.sha256;
  if (!/^[a-f0-9]{64}$/.test(sha256 || '')) throw Error('Entity thumbnail identity requires an immutable model SHA');
  return JSON.stringify(stable({schema: 'canonical-entity-render-request/v1', backend: 'entity-three', nativeBase, modelSHA256: sha256, resource: {resourceBaseUrl: itemOrAsset?.resourceBaseUrl, format: asset.format, preview_uri: asset.preview_uri, bytes: asset.bytes, delivery: asset.delivery, transport: asset.transport}, profile, camera: {preset: 'fit-world-isometric/v1', fov: 40, direction: [1, .65, 1], padding: 1.15}, pose: {mode: 'gltf-default-static', animationApplied: false}, time: 0, dimensions: {width: 320, height: 200, dpr: 1}}));
}
// Folder-adapter GLBs have relative preview_uri declarations. Rebase fetches,
// never declarations, and never opt closed glTF out of its native shared cache.
function resourceFetcher(rt, asset, resourceBaseUrl) {
  if (resourceBaseUrl == null) return null;
  if (typeof resourceBaseUrl !== 'string' || !/^\/(?!\/)[A-Za-z0-9_/-]*\/$/.test(resourceBaseUrl) || resourceBaseUrl.includes('..')) throw Error('Entity resourceBaseUrl must be a same-origin absolute directory without traversal');
  if (asset.format !== 'glb') return null;
  const delivery = rt.resolveAssetDelivery(asset);
  if (delivery.status !== 'available') return null;
  const uri = delivery.asset.preview_uri;
  if (typeof uri !== 'string' || uri.startsWith('/')) return null;
  const path = uri.replace(/^\.\//, '');
  if (path.includes('..') || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.glb$/i.test(path)) throw Error('Entity relative GLB path is invalid');
  return (target, options) => {
    if (target !== path && target !== path + '.gz.bin') throw Error('Entity rebasing refused an undeclared transport target');
    return globalThis.fetch(resourceBaseUrl + target, options);
  };
}
function modelLoader(rt, asset, resourceBaseUrl) {
  const fetcher = resourceFetcher(rt, asset, resourceBaseUrl);
  return fetcher ? (fullAsset, options) => rt.loadModelResource(fullAsset, {...options, fetcher}) : null;
}
function finiteArray(value, length) { return Array.isArray(value) && value.length === length && value.every(Number.isFinite); }

export async function createViewer(container, urlOrAsset, options = {}) {
  const asset = modelAsset(urlOrAsset, options);
  check(options.signal);
  viewers.get(container)?.dispose();
  if (detailOwner) throw Error('Entity renderer permits one active detail viewer; dispose it before opening another');
  let rt, disposed = false, native = null, stage = null, camera = null, orbit = null;
  let baseProfile, wire = false, error = null, cameraSilent = true;
  const status = globalThis.document.createElement('div');
  status.dataset.viewerStatus = ''; status.setAttribute('role', 'status');
  status.textContent = '正在校验真实模型与依赖…';
  container.replaceChildren(status);
  const dispose = () => {
    if (disposed) { retryRetired(); return; }
    disposed = true; api.ready = false; options.signal?.removeEventListener('abort', dispose);
    if (native) { retired.add(native); native.close(); }
    retryRetired();
    if (viewers.get(container) === api) viewers.delete(container);
    if (detailOwner === api) detailOwner = null;
    status.remove();
  };
  const getCamera = () => {
    if (!camera || !orbit) return null;
    return {type: 'entity-perspective/v1', position: camera.position.toArray(), target: orbit.target.toArray(), fov: camera.fov, near: camera.near, far: camera.far};
  };
  const setCamera = value => {
    if (!camera || !orbit || !value || value.type !== 'entity-perspective/v1') return false;
    if (!finiteArray(value.position, 3) || !finiteArray(value.target, 3)) throw Error('Invalid Entity camera');
    for (const key of ['fov', 'near', 'far']) if (value[key] !== undefined && !Number.isFinite(value[key])) throw Error('Invalid Entity camera ' + key);
    if ((value.fov !== undefined && (value.fov <= 0 || value.fov >= 180)) || (value.near !== undefined && value.near <= 0) || (value.far !== undefined && value.far <= (value.near ?? camera.near))) throw Error('Invalid Entity camera frustum');
    const silentBefore = cameraSilent; cameraSilent = true;
    try {
      camera.position.fromArray(value.position); orbit.target.fromArray(value.target);
      for (const key of ['fov', 'near', 'far']) if (value[key] !== undefined) camera[key] = value[key];
      camera.lookAt(orbit.target); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); orbit.update(); stage?.draw();
    } finally { cameraSilent = silentBefore; }
    return true;
  };
  const api = {
    ready: false, dispose,
    reset() { if (!disposed) native?.reset(); },
    resize() { if (!disposed) native?.resize(); },
    wireframe(value) { if (disposed || !native) return false; wire = !!value; return native.setProfile(wire ? profileFor(rt, 'entity_wireframe') : baseProfile); },
    setProfile(value) { if (disposed || !native) return false; const next = profileFor(rt, value); if (!native.setProfile(wire ? profileFor(rt, 'entity_wireframe') : next)) return false; baseProfile = next; return true; },
    getCamera, setCamera,
    getSnapshot() { return native?.getSnapshot() || null; },
    getPreviewKey() { return native?.getPreviewKey() || null; },
    get camera() { return getCamera(); },
    get warnings() { return ['静态 glTF 浏览器近似；不是原游戏 Shader、Unity 运行或动作验证。']; },
    get stats() { return {singleGPU: true, cleanupPending: native?.cleanupPending || 0, pendingLoads: native?.pendingLoads || 0}; },
  };
  viewers.set(container, api); detailOwner = api;
  options.signal?.addEventListener('abort', dispose, {once: true});
  try {
    rt = await runtime(); check(options.signal); if (disposed) throw abortError();
    baseProfile = profileFor(rt, options.profile);
    retryRetired();
    const loadModel = modelLoader(rt, asset, options.resourceBaseUrl);
    native = rt.createModelViewer(container, {
      ...(loadModel ? {loadModel} : {}),
      profile: baseProfile,
      onError(value) { error = value; if (!disposed) options.onError?.(value); },
      stageFactory(gltf, fullAsset, stageOptions) {
        const result = rt.createRenderStage(gltf, fullAsset, {...stageOptions, controlsFactory(nextCamera, canvas) {
          camera = nextCamera; orbit = new rt.OrbitControls(nextCamera, canvas); return orbit;
        }});
        stage = result;
        const changed = () => { if (!disposed && !cameraSilent) options.onCameraChange?.(getCamera()); };
        orbit.addEventListener('change', changed);
        return {...result, dispose() {
          orbit?.removeEventListener('change', changed);
          result.dispose(); stage = null; camera = null; orbit = null;
        }};
      },
    });
    const opened = await native.open(asset);
    retryRetired(); check(options.signal);
    if (!opened || disposed) throw error || abortError();
    if (options.camera) setCamera(options.camera);
    cameraSilent = false; api.ready = true; status.remove();
    return api;
  } catch (failure) { dispose(); throw failure; }
}

export function createThumbnailRenderer({onInvalidate = () => {}} = {}) {
  let disposed = false, tail = Promise.resolve(), unsubscribe = null;
  const controllers = new Set();
  async function job(urlOrAsset, options, prepare) {
    check(options.signal); if (disposed) throw abortError();
    const asset = modelAsset(urlOrAsset, options), controller = new AbortController();
    const cancel = () => controller.abort();
    controllers.add(controller); options.signal?.addEventListener('abort', cancel, {once: true});
    try {
      const rt = await runtime(); check(controller.signal); if (disposed) throw abortError();
      unsubscribe ??= rt.subscribeContext(() => { if (!disposed) onInvalidate(); });
      const loadModel = modelLoader(rt, asset, options.resourceBaseUrl);
      const result = prepare
        ? await rt.prepareModelResource(asset, {signal: controller.signal})
        : await rt.renderThumbnail(asset, {...(loadModel ? {loadModel} : {}), profile: profileFor(rt, options.profile), signal: controller.signal, onSnapshot: options.onSnapshot});
      check(controller.signal); check(options.signal); if (disposed) throw abortError();
      return result;
    } finally { options.signal?.removeEventListener('abort', cancel); controllers.delete(controller); }
  }
  return {
    // Canonical queue 0.2 supplies two byte-preparation slots. No parsing/GPU here.
    prepare(urlOrAsset, options = {}) { return job(urlOrAsset, options, true); },
    render(urlOrAsset, options = {}) {
      if (disposed || options.signal?.aborted) return Promise.reject(abortError());
      const result = tail.then(() => job(urlOrAsset, options, false));
      tail = result.catch(() => {}); return result;
    },
    dispose() { if (disposed) return; disposed = true; unsubscribe?.(); unsubscribe = null; for (const controller of controllers) controller.abort(); },
    get capabilities() { return capabilities; },
  };
}

// Preserve the previous native UI's verified GLB-only download contract. A closed
// glTF document is not a complete model download without its resource directory.
// The canonical UI owns its button, Blob URL, filename presentation and click.
export async function downloadResource(assetOrResource, {signal, resourceBaseUrl = assetOrResource?.resourceBaseUrl} = {}) {
  check(signal);
  const asset = assetOrResource?.originalAsset ?? assetOrResource?.modelAsset ?? assetOrResource;
  if (!asset || asset.format !== 'glb') return {supported: false, reason: asset?.format === 'gltf' ? '闭合 glTF 含独立依赖，当前不提供不完整的单文件下载。' : '此资源没有可校验下载的 GLB。'};
  const rt = await runtime(); check(signal);
  const delivery = rt.resolveAssetDelivery(asset);
  if (delivery.status !== 'available') return {supported: false, reason: '资源供应尚未配置，不能下载。'};
  const fetcher = resourceFetcher(rt, asset, resourceBaseUrl);
  const {bytes, sha256} = await rt.loadAssetBytes(asset, {signal, ...(fetcher ? {fetcher} : {})}); check(signal);
  const stem = String(asset.name || asset.resource_id || 'model').replace(/[^\p{L}\p{N}_. -]/gu, '_').replace(/\.glb$/i, '') || 'model';
  return {supported: true, bytes, sha256, filename: stem + '.glb', type: 'model/gltf-binary'};
}
