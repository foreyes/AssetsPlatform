import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSelectionAssets } from '../reference/hosted/review-frontend/shared/selection-manifest.mjs';
import { describeDownload } from '../reference/hosted/review-frontend/adapters/entity-viewer.mjs';

const reviewer = {
  public: new URL('../apps/reviewer/', import.meta.url),
  hosted: new URL('../reference/hosted/review-frontend/', import.meta.url)
};
const descriptor = JSON.parse(await readFile(new URL('demo-a/project-config.json', reviewer.public)));
const asset = { id: 'one', name: 'First object', category: 'demo' };
const libraryAsset = { id: 'alternate', name: 'Alternate library asset', type: 'mesh' };
const oldReview = { status: 'skip', comment: 'Old comment' };
const incomingReview = { status: 'keep', comment: 'Imported comment' };

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.events = new Map();
    this.firstChild = { textContent: '' };
    this.value = '';
    this.textContent = '';
    this.style = { setProperty() {} };
    this.classes = new Set();
    this.classList = {
      toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name),
      remove: name => this.classes.delete(name)
    };
  }
  append(...children) {
    for (const child of children) child.parent = this;
    this.children.push(...children);
  }
  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = undefined;
  }
  replaceWith(child) {
    this.parent.children[this.parent.children.indexOf(this)] = child;
    child.parent = this.parent;
    this.parent = undefined;
  }
  get isConnected() { return !!this.parent; }
  replaceChildren(...children) { this.children = children; }
  querySelector(selector) {
    if (selector === '[data-verified-model-download]') {
      return this.children.find(child => Object.hasOwn(child.dataset, 'verifiedModelDownload'));
    }
    if (!this.childrenBySelector) this.childrenBySelector = new Map();
    if (!this.childrenBySelector.has(selector)) this.childrenBySelector.set(selector, new Element());
    return this.childrenBySelector.get(selector);
  }
  querySelectorAll() { return []; }
  setAttribute() {}
  addEventListener(name, run) {
    if (!this.events.has(name)) this.events.set(name, []);
    this.events.get(name).push(run);
  }
  showModal() {
    if (this.open) return;
    this.open = true;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    for (const run of this.events.get('close') || []) run();
  }
  after(element) { this.following = element; }
  scrollIntoView() {}
}

let fixtureId = 0;
async function boot(t, mode, {
  shared = false, sharedSession, sharedList, responses = {}, storageError, initialSelection,
  catalogAssets = [], catalogObjects = [asset], createViewer, downloadResource, storageValues
} = {}) {
  const root = reviewer[mode];
  const appRoot = mode === 'hosted' ? new URL('shared/', root) : root;
  const html = await readFile(new URL('index.html', appRoot), 'utf8');
  const source = await readFile(new URL('app.mjs', appRoot), 'utf8');
  const url = 'https://fixture.invalid/review/';
  const config = {
    ...structuredClone(descriptor.config), assetRoot: url, origin: new URL(url).origin,
    projectId: 'entity', datasetId: 'verified', renderer: descriptor.renderer, dataKind: 'entity',
    sharedSelections: shared, siteId: 'fixture'
  };
  const catalogue = deferred();
  const data = {
    kind: 'entity',
    catalog: { assets: catalogAssets },
    objectCatalog: { objects: catalogObjects },
    datasets: {
      verified: { id: 'verified', label: 'Verified', resources: [] },
      adapter: { id: 'adapter', label: 'Alternate', resources: [libraryAsset] }
    }
  };
  const dom = new Element();
  const get = selector => {
    const auditButton = dom.querySelector('#audit-content').children.find(node => '#' + node.id === selector);
    return auditButton || dom.querySelector(selector);
  };
  let cards = [];
  Object.defineProperty(get('#grid'), 'innerHTML', {
    set: html => {
      cards = [...html.matchAll(/<article class="asset-card[^"]*" data-id="([^"]+)"/g)].map(([, id]) => {
        const card = new Element();
        card.dataset.id = id;
        return card;
      });
    }
  });
  const comment = get('#comment');
  let textareaValue = '';
  Object.defineProperty(comment, 'value', {
    get: () => textareaValue,
    set: value => { textareaValue = String(value).replace(/\r\n|\r/g, '\n'); }
  });
  for (const id of ['import-btn', 'mobile-import']) {
    get('#' + id).disabled = new RegExp(`<button[^>]*id="${id}"[^>]* disabled[ >]`).test(html);
  }
  const buttons = ['keep', 'check', 'skip'].map(status => {
    const button = new Element();
    button.dataset.status = status;
    return button;
  });
  const windowEvents = new Map();
  const values = storageValues || new Map([[config.reviewKey, JSON.stringify({
    version: 1, projectId: config.projectId, datasetId: config.datasetId,
    reviews: { [asset.id]: oldReview }, selected: []
  })]]);
  if (initialSelection) {
    config.selectionStorageKey = 'fixture-selection';
    values.set(config.selectionStorageKey, JSON.stringify(initialSelection));
  }
  const calls = [];
  const localStorage = {
    getItem: key => {
      if (storageError === 'method') throw Error('Storage read blocked');
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (storageError === 'method' || storageError === key) throw Error('Storage write blocked');
      calls.push(key);
      values.set(key, value);
    }
  };
  const project = {
    config, typeLabels: descriptor.typeLabels, categoryLabels: descriptor.categoryLabels,
    objectNames: {}, defaultProfiles: descriptor.defaultProfiles, entry: { id: config.projectId },
    directory: { projects: [{ id: config.projectId }, { id: 'other' }] }
  };
  const requests = [];
  let listRequests = 0;
  const fetch = async (path, { method = 'GET', body: requestBody, signal } = {}) => {
    requests.push([path, method, requestBody, signal]);
    let body;
    if (Object.hasOwn(responses, path)) {
      body = await responses[path](requestBody);
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body));
    }
    switch (path) {
      case '/api/selection/session':
        body = sharedSession ? await sharedSession : { userId: 'reviewer' };
        break;
      case '/api/selections':
        body = ++listRequests === 1 && sharedList ? await sharedList : { lists: [] };
        break;
      case '/delivery-status.json':
        body = {};
        break;
      case '/delivery-index.json':
        body = { assets: {} };
        break;
      default:
        assert.fail(`Unexpected request ${method} ${path}`);
    }
    return new Response(JSON.stringify(body));
  };
  const timers = new Map();
  const downloads = [], blobs = new Map(), confirmations = [], alerts = [];
  let acceptConfirmation = true;
  const confirm = message => {
    confirmations.push(message);
    return acceptConfirmation;
  };
  class FixtureURL extends URL {
    static createObjectURL(blob) {
      const url = 'blob:fixture/' + blobs.size;
      blobs.set(url, blob);
      return url;
    }
    static revokeObjectURL(url) { blobs.delete(url); }
  }
  const bindings = {
    document: {
      querySelector: get, getElementById: id => get('#' + id), createElement: tag => {
        const node = new Element();
        if (tag === 'a') {
          node.click = () => downloads.push({ name: node.download, blob: blobs.get(node.href) });
          node.remove = () => {};
        }
        return node;
      },
      querySelectorAll: selector => {
        switch (selector) {
          case '.asset-card': return cards;
          case '.review-buttons button': return buttons;
          default: return [];
        }
      },
      addEventListener() {}, body: new Element()
    },
    window: { confirm, addEventListener(name, run) {
      if (!windowEvents.has(name)) windowEvents.set(name, []);
      windowEvents.get(name).push(run);
    } },
    location: { href: url, origin: config.origin, assign() {} }, localStorage, fetch, confirm, alert: message => alerts.push(message), URL: FixtureURL,
    __importFixture: {
      project, catalogue, createViewer, describeDownload, downloadResource, setTimeout: (run, delay) => {
        const timer = Symbol();
        timers.set(timer, { run, delay });
        return timer;
      },
      clearTimeout: timer => timers.delete(timer),
      console: { error() {} }
    }
  };
  for (const [name, value] of Object.entries(bindings)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    const property = name === 'localStorage' ? { get() {
      if (storageError === 'getter') throw Error('Storage getter blocked');
      return value;
    } } : { value };
    Object.defineProperty(globalThis, name, { ...property, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  const projectImport = /import \{ loadProject, loadProjectData, objectCategory, assetURL \} from '[^']+';/;
  const viewerImport = /import \{ createViewer, createThumbnailRenderer, configureRenderer, renderIdentity, (?:describeDownload, )?downloadResource \} from '[^']+';/;
  assert.match(source, projectImport);
  assert.match(source, viewerImport);
  assert.match(source, /init\(\);\s*$/);
  const selectionClientSource = mode === 'hosted' ? await readFile(new URL('shared/selection-client.mjs', root), 'utf8') : null;
  const selectionClientURL = selectionClientSource && 'data:text/javascript;base64,' + Buffer.from(
    'const {setTimeout, clearTimeout} = globalThis.__importFixture;\n' + selectionClientSource.replace(/from '(\.\/[^']+)'/g,
      (_, path) => 'from ' + JSON.stringify(new URL(path, new URL('shared/', root)).href))
  ).toString('base64') + '#' + ++fixtureId;
  const script = source
    .replace(projectImport, `
      const loadProject = async () => globalThis.__importFixture.project;
      const loadProjectData = () => globalThis.__importFixture.catalogue.promise;
      const objectCategory = item => item.category;
      const assetURL = (config, path) => new URL(path, config.assetRoot).href;
    `)
    .replace(viewerImport, 'const { createViewer, describeDownload, downloadResource } = globalThis.__importFixture; const configureRenderer = async () => {};')
    .replace(/from '(\.\/shared\/[^']+)'/g, (_, path) => {
      if (path === './shared/selection-client.mjs' && selectionClientURL) return 'from ' + JSON.stringify(selectionClientURL);
      // The hosted resolver imports generated private pins. This fixture has no native assets.
      const moduleRoot = path === './shared/resource-url.mjs' ? reviewer.public : root;
      return 'from ' + JSON.stringify(new URL(path, moduleRoot).href);
    })
    .replace(/init\(\);\s*$/, 'export const ready = init(); export { itemMap, reviews, selected, openDetail, openResource, changeView };');
  const environment = 'const { setTimeout, clearTimeout, console } = globalThis.__importFixture;\n';
  const app = await import('data:text/javascript;base64,' + Buffer.from(environment + script).toString('base64') + '#' + ++fixtureId);
  const backup = (extra = {}) => JSON.stringify({
    format: config.importFormat, version: 2, projectId: config.projectId, datasetId: config.datasetId,
    reviews: { [asset.id]: incomingReview }, selected: [asset.id], ...extra
  });
  const choose = (read = async () => backup(), value = 'chosen') => {
    const input = get('#import-file');
    input.value = value;
    input.files = [{ size: 100, text: read }];
    return input.onchange({ target: input });
  };
  const stored = () => JSON.parse(values.get(config.reviewKey));
  const dispatch = event => windowEvents.get(event)?.forEach(run => run({ persisted: true }));
  return {
    app, get, config, buttons, calls, values, stored, requests, choose, backup, dispatch, downloads, confirmations, alerts,
    activate() {
      for (const [name, value] of Object.entries(bindings)) {
        const property = name === 'localStorage' ? {get() {
          if (storageError === 'getter') throw Error('Storage getter blocked');
          return value;
        }} : {value};
        Object.defineProperty(globalThis, name, {...property, configurable: true});
      }
    },
    cardCheckbox: () => cards[0].querySelector('.card-check'),
    card: id => cards.find(card => card.dataset.id === id),
    visibleIds: () => cards.map(card => card.dataset.id),
    setStorageError: error => { storageError = error; },
    acceptConfirmation: value => { acceptConfirmation = value; },
    ready: async () => {
      catalogue.resolve(data);
      await app.ready;
      assert.equal(get('#load-error').textContent, '', 'catalogue initialization');
    },
    failLoad: () => { catalogue.reject(Error('failed catalogue')); return app.ready; },
    edit: text => {
      get('#comment').value = text;
      get('#comment').oninput();
    },
    commentTimers: () => [...timers.values()].filter(timer => timer.delay === 350),
    sessionTimers: () => [...timers.values()].filter(timer => timer.delay === 10000),
    toast: () => get('#toast').textContent
  };
}

for (const mode of Object.keys(reviewer)) {
  test(`${mode} inherits from explicit asset then prefab then the first strictly matching source`, async t => {
    const mesh = (id, sourceId, label = id) => ({
      id, sourceId, type: 'mesh', modelUrl: label + '.glb', previewUrl: label + '.svg',
      provenance: { sourceFile: label }
    });
    const catalogAssets = [
      mesh('unrelated'), mesh('null-source', null), mesh('blank-source', '  '),
      mesh('source-first', 'source'), mesh('source-second', 'source'),
      mesh('prefab'), mesh('asset', undefined, 'asset-first'), mesh('asset', undefined, 'asset-second'),
      mesh('text-source', '0'), mesh('numeric-source', 0), mesh(''),
      mesh(undefined, undefined, 'missing-id'), mesh(null, null, 'null-id')
    ];
    const catalogObjects = [
      { id: 'asset-wins', assetId: 'asset', prefabId: 'prefab', sourceId: 'source' },
      { id: 'prefab-wins', assetId: 'absent', prefabId: 'prefab', sourceId: 'source' },
      { id: 'source-fallback', prefabId: 'absent', sourceId: 'source' },
      { id: 'asset-without-source', assetId: 'asset' },
      { id: 'numeric-source-fallback', sourceId: 0 },
      { id: 'string-source-fallback', sourceId: '0' },
      { id: 'strict-source', sourceId: ' source ' },
      { id: 'missing-source' },
      { id: 'null-source-unmatched', assetId: null, prefabId: 'null', sourceId: null },
      { id: 'blank-source-unmatched', assetId: '', prefabId: 'undefined', sourceId: '  ' },
      {
        id: 'local', assetId: 'asset', modelUrl: 'local.glb', thumbnailUrl: 'local.svg',
        provenance: { sourceFile: 'local source' }
      }
    ];
    const h = await boot(t, mode, { catalogAssets, catalogObjects });
    await h.ready();
    const model = id => h.app.itemMap.get(id).modelUrl;
    assert.equal(model('asset-wins'), 'asset-first.glb');
    assert.equal(model('prefab-wins'), 'prefab.glb');
    assert.equal(model('source-fallback'), 'source-first.glb');
    assert.equal(model('asset-without-source'), 'asset-first.glb');
    assert.equal(model('numeric-source-fallback'), 'numeric-source.glb');
    assert.equal(model('string-source-fallback'), 'text-source.glb');
    for (const id of ['strict-source', 'missing-source', 'null-source-unmatched', 'blank-source-unmatched']) {
      assert.equal(model(id), undefined, id);
    }
    const local = h.app.itemMap.get('local');
    assert.equal(local.modelUrl, 'local.glb');
    assert.equal(local.previewUrl, 'local.svg');
    assert.deepEqual(local.provenance, { sourceFile: 'local source' });
  });

  test(`${mode} waits for the complete catalogue, then accepts alternate assets and zero-match backups`, async t => {
    const h = await boot(t, mode);
    assert.equal(h.get('#import-btn').disabled, true);
    assert.equal(h.get('#mobile-import').disabled, true);
    await h.choose(() => assert.fail('read before ready'));
    assert.deepEqual(h.calls, []);
    await h.ready();
    for (const id of ['#import-btn', '#mobile-import', '#audit-import']) assert.equal(h.get(id).disabled, false);
    await h.choose(async () => h.backup({ reviews: { [libraryAsset.id]: incomingReview } }));
    assert.equal(h.stored().reviews[libraryAsset.id].comment, incomingReview.comment);
    assert.deepEqual(h.stored().selected, [asset.id]);
    assert.match(h.toast(), /已合并 1 条有效记录并保存到当前浏览器/);
    const nextFile = deferred();
    const nextImport = h.choose(() => nextFile.promise);
    nextFile.resolve(h.backup({ reviews: { unknown: incomingReview }, selected: ['unknown'] }));
    await nextImport;
    assert.match(h.toast(), /已合并 0 条有效记录/);
    assert(!h.app.selected.has('unknown'));
  });

  test(`${mode} reports incomplete merge saves and retains the merged state for export`, async t => {
    const h = await boot(t, mode, { initialSelection: [] });
    await h.ready();
    h.setStorageError(h.config.reviewKey);
    await h.choose();
    const firstResult = h.toast();
    assert.match(firstResult, /当前页面合并 1 条有效记录.*未能完整保存.*导出备份/);
    assert.equal(h.stored().reviews[asset.id].comment, oldReview.comment);
    assert.deepEqual(h.calls, [h.config.selectionStorageKey]);

    h.get('#mobile-audit').onclick();
    h.setStorageError(h.config.selectionStorageKey);
    await h.choose();
    assert.equal(h.toast(), firstResult);
    const auditResult = h.get('#audit-import-status').textContent;
    assert.match(auditResult, /当前页面合并 1 条有效记录.*未能完整保存.*导出备份/);
    assert.equal(h.stored().reviews[asset.id].comment, incomingReview.comment);
    assert.equal(h.values.get(h.config.selectionStorageKey), JSON.stringify([asset.id]));
    assert.equal(h.get('#storage-warning').hidden, false);

    h.get('#export-all').onclick();
    const exported = JSON.parse(await h.downloads[0].blob.text());
    assert.equal(exported.reviews[asset.id].comment, incomingReview.comment);
    assert.deepEqual(exported.selected, [asset.id]);

    h.setStorageError(undefined);
    await h.choose();
    assert.match(h.get('#audit-import-status').textContent, /已合并 1 条有效记录并保存到当前浏览器/);
    assert.equal(h.values.get(h.config.selectionStorageKey), JSON.stringify([asset.id]));
    assert.equal(h.get('#storage-warning').hidden, true);
  });

  test(`${mode} keeps import disabled after catalogue load failure`, async t => {
    const h = await boot(t, mode);
    await h.failLoad();
    assert.equal(h.get('#import-btn').disabled, true);
    assert.equal(h.get('#mobile-import').disabled, true);
    assert.match(h.get('#load-error').textContent, /failed catalogue/);
    await h.choose(() => assert.fail('read after failed load'));
    assert.deepEqual(h.calls, []);
    assert.doesNotMatch(h.toast(), /已合并/);
  });

  test(`${mode} syncs the open detail when import replaces its review`, async t => {
    const h = await boot(t, mode);
    await h.ready();
    const file = deferred();
    const merging = h.choose(() => file.promise);
    await h.app.openDetail(h.app.itemMap.get(asset.id));
    assert.equal(h.get('#comment').value, oldReview.comment);
    file.resolve(h.backup());
    await merging;
    assert.equal(h.get('#comment').value, incomingReview.comment);
    assert.equal(h.get('#detail-selected').checked, true);
    assert(h.buttons[0].classes.has('active'));
    h.get('#detail-modal').close();
    assert.equal(h.stored().reviews[asset.id].comment, incomingReview.comment);
    assert.equal(h.calls.length, 1);

    await h.app.openDetail(h.app.itemMap.get(asset.id));
    h.edit('Old draft');
    assert.equal(h.commentTimers().length, 1);
    assert.match(h.get('#save-status').textContent, /正在保存/);
    await h.choose();
    assert.equal(h.commentTimers().length, 0);
    assert.equal(h.get('#comment').value, incomingReview.comment);
    assert.doesNotMatch(h.get('#save-status').textContent, /正在保存/);
    h.edit('New draft');
    h.commentTimers()[0].run();
    assert.equal(h.stored().reviews[asset.id].comment, 'New draft');
  });

  test(`${mode} preserves the active draft on a selection-only merge or unrelated review`, async t => {
    const h = await boot(t, mode);
    await h.ready();
    await h.app.openDetail(h.app.itemMap.get(asset.id));
    h.edit('Pending comment');
    await h.choose(async () => h.backup({
      reviews: { [asset.id]: { status: 'invalid' }, [libraryAsset.id]: incomingReview }
    }));
    assert.equal(h.get('#detail-selected').checked, true);
    assert.equal(h.get('#comment').value, 'Pending comment');
    assert.equal(h.commentTimers().length, 1);
    h.commentTimers()[0].run();
    assert.equal(h.stored().reviews[asset.id].comment, 'Pending comment');
    assert.equal(h.stored().reviews[libraryAsset.id].comment, incomingReview.comment);
  });

  test(`${mode} preserves imported line endings and whitespace until the comment changes`, async t => {
    const h = await boot(t, mode);
    await h.ready();
    const imported = {
      status: 'keep', comment: '  First\r\nsecond\rthird  ', updatedAt: '2024-01-01T00:00:00.000Z'
    };
    const visible = '  First\nsecond\nthird  ';
    const item = h.app.itemMap.get(asset.id);
    await h.app.openDetail(item);
    await h.choose(async () => h.backup({ reviews: { [asset.id]: imported } }));
    assert.equal(h.get('#comment').value, visible);
    h.get('#detail-modal').close();
    assert.deepEqual(h.stored().reviews[asset.id], imported);
    assert.equal(h.calls.length, 1);

    await h.app.openDetail(item);
    h.edit(visible + 'extra');
    h.edit(visible);
    h.commentTimers()[0].run();
    assert.deepEqual(h.stored().reviews[asset.id], imported);
    assert.equal(h.calls.length, 1);
    await h.app.openDetail(h.app.itemMap.get(libraryAsset.id));
    assert.equal(h.calls.length, 1);

    await h.app.openDetail(item);
    h.buttons[1].onclick();
    assert.equal(h.stored().reviews[asset.id].comment, imported.comment);
    assert.equal(h.stored().reviews[asset.id].status, 'check');
    const statusUpdatedAt = h.stored().reviews[asset.id].updatedAt;
    h.edit(visible + ' ');
    h.commentTimers()[0].run();
    assert.equal(h.stored().reviews[asset.id].comment, visible + ' ');
    assert.notEqual(h.stored().reviews[asset.id].updatedAt, imported.updatedAt);
    assert(h.stored().reviews[asset.id].updatedAt >= statusUpdatedAt);
    assert.equal(h.stored().reviews[asset.id].status, 'check');
  });
}

test('hosted technical resource modal loads material metadata and preserves download links', async t => {
  const metadataUrl = 'https://fixture.invalid/review/material.json';
  const material = {
    id: 'material', name: 'Material', type: 'material', metadataUrl,
    downloads: [{ kind: 'url', label: 'Source evidence', url: '/review/material-source.json' }]
  };
  const modelAsset = { format: 'glb', name: 'Fallback', preview_sha256: 'a'.repeat(64) };
  const fallback = { id: 'fallback', name: 'Fallback', type: 'mesh', modelAsset, resourceBaseUrl: '/review/models/' };
  const h = await boot(t, 'hosted', {
    catalogAssets: [material, fallback],
    responses: { [metadataUrl]: () => ({ floatParameters: { _Glossiness: 0.5 } }) },
    downloadResource: async (declaration, {resourceBaseUrl}) => {
      assert.equal(declaration, modelAsset);
      assert.equal(resourceBaseUrl, fallback.resourceBaseUrl);
      return { bytes: new Uint8Array([1]), filename: 'Fallback.glb' };
    }
  });
  await h.ready();
  await h.app.openResource(h.app.itemMap.get(material.id));
  const content = h.get('#resource-content');
  const button = () => content.querySelector('[data-verified-model-download]');
  assert(h.get('#resource-modal').open);
  assert.equal(h.get('#resource-title').textContent, material.name);
  assert.match(content.innerHTML, /material\.json/);
  assert.match(content.innerHTML, /material-source\.json/);
  assert.equal(button(), undefined);
  const parameters = content.children.find(section => section.className === 'source-parameters');
  assert.equal(parameters.children[0].textContent, '源浮点参数');
  assert.deepEqual(parameters.children[2].children.map(node => node.textContent), ['_Glossiness', '0.5']);

  h.get('#resource-modal').close();
  await h.app.openResource(h.app.itemMap.get(fallback.id));
  assert(h.get('#resource-modal').open);
  assert.equal(button().textContent, '下载已校验的 Fallback.glb');
  await button().onclick();
  assert.equal(h.downloads[0].name, 'Fallback.glb');
});

test('hosted variant preview and verified download share the active declaration and resource root', async t => {
  const originalAsset = { format: 'glb', name: 'Original' };
  const makeVariant = (id, format, name) => ({
    id, label: id, modelUrl: `/review/${id}/model.${format}`, resourceBaseUrl: `/review/${id}/`,
    modelAsset: { format, name, preview_sha256: id.repeat(64), originalAsset }
  });
  const a = makeVariant('a', 'glb', 'Preview A');
  const b = makeVariant('b', 'gltf', 'Closed B');
  const c = makeVariant('c', 'glb', 'Preview/C.GLB');
  const item = {
    ...asset, modelUrl: '/review/main.glb', resourceBaseUrl: '/review/main/', modelAsset: originalAsset, originalAsset,
    variants: [a, b, c], metadataUrl: '/review/metadata.json',
    downloads: [{ kind: 'url', label: 'Source evidence', url: '/review/source.json' }]
  };
  let pending = deferred();
  const previews = [], requests = [];
  const h = await boot(t, 'hosted', {
    catalogObjects: [item],
    createViewer: async (stage, url, options) => {
      previews.push({ url, modelAsset: options.modelAsset, resourceBaseUrl: options.resourceBaseUrl });
      return { dispose() {} };
    },
    downloadResource: async (declaration, options) => {
      requests.push({ declaration, ...options });
      if (declaration === a.modelAsset) await pending.promise;
      return { bytes: new TextEncoder().encode(declaration.preview_sha256), filename: describeDownload(declaration).filename };
    }
  });
  await h.ready();
  await h.app.openDetail(h.app.itemMap.get(item.id));
  const select = h.get('#resource-variant');
  const container = h.get('#detail-downloads');
  const button = () => container.querySelector('[data-verified-model-download]');
  const activePreview = variant => assert.deepEqual(previews.at(-1), {
    url: variant.modelUrl, modelAsset: variant.modelAsset, resourceBaseUrl: variant.resourceBaseUrl
  });
  const switchTo = variant => {
    select.onchange({ target: { value: variant.id } });
    activePreview(variant);
  };
  const sourceLinks = container.innerHTML;
  assert.match(sourceLinks, /metadata\.json/);
  assert.match(sourceLinks, /source\.json/);
  const partner = new Element();
  container.append(partner);
  h.get('#comment').value = 'Keep this draft';
  h.get('#detail-selected').onchange({ target: { checked: true } });
  assert.equal(select.value, a.id);
  activePreview(a);
  assert.equal(button().textContent, '下载已校验的 Preview A.glb');
  const first = button().onclick();
  assert(button().disabled);
  switchTo(b);
  assert(button().disabled);
  assert.match(button().textContent, /Closed B.*闭合 glTF/);
  await button().onclick();
  assert.equal(requests.length, 1);
  switchTo(c);
  assert.equal(button().textContent, '下载已校验的 Preview_C.glb');
  assert.equal(button().disabled, false);
  await button().onclick();
  switchTo(b);
  const active = button();
  pending.resolve();
  await first;
  assert.equal(button(), active);
  assert(active.disabled);
  assert.deepEqual(requests, [a, c].map(variant => ({
    declaration: variant.modelAsset, resourceBaseUrl: variant.resourceBaseUrl
  })));
  assert.deepEqual(h.downloads.map(download => download.name), ['Preview_C.glb', 'Preview A.glb']);
  assert.deepEqual(await Promise.all(h.downloads.map(download => download.blob.text())), [c.modelAsset.preview_sha256, a.modelAsset.preview_sha256]);
  assert.equal(container.innerHTML, sourceLinks);
  assert(container.children.includes(partner));
  assert.equal(h.get('#comment').value, 'Keep this draft');
  assert(h.app.selected.has(item.id));

  pending = deferred();
  switchTo(a);
  const failed = button().onclick();
  switchTo(c);
  const toast = h.toast();
  pending.reject(Error('Rejected old model'));
  await failed;
  assert.equal(h.toast(), toast);
  assert.equal(button().textContent, '下载已校验的 Preview_C.glb');
  assert.equal(button().disabled, false);
});

test('public detail shows only the active model warnings across compare and view changes', async t => {
  const technical = {
    ...libraryAsset, modelUrl: 'original.glb',
    variants: [
      { id: 'original', label: 'Original', modelUrl: 'original.glb' },
      { id: 'variant', label: 'Variant', modelUrl: 'variant.glb' }
    ]
  };
  const optional = 'Unsupported optional extension: <img src=x onerror=alert(1)>';
  const normal = '法线贴图暂未应用；保留模型源法线';
  const long = 'Unsupported optional extension: ' + 'x'.repeat(500);
  const warningA = [optional, normal];
  const warningB = [normal, 'UV1', long, '点或线拓扑未显示', '形态目标以基础静态几何显示'];
  const view = warnings => ({ warnings, dispose() {} });
  let start = () => view(warningA);
  const h = await boot(t, 'public', {
    catalogAssets: [technical],
    createViewer: (stage, url) => start(stage, url)
  });
  await h.ready();
  const warningPanel = h.get('#model-warnings');
  const extra = h.get('#model-warnings-extra');
  const messages = () => h.get('#model-warnings-list').children.map(entry => entry.textContent);
  const empty = () => {
    assert.equal(warningPanel.hidden, true);
    assert.deepEqual(messages(), []);
    assert.equal(extra.hidden, true);
    assert.equal(extra.textContent, '');
  };
  const openTechnical = () => h.app.openResource(h.app.itemMap.get(technical.id));
  const toggleCompare = () => h.get('#toggle-render-compare').onclick();
  const settle = () => new Promise(setImmediate);

  await openTechnical();
  assert.equal(h.get('#detail-modal').open, true);
  assert.equal(warningPanel.hidden, false);
  assert.deepEqual(messages(), warningA);
  assert(h.get('#model-warnings-list').children.every(entry => entry.innerHTML === undefined));
  assert.match(h.get('#preview-caption').textContent, /拖动旋转/);
  assert.equal(h.get('#animation-status').textContent, '');

  const comparison = deferred();
  const stageB = h.get('#preview-stage-b');
  start = stage => stage === stageB ? comparison.promise : view(warningA);
  toggleCompare();
  empty();
  comparison.resolve(view(warningB));
  await settle();
  assert.deepEqual(messages(), [...warningA, 'UV1', long.slice(0, 239) + '…', '点或线拓扑未显示']);
  assert.equal(extra.hidden, false);
  assert.match(extra.textContent, /1/);
  toggleCompare();
  await settle();
  assert.deepEqual(messages(), warningA);
  assert.equal(extra.hidden, true);

  const variant = deferred();
  let disposed = false;
  start = (stage, url) => {
    assert.equal(url, 'variant.glb');
    return variant.promise;
  };
  h.get('#resource-variant').onchange({ target: { value: 'variant' } });
  empty();
  await h.app.openDetail(h.app.itemMap.get(asset.id));
  variant.resolve({ ...view(['stale warning']), dispose() { disposed = true; } });
  await settle();
  empty();
  assert.equal(disposed, true);

  start = () => { throw Error('failed preview'); };
  await openTechnical();
  empty();
  assert.match(h.get('#preview-caption').textContent, /暂未成功加载/);

  start = () => view(warningA);
  await openTechnical();
  h.get('#detail-modal').close();
  empty();
  await openTechnical();
  assert.deepEqual(messages(), warningA);
  h.dispatch('pagehide');
  empty();
});

test('hosted ignores stale success and failure without clearing the newer input', async t => {
  const h = await boot(t, 'hosted');
  await h.ready();
  const first = deferred(), second = deferred(), third = deferred();
  const earlier = h.choose(() => first.promise, 'first');
  const intermediate = h.choose(() => second.promise, 'second');
  const latest = h.choose(() => third.promise, 'third');
  second.reject(Error('stale error'));
  await intermediate;
  assert.equal(h.toast(), '');
  assert.equal(h.get('#import-file').value, 'third');
  first.resolve(h.backup({ reviews: { [asset.id]: oldReview } }));
  await earlier;
  assert.equal(h.get('#import-file').value, 'third');
  assert.deepEqual(h.calls, []);
  third.resolve(h.backup());
  await latest;
  assert.equal(h.stored().reviews[asset.id].comment, incomingReview.comment);
  assert.equal(h.calls.length, 1);
});

test('hosted invalidates pending imports on a real library round trip, pagehide and project leave', async t => {
  const h = await boot(t, 'hosted');
  await h.ready();
  const switchTo = value => h.get('#dataset-select').onchange({ target: { value } });
  const switchProject = () => {
    h.get('#project-switch').value = 'other';
    h.get('#project-switch').onchange();
  };
  const assertStale = async invalidate => {
    const writeCount = h.calls.length;
    const file = deferred();
    const pending = h.choose(() => file.promise);
    const previousToast = h.toast();
    invalidate();
    assert.equal(h.get('#import-file').value, '');
    file.resolve(h.backup());
    await pending;
    assert.equal(h.calls.length, writeCount);
    assert.equal(h.toast(), previousToast);
  };
  for (const invalidate of [
    () => { switchTo('adapter'); switchTo('verified'); },
    () => { h.dispatch('pagehide'); h.dispatch('pageshow'); }
  ]) await assertStale(invalidate);
  switchTo('adapter');
  const file = deferred();
  const pending = h.choose(() => file.promise);
  switchTo('adapter');
  file.resolve(h.backup({ datasetId: 'adapter' }));
  await pending;
  assert.equal(h.stored().datasetId, 'verified');
  assert.equal(h.stored().reviews[asset.id].comment, incomingReview.comment);
  await assertStale(switchProject);
});

test('hosted enables merge after account draft hydration while the initial shared list is pending', async t => {
  const session = deferred(), list = deferred();
  const h = await boot(t, 'hosted', { shared: true, sharedSession: session.promise, sharedList: list.promise });
  const draftKey = 'asset-review-selection-v1:fixture:reviewer';
  h.values.set(draftKey, JSON.stringify({ ids: [libraryAsset.id], nickname: 'Local draft' }));
  let ready = false;
  const loading = h.ready().then(() => { ready = true; });
  await new Promise(resolve => setImmediate(resolve));
  const controls = ['#import-btn', '#mobile-import', '#audit-import'];
  assert(h.requests.some(([path]) => path === '/api/selection/session'));
  for (const id of controls) assert.equal(h.get(id).disabled, true);
  const card = h.cardCheckbox(), detail = h.get('#detail-selected'), clear = h.get('#clear-selection');
  await h.app.openDetail(h.app.itemMap.get(asset.id));
  for (const control of [card, detail, clear]) assert.equal(control.disabled, true);
  card.checked = detail.checked = true;
  card.onchange({ target: card });
  detail.onchange({ target: detail });
  assert.equal(h.app.selected.size, 0);
  assert.equal(card.checked, false);
  assert.equal(detail.checked, false);
  await h.choose(() => assert.fail('read before account draft hydration'));
  assert.deepEqual(h.calls, []);
  await h.app.openDetail(h.app.itemMap.get(libraryAsset.id));
  assert.equal(detail.checked, false);
  session.resolve({ userId: 'reviewer' });
  await new Promise(resolve => setImmediate(resolve));
  assert(h.requests.some(([path]) => path === '/api/selections'));
  assert.equal(ready, true, 'catalogue initialization must finish without the shared list');
  await loading;
  for (const id of controls) assert.equal(h.get(id).disabled, false);
  for (const control of [h.cardCheckbox(), detail, clear]) assert.equal(control.disabled, false);
  assert.deepEqual([...h.app.selected], [libraryAsset.id]);
  assert.equal(detail.checked, true);
  await h.choose();
  assert.deepEqual(JSON.parse(h.values.get(draftKey)).ids, [libraryAsset.id, asset.id]);

  const partner = h.get('main > header').following;
  await partner.querySelector('#partner-refresh').onclick();
  assert.equal(partner.querySelector('#partner-total').textContent, '(0)');
  list.resolve({ lists: [{ userId: 'reviewer', ids: [], nickname: 'Old list', revision: 1 }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(partner.querySelector('#partner-total').textContent, '(0)');
  assert.deepEqual([...h.app.selected], [libraryAsset.id, asset.id]);
});

test('hosted unlocks local selection after the account session fails', async t => {
  const session = deferred();
  const h = await boot(t, 'hosted', { shared: true, sharedSession: session.promise, initialSelection: [asset.id] });
  const loading = h.ready();
  await new Promise(resolve => setImmediate(resolve));
  const clear = h.get('#clear-selection');
  assert.equal(clear.disabled, true);
  clear.onclick();
  assert.deepEqual([...h.app.selected], [asset.id]);
  session.reject(Error('Unavailable session'));
  await loading;
  assert.equal(clear.disabled, false);
  assert.equal(h.get('#import-btn').disabled, false);
  clear.onclick();
  assert.equal(h.app.selected.size, 0);
  const checkbox = h.cardCheckbox();
  checkbox.checked = true;
  checkbox.onchange({ target: checkbox });
  assert.deepEqual([...h.app.selected], [asset.id]);
  assert.deepEqual(JSON.parse(h.values.get(h.config.selectionStorageKey)), [asset.id]);
  const partner = h.get('main > header').following;
  assert.match(partner.querySelector('#partner-status').textContent, /共享选择暂不可用/);
});

for (const field of ['selection', 'nickname']) {
  test(`hosted publish acknowledges only the submitted draft and protects a later ${field} edit`, async t => {
    const put = deferred(), subsequentList = deferred();
    let mine = { userId: 'reviewer', nickname: 'Original', ids: [asset.id], revision: 2 };
    let listReads = 0;
    const h = await boot(t, 'hosted', { shared: true, sharedSession: { userId: 'reviewer', mine }, responses: {
      '/api/selections': () => ++listReads === 2 ? subsequentList.promise : { lists: [mine] },
      '/api/selections/me': () => put.promise
    } });
    await h.ready();
    const control = id => h.get('main > header').following.querySelector('#partner-' + id);
    const publishing = control('publish').onclick();
    const request = h.requests.find(([path]) => path === '/api/selections/me');
    assert.equal(request[1], 'PUT');
    assert.deepEqual(JSON.parse(request[2]), { nickname: 'Original', ids: [asset.id], revision: 2 });
    if (field === 'selection') {
      await h.choose(async () => h.backup({ selected: [libraryAsset.id] }));
    } else {
      control('nickname').value = 'Later edit';
      control('nickname').oninput();
    }
    mine = { ...mine, revision: 3 };
    put.resolve({ mine });
    await publishing;
    const draft = JSON.parse(h.values.get('asset-review-selection-v1:fixture:reviewer'));
    assert.equal(draft.baseRevision, 3);
    assert.equal(draft.nickname, field === 'nickname' ? 'Later edit' : mine.nickname);
    assert.deepEqual(draft.ids, field === 'selection' ? [asset.id, libraryAsset.id] : mine.ids);
    assert.match(control('status').textContent, /已发布提交时的 1 项.*仍未发布/);
    h.acceptConfirmation(false);
    await control('load').onclick();
    assert.equal(h.confirmations.length, 1);
    assert.deepEqual([...h.app.selected], draft.ids);
    assert.equal(control('nickname').value, draft.nickname);
    h.acceptConfirmation(true);
    await control('load').onclick();
    assert.equal(h.confirmations.length, 2);
    assert.deepEqual([...h.app.selected], mine.ids);
    assert.equal(control('nickname').value, mine.nickname);
    subsequentList.resolve({ lists: [mine] });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(control('status').textContent, /已载入本人服务器版本/);
  });
}

for (const mode of Object.keys(reviewer)) {
  test(`${mode} keeps rendering, editing, changing profiles and exporting when the Storage getter throws`, async t => {
    const h = await boot(t, mode, { storageError: 'getter' });
    await h.ready();
    assert.equal(h.get('#storage-warning').hidden, false);
    const item = h.app.itemMap.get(asset.id);
    await h.app.openDetail(item);
    const detail = h.get('#detail-selected');
    detail.checked = true;
    detail.onchange({ target: detail });
    h.edit('In-memory edit');
    h.commentTimers()[0].run();
    const profile = h.get('#default-profile');
    profile.value = h.config.defaultProfile;
    profile.onchange({ target: profile });
    assert.match(h.get('#default-profile-note').textContent, /无法保存/);
    assert.match(h.get('#save-status').textContent, /保存失败/);
    assert.deepEqual(h.calls, []);
    h.get('#export-all').onclick();
    const exported = JSON.parse(await h.downloads[0].blob.text());
    assert.equal(exported.reviews[asset.id].comment, 'In-memory edit');
    assert.deepEqual(exported.selected, [asset.id]);
  });
}

test('public exact restore retains memory and prior storage when Storage access fails after confirmation', async t => {
  const h = await boot(t, 'public');
  await h.ready();
  await h.app.openDetail(h.app.itemMap.get(asset.id));
  h.edit('Pending edit');
  for (const error of ['getter', 'method']) {
    const input = h.get('#restore-file');
    input.files = [{ size: 100, text: async () => h.backup({ scope: 'full-catalogue' }) }];
    h.setStorageError(error);
    await input.onchange({ target: input });
    assert.match(h.toast(), /浏览器保存失败，未替换当前审阅与选择/);
    assert.equal(h.app.reviews[asset.id].comment, oldReview.comment);
    assert.equal(h.stored().reviews[asset.id].comment, oldReview.comment);
    assert.equal(h.get('#comment').value, 'Pending edit');
    assert.equal(h.commentTimers().length, 1);
    assert.equal(h.app.selected.size, 0);
    assert.deepEqual(h.calls, []);
  }
  assert.equal(h.confirmations.length, 2);
});

test('hosted keeps account storage warnings separate from acknowledged server success', async t => {
  const mine = { userId: 'reviewer', nickname: 'Account', ids: [asset.id], revision: 1 };
  let listReads = 0;
  const h = await boot(t, 'hosted', { shared: true, sharedSession: { userId: 'reviewer', mine }, storageError: 'getter', responses: {
    '/api/selections': () => {
      if (++listReads > 1) throw Error('Post-publish refresh failed');
      return { lists: [mine] };
    },
    '/api/selections/me': body => ({ mine: { ...mine, ...JSON.parse(body), revision: 2 } })
  } });
  await h.ready();
  const control = id => h.get('main > header').following.querySelector('#partner-' + id);
  const warning = control('status').following;
  assert.equal(warning.hidden, false);
  assert.deepEqual([...h.app.selected], [asset.id]);
  control('nickname').value = 'Changed name';
  control('nickname').oninput();
  assert.match(control('status').textContent, /尚未发布/);
  assert.equal(warning.hidden, false);
  await control('publish').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(control('status').textContent, /已发布提交时的 1 项.*草稿未能同步确认/);
  assert.match(control('lists').textContent, /Post-publish refresh failed/);
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /无法读取或保存账号草稿/);
});

test('hosted merge reflects account draft storage separately from a review-only merge', async t => {
  const h = await boot(t, 'hosted', { shared: true });
  await h.ready();
  const draftKey = 'asset-review-selection-v1:fixture:reviewer';
  h.setStorageError(draftKey);
  await h.choose(async () => h.backup({ selected: [] }));
  assert.match(h.toast(), /已合并 1 条有效记录并保存到当前浏览器/);
  await h.choose();
  assert.match(h.toast(), /未能完整保存.*新增选择尚未发布/);
  assert.equal(h.values.has(draftKey), false);
  assert(h.app.selected.has(asset.id));
  await h.choose();
  assert.match(h.toast(), /未能完整保存/);

  h.setStorageError(undefined);
  await h.choose();
  assert.match(h.toast(), /保存到当前浏览器/);
  assert.deepEqual(JSON.parse(h.values.get(draftKey)).ids, [asset.id]);
  assert(h.requests.every(([, method]) => method === 'GET'));
});

test('hosted merge reports incomplete saving if a shared selection has no authenticated draft', async t => {
  const h = await boot(t, 'hosted', { shared: true, sharedSession: Promise.resolve(null) });
  await h.ready();
  await h.choose();
  assert.match(h.toast(), /未能完整保存.*新增选择尚未发布/);
  assert.equal(h.stored().reviews[asset.id].comment, incomingReview.comment);
  assert.deepEqual(h.stored().selected, []);
  assert(h.app.selected.has(asset.id));
});

test('hosted server manifest includes resolvable roots outside the UI and refuses incomplete exports', async t => {
  const partnerList = { userId: 'partner', nickname: 'Partner', ids: [asset.id], revision: 1 };
  const root = 'not-in-catalogue', dependency = 'nested-file', shard = '/delivery-shards/ab.json';
  let roots = [asset.id, root, root];
  let index = { assets: { [asset.id]: { id: asset.id, files: [] }, [root]: shard, [dependency]: shard } };
  const records = { [root]: { id: root, files: [], dependencyIds: [dependency] }, [dependency]: { id: dependency, files: [] } };
  const h = await boot(t, 'hosted', { shared: true, responses: {
    '/api/selections': () => ({ lists: [partnerList] }),
    '/api/selections/manifest?user=partner': () => ({ selection: { ...partnerList, ids: roots } }),
    '/delivery-index.json': () => index,
    [shard]: () => records
  } });
  await h.ready();
  await new Promise(resolve => setImmediate(resolve));
  const panel = h.get('main > header').following;
  const action = panel.querySelector('#partner-lists').children[0].querySelector('[data-manifest]');
  const status = panel.querySelector('#partner-status');
  await action.onclick();
  const manifest = JSON.parse(await h.downloads[0].blob.text());
  assert.deepEqual(manifest.selection.ids, [asset.id, root]);
  assert.deepEqual(new Map(manifest.assets.map(entry => [entry.id, entry.selected])), new Map([
    [root, true], [dependency, false], [asset.id, true]
  ]));
  assert.equal(h.requests.filter(([path]) => path === shard).length, 1);
  assert.match(status.textContent, /已导出.*完整/);

  delete index.assets[dependency];
  await action.onclick();
  assert.equal(h.downloads.length, 1);
  assert.match(status.textContent, /缺少资源 nested-file.*由 not-in-catalogue 引用/);
  assert.doesNotMatch(status.textContent, /已导出/);
  roots = ['missing-root'];
  await action.onclick();
  assert.equal(h.downloads.length, 1);
  assert.match(status.textContent, /缺少资源 missing-root/);
  roots = [];
  index = { assets: {} };
  await action.onclick();
  const empty = JSON.parse(await h.downloads[1].blob.text());
  assert.deepEqual(empty.selection.ids, []);
  assert.deepEqual(empty.assets, []);
});

test('manifest resolver rejects inherited pointers and inherited or missing shard records', async () => {
  const asset = { id: 'root', files: [] }, shard = '/delivery-shards/ab.json';
  await assert.rejects(
    resolveSelectionAssets({ assets: Object.create({ root: asset }) }, ['root'], () => assert.fail('no own pointer')),
    /交付索引缺少资源 root/
  );
  for (const records of [{}, Object.create({ root: asset })]) {
    await assert.rejects(
      resolveSelectionAssets({ assets: { root: shard } }, ['root'], async () => records),
      /交付分片缺少资源 root/
    );
  }
});


test('public full review snapshot round-trips exact and merge without report index or sidecars', async t => {
  const h = await boot(t, 'public');
  h.get('#export-snapshot').onclick(); assert.equal(h.downloads.length, 0);
  await h.ready();
  h.get('#export-snapshot').onclick();
  const text = await h.downloads[0].blob.text(), payload = JSON.parse(text);
  assert.equal(payload.scope, 'full-catalogue');
  assert.equal(payload.reviews.one.comment, oldReview.comment);
  assert(!('assets' in payload)); assert(!('animationPreviewRecords' in payload));
  const {createWorkbench} = await import('../apps/reviewer/shared/workbench.mjs');
  for (const exact of [false, true]) assert.equal(createWorkbench(h.config).parseReviewImport(text, new Set(['one']), {exact}).reviews.one.comment, oldReview.comment);
  h.get('#export-all').onclick();
  const report = JSON.parse(await h.downloads[1].blob.text());
  assert.equal(report.assets.length, 2); assert.equal(report.assetMetadataOnly, true);
});

test('public oversized report warns before download; oversized UTF-8 state refuses backup success', async t => {
  const h = await boot(t, 'public'); await h.ready();
  const stored = h.stored();
  stored.reviews.one.comment = '中文'.repeat(100);
  h.values.set(h.config.reviewKey, JSON.stringify(stored));
  const {reviewStateSnapshot, reviewExportBlob, reviewSnapshotBlob} = await import('../apps/reviewer/shared/review-export.mjs');
  const payload = reviewStateSnapshot(h.config, stored.reviews, h.app.selected);
  const text = JSON.stringify(payload), bytes = reviewSnapshotBlob(payload, h.config).blob.size;
  assert(bytes > text.length);
  h.config.importLimitMiB = (text.length + 1) / 1024 / 1024;
  assert.equal(reviewSnapshotBlob(payload, h.config).restorable, false);
  assert.equal(reviewExportBlob(payload, h.config).restorable, false);
  h.get('#export-snapshot').onclick();
  assert.equal(h.downloads.length, 0); assert.match(h.alerts[0], /未导出可恢复备份/);
  h.get('#export-all').onclick();
  assert.equal(h.downloads.length, 1); assert.match(h.alerts[1], /不能用于恢复/);
});

for (const mode of Object.keys(reviewer)) {
  test(`${mode} rebases stale editor fields and selections without resaving untouched text`, async t => {
    const h = await boot(t, mode, { catalogObjects: [asset, {id: 'two', name: 'Second'}] });
    await h.ready();
    await h.app.openDetail(h.app.itemMap.get(asset.id));
    const otherTab = h.stored();
    otherTab.reviews[asset.id] = {status: 'keep', comment: 'Other tab comment'};
    otherTab.reviews.two = {status: 'skip', comment: 'Other record'};
    otherTab.reviews.unavailable = {status: 'check', comment: 'Preserved outside UI'};
    otherTab.selected = ['two', 'unavailable'];
    h.values.set(h.config.reviewKey, JSON.stringify(otherTab));
    h.buttons[1].onclick();
    assert.equal(h.stored().reviews[asset.id].comment, 'Other tab comment');
    assert.equal(h.stored().reviews[asset.id].status, 'check');
    assert.deepEqual(h.stored().reviews.two, otherTab.reviews.two);
    h.get('#detail-selected').onchange({target: {checked: true}});
    assert.deepEqual(new Set(h.stored().selected), new Set(['one', 'two', 'unavailable']));
    assert.equal(h.app.selected.has('unavailable'), false);
    h.get('#detail-modal').close();
    assert.equal(h.stored().reviews[asset.id].comment, 'Other tab comment');
    assert.deepEqual(h.stored().reviews.unavailable, otherTab.reviews.unavailable);
    await h.app.openDetail(h.app.itemMap.get(asset.id));
    h.edit('Trailing text');
    h.dispatch('pagehide');
    assert.equal(h.stored().reviews[asset.id].comment, 'Trailing text');
    assert.equal(h.stored().reviews[asset.id].status, 'check');
  });

  test(`${mode} retries only failed key fragments and preserves unreadable bytes`, async () => {
    const {createReviewWriter, loadReviewState} = await import(new URL('shared/selection-state.mjs', reviewer[mode]));
    const config = {reviewKey: 'review', selectionStorageKey: 'selection', sharedSelections: false};
    const values = new Map([['review', JSON.stringify({version: 1, reviews: {}, selected: []})], ['selection', '[]']]);
    let failedKey = 'selection';
    const storage = {getItem: key => values.get(key), setItem: (key, value) => {
      if (key === failedKey) throw Error('quota');
      values.set(key, value);
    }};
    const a = createReviewWriter(storage, config), b = createReviewWriter(storage, config);
    let state = loadReviewState(storage, config);
    state = a.save({reviews: {one: incomingReview}, selection: {add: ['one']}}, state);
    assert.equal(state.ok, false);
    failedKey = undefined;
    b.save({patch: {id: 'one', comment: 'Newer tab'}}, loadReviewState(storage, config));
    state = a.save({patch: {id: 'two', status: 'skip'}}, state);
    assert.equal(state.ok, true);
    assert.equal(JSON.parse(values.get('review')).reviews.one.comment, 'Newer tab');
    assert.deepEqual(JSON.parse(values.get('selection')), ['one']);

    values.set('review', '{broken');
    state = a.save({patch: {id: 'one', comment: 'Recoverable'}, selection: {add: ['two']}}, state);
    assert.equal(state.ok, false);
    assert.equal(state.reviews.one.comment, 'Recoverable');
    assert.equal(values.get('review'), '{broken');
    assert.deepEqual(JSON.parse(values.get('selection')), ['one', 'two']);
    values.set('review', JSON.stringify({version: 1, reviews: {}, selected: []}));
    values.set('selection', '{broken');
    state = a.save({patch: {id: 'two', status: 'keep'}}, state);
    assert.equal(state.ok, false);
    assert.equal(JSON.parse(values.get('review')).reviews.one.comment, 'Recoverable');
    assert.equal(JSON.parse(values.get('review')).reviews.two.status, 'keep');
    assert.equal(values.get('selection'), '{broken');
  });
}

test('hosted shared draft stays authoritative with an independent selection key', async t => {
  const h = await boot(t, 'hosted', {shared: true, initialSelection: [asset.id],
    sharedSession: Promise.resolve({userId: 'reviewer', mine: {ids: [libraryAsset.id], nickname: 'Mine', revision: 1}})});
  await h.ready();
  assert.deepEqual([...h.app.selected], [libraryAsset.id]);
  await h.app.openDetail(h.app.itemMap.get(asset.id));
  h.buttons[1].onclick();
  assert.deepEqual([...h.app.selected], [libraryAsset.id]);
  h.get('#detail-selected').onchange({target: {checked: true}});
  assert.deepEqual(new Set(h.app.selected), new Set([libraryAsset.id, asset.id]));
});

for (const mode of Object.keys(reviewer)) {
  test(`${mode} clear and import apply to latest state; failed reviews do not replay successful selections`, async () => {
    const {createReviewWriter, loadReviewState} = await import(new URL('shared/selection-state.mjs', reviewer[mode]));
    for (const split of [false, true]) {
      const config = {reviewKey: 'review', sharedSelections: false, ...(split ? {selectionStorageKey: 'selection'} : {})};
      const values = new Map([['review', JSON.stringify({version: 1, reviews: {one: oldReview}, selected: ['one']})], ['selection', '["one"]']]);
      let failedKey;
      const storage = {getItem: key => values.get(key), setItem: (key, value) => {
        if (key === failedKey) throw Error('quota');
        values.set(key, value);
      }};
      const a = createReviewWriter(storage, config), b = createReviewWriter(storage, config);
      let stale = loadReviewState(storage, config);
      b.save({patch: {id: 'two', comment: 'other'}, selection: {add: ['two']}}, stale);
      stale = a.save({reviews: {one: incomingReview}, selection: {add: ['three']}}, stale);
      assert.equal(loadReviewState(storage, config).reviews.two.comment, 'other');
      assert.deepEqual(new Set(loadReviewState(storage, config).selected), new Set(['one', 'two', 'three']));
      stale = a.save({selection: {remove: ['one']}}, stale);
      assert.deepEqual(loadReviewState(storage, config).selected, ['two', 'three']);
      b.save({selection: {add: ['four']}}, stale);
      stale = a.save({selection: {clear: true}}, stale);
      assert.deepEqual(loadReviewState(storage, config).selected, []);
      assert.equal(loadReviewState(storage, config).reviews.two.comment, 'other');
      if (!split) continue;
      failedKey = 'review';
      stale = a.save({reviews: {one: incomingReview}, selection: {add: ['one']}}, stale);
      failedKey = undefined;
      b.save({selection: {remove: ['one']}}, loadReviewState(storage, config));
      stale = a.save({patch: {id: 'two', status: 'keep'}}, stale);
      assert.equal(stale.ok, true);
      assert.deepEqual(loadReviewState(storage, config).selected, []);
    }
  });
}

test('hosted intent saves retain legacy Entity adapter reviews while upgrading stable identity', async () => {
  const {createReviewWriter, loadReviewState} = await import('../reference/hosted/review-frontend/shared/selection-state.mjs');
  const config = {reviewKey: 'review', dataKind: 'entity', projectId: 'entity', datasetId: 'verified', sharedSelections: true};
  let bytes = JSON.stringify({version: 1, projectId: 'entity', datasetId: 'adapter', reviews: {one: oldReview}, selected: ['legacy']});
  const storage = {getItem: () => bytes, setItem: (key, value) => {bytes = value;}};
  const writer = createReviewWriter(storage, config);
  const state = writer.save({patch: {id: 'two', comment: 'new'}}, loadReviewState(storage, config));
  assert.equal(state.ok, true);
  assert.equal(JSON.parse(bytes).datasetId, 'verified');
  assert.deepEqual(JSON.parse(bytes).reviews.one, oldReview);
  assert.deepEqual(JSON.parse(bytes).selected, ['legacy']);
  bytes = JSON.stringify({version: 1, projectId: 'other', datasetId: 'adapter', reviews: {}});
  const wrongIdentity = bytes;
  assert.equal(writer.save({patch: {id: 'two', comment: 'memory'}}, state).ok, false);
  assert.equal(bytes, wrongIdentity);
});

test('hosted shared account tabs rebase checkbox, remove, import and clear intents through real controllers', async t => {
  const storageValues = new Map();
  const options = {shared: true, storageValues, catalogObjects: [asset, {...libraryAsset, name: 'Second object'}]};
  const a = await boot(t, 'hosted', options);
  await a.ready();
  const b = await boot(t, 'hosted', options);
  await b.ready();
  const key = 'asset-review-selection-v1:fixture:reviewer';
  const ids = () => JSON.parse(storageValues.get(key)).ids;
  const select = async (tab, id, checked) => {
    tab.activate();
    await tab.app.openDetail(tab.app.itemMap.get(id));
    tab.get('#detail-selected').onchange({target: {checked}});
  };
  await select(a, asset.id, true);
  await select(b, libraryAsset.id, true);
  assert.deepEqual(new Set(ids()), new Set([asset.id, libraryAsset.id]));
  assert.deepEqual(new Set(b.app.selected), new Set(ids()));
  assert.equal(b.get('#detail-selected').checked, true);
  const c = await boot(t, 'hosted', options);
  await c.ready();
  assert.deepEqual(new Set(c.app.selected), new Set([asset.id, libraryAsset.id]));

  await select(a, asset.id, false);
  assert.deepEqual(ids(), [libraryAsset.id]);
  b.activate();
  await b.choose(async () => b.backup({selected: [asset.id], reviews: {}}));
  assert.deepEqual(new Set(ids()), new Set([asset.id, libraryAsset.id]));
  a.activate();
  assert.equal(a.get('#selection-bar').hidden, false);
  a.get('#clear-selection').onclick();
  assert.deepEqual(ids(), []);

  b.activate();
  const nickname = b.get('main > header').following.querySelector('#partner-nickname');
  nickname.value = 'Fresh name';
  nickname.oninput();
  assert.deepEqual(ids(), [], 'nickname must not resurrect stale selections');
  assert.equal(JSON.parse(storageValues.get(key)).nickname, 'Fresh name');
  a.activate();
  const bytes = storageValues.get(key);
  a.buttons[1].onclick();
  assert.equal(storageValues.get(key), bytes, 'review-only edit must not touch account draft');
  await select(a, asset.id, true);
  assert.equal(JSON.parse(storageValues.get(key)).nickname, 'Fresh name');
});

test('hosted account draft failures retain explicit intents without replaying acknowledged changes', async t => {
  const h = await boot(t, 'hosted', {shared: true});
  await h.ready();
  const key = 'asset-review-selection-v1:fixture:reviewer';
  const panel = h.get('main > header').following;
  const warning = panel.querySelector('#partner-status').following;
  h.values.set(key, '{broken');
  await h.choose();
  assert.match(h.toast(), /未能完整保存/);
  assert.equal(h.values.get(key), '{broken');
  assert.equal(warning.hidden, false);
  assert(h.app.selected.has(asset.id));
  h.values.set(key, JSON.stringify({ids: [libraryAsset.id], nickname: 'Other tab', baseRevision: 4}));
  await h.choose();
  assert.match(h.toast(), /已合并.*保存到当前浏览器/);
  assert.deepEqual(new Set(JSON.parse(h.values.get(key)).ids), new Set([asset.id, libraryAsset.id]));
  assert.equal(JSON.parse(h.values.get(key)).baseRevision, 4);
  assert.equal(warning.hidden, true);

  // Once the account key succeeds, later review-key recovery must not replay it.
  h.setStorageError(h.config.reviewKey);
  await h.choose();
  h.values.set(key, JSON.stringify({ids: [], nickname: 'Other tab', baseRevision: 4}));
  h.setStorageError(undefined);
  await h.app.openDetail(h.app.itemMap.get(asset.id));
  h.buttons[1].onclick();
  assert.deepEqual(JSON.parse(h.values.get(key)).ids, []);
});

test('hosted failed explicit server load keeps its replacement intent for the next draft save', async t => {
  const mine = {userId: 'reviewer', ids: [libraryAsset.id], nickname: 'Server name', revision: 7};
  const h = await boot(t, 'hosted', {shared: true, responses: {'/api/selections': () => ({lists: [mine]})}});
  await h.ready();
  await new Promise(resolve => setImmediate(resolve));
  const key = 'asset-review-selection-v1:fixture:reviewer';
  h.values.set(key, JSON.stringify({ids: [asset.id], nickname: 'Old persisted', baseRevision: 1}));
  h.setStorageError(key);
  const panel = h.get('main > header').following;
  await panel.querySelector('#partner-load').onclick();
  assert.deepEqual([...h.app.selected], [libraryAsset.id]);
  assert.equal(panel.querySelector('#partner-status').following.hidden, false);
  h.setStorageError(undefined);
  const nickname = panel.querySelector('#partner-nickname');
  nickname.value = 'After load';
  nickname.oninput();
  const saved = JSON.parse(h.values.get(key));
  assert.deepEqual(saved.ids, [libraryAsset.id]);
  assert.equal(saved.nickname, 'After load');
  assert.equal(saved.baseRevision, 7);
});

for (const timing of ['before publish', 'during PUT']) {
  test(`hosted publish acknowledgement preserves another tab draft edited ${timing}`, async t => {
    const storageValues = new Map(), put = deferred();
    let mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Original', revision: 2};
    const options = {shared: true, storageValues, sharedSession: {userId: 'reviewer', mine},
      catalogObjects: [asset, {...libraryAsset, name: 'Other object'}], responses: {
        '/api/selections': () => ({lists: [mine]}), '/api/selections/me': () => put.promise
      }};
    const a = await boot(t, 'hosted', options);
    await a.ready();
    const b = await boot(t, 'hosted', options);
    await b.ready();
    const control = (tab, id) => tab.get('main > header').following.querySelector('#partner-' + id);
    const editB = async () => {
      b.activate();
      await b.app.openDetail(b.app.itemMap.get(libraryAsset.id));
      b.get('#detail-selected').onchange({target: {checked: true}});
      control(b, 'nickname').value = 'Other tab name';
      control(b, 'nickname').oninput();
    };
    if (timing === 'before publish') await editB();
    a.activate();
    const publishing = control(a, 'publish').onclick();
    const request = a.requests.find(([path]) => path === '/api/selections/me');
    assert.deepEqual(JSON.parse(request[2]), {nickname: 'Original', ids: [asset.id], revision: 2});
    if (timing === 'during PUT') await editB();
    a.activate();
    mine = {...mine, revision: 3};
    put.resolve({mine});
    await publishing;
    const saved = JSON.parse(storageValues.get('asset-review-selection-v1:fixture:reviewer'));
    assert.deepEqual(new Set(saved.ids), new Set([asset.id, libraryAsset.id]));
    assert.equal(saved.nickname, 'Other tab name');
    assert.equal(saved.baseRevision, 3);
    assert.deepEqual(new Set(a.app.selected), new Set(saved.ids));
    assert.equal(control(a, 'nickname').value, 'Other tab name');
    assert.match(control(a, 'status').textContent, /其他草稿改动仍未发布/);
    a.acceptConfirmation(false);
    await control(a, 'load').onclick();
    assert.equal(a.confirmations.length, 1);
    assert.deepEqual(new Set(a.app.selected), new Set(saved.ids));
    assert.equal(a.requests.filter(([path]) => path === '/api/selections/me').length, 1);
    const c = await boot(t, 'hosted', options);
    await c.ready();
    assert.deepEqual(new Set(c.app.selected), new Set(saved.ids));
  });
}

test('hosted publish acknowledgement merges its unsaved edits with another tab draft', async t => {
  const storageValues = new Map(), put = deferred();
  const mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Original', revision: 2};
  const third = {id: 'third', name: 'Third object'};
  const options = {shared: true, storageValues, sharedSession: {userId: 'reviewer', mine},
    catalogObjects: [asset, {...libraryAsset, name: 'Other object'}, third],
    responses: {'/api/selections/me': () => put.promise}};
  const a = await boot(t, 'hosted', options);
  await a.ready();
  const b = await boot(t, 'hosted', options);
  await b.ready();
  const key = 'asset-review-selection-v1:fixture:reviewer';
  a.activate();
  const control = id => a.get('main > header').following.querySelector('#partner-' + id);
  const publishing = control('publish').onclick();
  a.setStorageError(key);
  await a.app.openDetail(a.app.itemMap.get(third.id));
  a.get('#detail-selected').onchange({target: {checked: true}});
  control('nickname').value = 'Unsaved own name';
  control('nickname').oninput();
  b.activate();
  await b.app.openDetail(b.app.itemMap.get(libraryAsset.id));
  b.get('#detail-selected').onchange({target: {checked: true}});
  a.activate();
  a.setStorageError(undefined);
  put.resolve({mine: {...mine, revision: 3}});
  await publishing;
  const saved = JSON.parse(storageValues.get(key));
  assert.deepEqual(new Set(saved.ids), new Set([asset.id, libraryAsset.id, third.id]));
  assert.equal(saved.nickname, 'Unsaved own name');
  assert.equal(saved.baseRevision, 3);
  assert.deepEqual(JSON.parse(a.requests.find(([path]) => path === '/api/selections/me')[2]),
    {nickname: 'Original', ids: [asset.id], revision: 2});
});

for (const stored of [undefined, '{broken']) {
  test(`hosted publish acknowledgement handles ${stored === undefined ? 'missing' : 'corrupt'} account draft truthfully`, async t => {
    const put = deferred(), mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Original', revision: 2};
    const h = await boot(t, 'hosted', {shared: true, sharedSession: {userId: 'reviewer', mine},
      responses: {'/api/selections/me': () => put.promise}});
    await h.ready();
    const key = 'asset-review-selection-v1:fixture:reviewer';
    const control = id => h.get('main > header').following.querySelector('#partner-' + id);
    const publishing = control('publish').onclick();
    if (stored !== undefined) h.values.set(key, stored);
    put.resolve({mine: {...mine, revision: 3}});
    await publishing;
    if (stored === undefined) {
      assert.equal(JSON.parse(h.values.get(key)).baseRevision, 3);
      assert.deepEqual(JSON.parse(h.values.get(key)).ids, [asset.id]);
      assert.equal(control('status').following.hidden, true);
    } else {
      assert.equal(h.values.get(key), stored);
      assert.match(control('status').textContent, /已发布提交时的 1 项.*草稿未能同步确认/);
      assert.equal(control('status').following.hidden, false);
      h.values.set(key, JSON.stringify({ids: [libraryAsset.id], nickname: 'Recovered draft', baseRevision: 2}));
      control('nickname').value = 'Retry name';
      control('nickname').oninput();
      assert.deepEqual(JSON.parse(h.values.get(key)).ids, [libraryAsset.id]);
      assert.equal(JSON.parse(h.values.get(key)).baseRevision, 3);
    }
  });
}

test('hosted stale clean tab confirms before replacing another tab unpublished draft', async t => {
  const storageValues = new Map();
  const mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Server name', revision: 2};
  const options = {shared: true, storageValues, sharedSession: {userId: 'reviewer', mine},
    catalogObjects: [asset, {...libraryAsset, name: 'Other object'}],
    responses: {'/api/selections': () => ({lists: [mine]})}};
  const a = await boot(t, 'hosted', options);
  await a.ready();
  const b = await boot(t, 'hosted', options);
  await b.ready();
  await b.app.openDetail(b.app.itemMap.get(libraryAsset.id));
  b.get('#detail-selected').onchange({target: {checked: true}});
  const control = (tab, id) => tab.get('main > header').following.querySelector('#partner-' + id);
  control(b, 'nickname').value = 'Unpublished B';
  control(b, 'nickname').oninput();
  const key = 'asset-review-selection-v1:fixture:reviewer', original = storageValues.get(key);
  a.activate();
  a.acceptConfirmation(false);
  await control(a, 'load').onclick();
  assert.equal(a.confirmations.length, 1);
  assert.equal(storageValues.get(key), original);
  assert.deepEqual([...a.app.selected], [asset.id]);
  assert.equal(control(a, 'nickname').value, 'Server name');
  a.acceptConfirmation(true);
  await control(a, 'load').onclick();
  assert.equal(a.confirmations.length, 2);
  assert.deepEqual(JSON.parse(storageValues.get(key)).ids, [asset.id]);
  assert.equal(JSON.parse(storageValues.get(key)).nickname, 'Server name');
});

test('hosted explicit load warns on unreadable draft and decline preserves bytes and UI', async t => {
  const mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Server', revision: 2};
  const h = await boot(t, 'hosted', {shared: true, sharedSession: {userId: 'reviewer', mine},
    responses: {'/api/selections': () => ({lists: [mine]})}});
  await h.ready();
  const key = 'asset-review-selection-v1:fixture:reviewer';
  h.values.set(key, '{broken');
  const control = id => h.get('main > header').following.querySelector('#partner-' + id);
  h.acceptConfirmation(false);
  await control('load').onclick();
  assert.match(h.confirmations[0], /无法读取当前浏览器草稿/);
  assert.equal(h.values.get(key), '{broken');
  assert.deepEqual([...h.app.selected], [asset.id]);
  assert.equal(control('nickname').value, 'Server');
  assert.equal(control('status').following.hidden, false);
  h.acceptConfirmation(true);
  await control('load').onclick();
  assert.deepEqual(JSON.parse(h.values.get(key)).ids, [asset.id]);
  assert.equal(control('status').following.hidden, true);
});

test('hosted retry of failed revision acknowledgement cannot downgrade another tab newer publication', async t => {
  const storageValues = new Map(), key = 'asset-review-selection-v1:fixture:reviewer';
  let mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Server', revision: 2};
  storageValues.set(key, JSON.stringify({ids: mine.ids, nickname: mine.nickname, baseRevision: 2}));
  const options = {shared: true, storageValues, sharedSession: {userId: 'reviewer', mine}, responses: {
    '/api/selections': () => ({lists: [mine]}),
    '/api/selections/me': body => {
      const submitted = JSON.parse(body);
      assert.equal(submitted.revision, mine.revision);
      mine = {...mine, ids: submitted.ids, nickname: submitted.nickname, revision: mine.revision + 1};
      return {mine};
    }
  }};
  const a = await boot(t, 'hosted', options);
  await a.ready();
  const b = await boot(t, 'hosted', options);
  await b.ready();
  const control = (tab, id) => tab.get('main > header').following.querySelector('#partner-' + id);
  a.activate();
  a.setStorageError(key);
  await control(a, 'publish').onclick();
  assert.equal(mine.revision, 3);
  assert.equal(JSON.parse(storageValues.get(key)).baseRevision, 2);
  b.activate();
  await control(b, 'load').onclick();
  await control(b, 'publish').onclick();
  assert.equal(JSON.parse(storageValues.get(key)).baseRevision, 4);
  a.activate();
  a.setStorageError(undefined);
  control(a, 'nickname').value = 'Retry after B';
  control(a, 'nickname').oninput();
  assert.equal(JSON.parse(storageValues.get(key)).baseRevision, 4);
  await control(a, 'publish').onclick();
  const submissions = a.requests.filter(([path]) => path === '/api/selections/me');
  assert.equal(JSON.parse(submissions.at(-1)[2]).revision, 4);
});

test('hosted draft with no server version retains revision zero', async t => {
  const h = await boot(t, 'hosted', {shared: true});
  await h.ready();
  const panel = h.get('main > header').following;
  panel.querySelector('#partner-nickname').value = 'First draft';
  panel.querySelector('#partner-nickname').oninput();
  assert.equal(JSON.parse(h.values.get('asset-review-selection-v1:fixture:reviewer')).baseRevision, 0);
});

test('hosted ordinary shared card toggles retain grid nodes but remote changes reconcile them', async t => {
  const h = await boot(t, 'hosted', {shared: true, catalogObjects: [asset, {...libraryAsset, name: 'Other object'}]});
  await h.ready();
  const checkbox = h.cardCheckbox();
  for (const checked of [true, false, true]) {
    checkbox.checked = checked;
    checkbox.onchange({target: checkbox});
    assert.strictEqual(h.cardCheckbox(), checkbox, 'ordinary toggle must retain the focused checkbox and grid');
    assert.equal(h.app.selected.has(asset.id), checked);
  }
  const key = 'asset-review-selection-v1:fixture:reviewer';
  const latest = JSON.parse(h.values.get(key));
  latest.ids.push(libraryAsset.id);
  h.values.set(key, JSON.stringify(latest));
  checkbox.checked = false;
  checkbox.onchange({target: checkbox});
  assert.notStrictEqual(h.cardCheckbox(), checkbox, 'a changed remote selection still reconciles the rendered grid');
  assert.deepEqual([...h.app.selected], [libraryAsset.id]);
});

for (const mode of Object.keys(reviewer)) {
  for (const split of [false, true]) {
    test(`${mode} ${split ? 'split' : 'single'} key tabs reconcile visible selections in place and export them`, async t => {
      const storageValues = new Map();
      const options = {storageValues, catalogObjects: [asset, {...libraryAsset, name: 'Other object'}],
        ...(split ? {initialSelection: []} : {})};
      const a = await boot(t, mode, options);
      await a.ready();
      const b = await boot(t, mode, options);
      await b.ready();
      a.activate();
      const remote = a.card(libraryAsset.id).querySelector('.card-check');
      remote.checked = true;
      remote.onchange({target: remote});
      b.activate();
      const localCard = b.card(asset.id), remoteCard = b.card(libraryAsset.id);
      const local = localCard.querySelector('.card-check');
      local.checked = true;
      local.onchange({target: local});
      assert.strictEqual(b.card(asset.id), localCard);
      assert.strictEqual(b.card(libraryAsset.id), remoteCard);
      assert.equal(remoteCard.querySelector('.card-check').checked, true);
      assert(remoteCard.classes.has('selected'));
      assert.deepEqual(new Set(b.app.selected), new Set([asset.id, libraryAsset.id]));
      b.get('#export-json').onclick();
      const exported = JSON.parse(await b.downloads[0].blob.text());
      assert.deepEqual(new Set(exported.selected), new Set([asset.id, libraryAsset.id]));

      b.app.changeView('selected');
      a.activate();
      remote.checked = false;
      remote.onchange({target: remote});
      b.activate();
      await b.app.openDetail(b.app.itemMap.get(asset.id));
      b.buttons[1].onclick();
      assert.deepEqual(b.visibleIds(), [asset.id], 'selected view removes remotely deselected row after own save');
      assert.equal(b.get('#detail-selected').checked, true);
      b.app.changeView('reviewed');
      assert.deepEqual(b.visibleIds(), [asset.id]);
      a.activate();
      await a.app.openDetail(a.app.itemMap.get(libraryAsset.id));
      a.buttons[0].onclick();
      b.activate();
      b.buttons[1].onclick();
      assert.deepEqual(new Set(b.visibleIds()), new Set([asset.id, libraryAsset.id]), 'reviewed view includes remotely reviewed row after own save');
    });
  }
}

test('hosted clean publish trims nickname without creating false load confirmation', async t => {
  let mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Old', revision: 2};
  const h = await boot(t, 'hosted', {shared: true, sharedSession: {userId: 'reviewer', mine}, responses: {
    '/api/selections': () => ({lists: [mine]}),
    '/api/selections/me': body => {mine = {...mine, ...JSON.parse(body), revision: 3}; return {mine};}
  }});
  await h.ready();
  const control = id => h.get('main > header').following.querySelector('#partner-' + id);
  control('nickname').value = ' New ';
  control('nickname').oninput();
  await control('publish').onclick();
  assert.equal(control('nickname').value, 'New');
  assert.equal(JSON.parse(h.values.get('asset-review-selection-v1:fixture:reviewer')).nickname, 'New');
  assert.doesNotMatch(control('status').textContent, /仍未发布/);
  await control('load').onclick();
  assert.equal(h.confirmations.length, 0);
});

test('hosted ordinary edits keep the revision belonging to stale stored IDs', async t => {
  const mine = {userId: 'reviewer', ids: [libraryAsset.id], nickname: 'Server', revision: 2};
  const h = await boot(t, 'hosted', {shared: true, sharedSession: {userId: 'reviewer', mine},
    responses: {'/api/selections/me': () => new Response(JSON.stringify({error: 'conflict'}), {status: 409})}});
  await h.ready();
  const key = 'asset-review-selection-v1:fixture:reviewer';
  h.values.set(key, JSON.stringify({ids: [asset.id], nickname: 'Old draft', baseRevision: 1}));
  const control = id => h.get('main > header').following.querySelector('#partner-' + id);
  control('nickname').value = 'Edited old draft';
  control('nickname').oninput();
  assert.equal(JSON.parse(h.values.get(key)).baseRevision, 1);
  await control('publish').onclick();
  assert.deepEqual(JSON.parse(h.requests.find(([path]) => path === '/api/selections/me')[2]),
    {ids: [asset.id], nickname: 'Edited old draft', revision: 1});
  assert.match(control('status').textContent, /服务器版本已变化/);
});

for (const interveningRevision of [1, 7]) {
  test(`hosted failed Load cannot replace intervening draft write at revision ${interveningRevision}`, async t => {
    const storageValues = new Map(), key = 'asset-review-selection-v1:fixture:reviewer';
    const mine = {userId: 'reviewer', ids: [libraryAsset.id], nickname: 'Server', revision: 7};
    storageValues.set(key, JSON.stringify({ids: [asset.id], nickname: 'Before', baseRevision: 1}));
    const options = {shared: true, storageValues, sharedSession: {userId: 'reviewer', mine},
      responses: {'/api/selections': () => ({lists: [mine]})}};
    const a = await boot(t, 'hosted', options);
    await a.ready();
    const b = await boot(t, 'hosted', options);
    await b.ready();
    const control = (tab, id) => tab.get('main > header').following.querySelector('#partner-' + id);
    a.activate();
    a.setStorageError(key);
    await control(a, 'load').onclick();
    b.activate();
    if (interveningRevision === 7) await control(b, 'load').onclick();
    b.get('#clear-selection').onclick();
    control(b, 'nickname').value = 'Intervening B';
    control(b, 'nickname').oninput();
    a.activate();
    a.setStorageError(undefined);
    control(a, 'nickname').value = 'After failed load';
    control(a, 'nickname').oninput();
    const saved = JSON.parse(storageValues.get(key));
    assert.deepEqual(saved.ids, []);
    assert.equal(saved.baseRevision, interveningRevision);
    assert.deepEqual([...a.app.selected], []);
    assert.equal(saved.nickname, 'After failed load');
  });
}

test('hosted ACK does not relabel an explicit server replacement made during PUT', async t => {
  const storageValues = new Map(), put = deferred(), key = 'asset-review-selection-v1:fixture:reviewer';
  const mine = {userId: 'reviewer', ids: [], nickname: 'Server', revision: 1};
  const options = {shared: true, storageValues, sharedSession: {userId: 'reviewer', mine}, responses: {
    '/api/selections': () => ({lists: [mine]}), '/api/selections/me': () => put.promise
  }};
  const a = await boot(t, 'hosted', options);
  await a.ready();
  const b = await boot(t, 'hosted', options);
  await b.ready();
  const control = (tab, id) => tab.get('main > header').following.querySelector('#partner-' + id);
  a.activate();
  a.cardCheckbox().onchange({target: {checked: true}});
  const publishing = control(a, 'publish').onclick();
  b.activate();
  await control(b, 'load').onclick();
  a.activate();
  put.resolve({mine: {...mine, ids: [asset.id], revision: 2}});
  await publishing;
  const saved = JSON.parse(storageValues.get(key));
  assert.deepEqual(saved.ids, []);
  assert.equal(saved.baseRevision, 1);
  assert.match(control(a, 'status').textContent, /未自动更新基线/);
});

test('hosted retains unknown IDs through hydration, edits, explicit Load and publication', async t => {
  let mine = {userId: 'reviewer', ids: ['new-catalogue-item'], nickname: 'Server', revision: 2};
  const h = await boot(t, 'hosted', {shared: true, sharedSession: {userId: 'reviewer', mine}, responses: {
    '/api/selections': () => ({lists: [mine]}),
    '/api/selections/me': body => {mine = {...mine, ...JSON.parse(body), revision: mine.revision + 1}; return {mine};}
  }});
  await h.ready();
  assert(!h.app.selected.has('new-catalogue-item'), 'unavailable IDs stay outside the visible selection');
  const control = id => h.get('main > header').following.querySelector('#partner-' + id);
  control('nickname').value = 'New name';
  control('nickname').oninput();
  await control('publish').onclick();
  assert.deepEqual(mine.ids, ['new-catalogue-item']);
  await control('load').onclick();
  h.cardCheckbox().onchange({target: {checked: true}});
  await control('publish').onclick();
  assert.deepEqual(new Set(mine.ids), new Set(['new-catalogue-item', asset.id]));
});

for (const hang of ['fetch', 'body']) {
  test(`hosted session ${hang} deadline unlocks local selection and aborts the request`, async t => {
    const pending = deferred();
    const h = await boot(t, 'hosted', {shared: true, responses: {
      '/api/selection/session': () => hang === 'fetch' ? pending.promise : new Response(new ReadableStream())
    }});
    const ready = h.ready();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.get('#import-btn').disabled, true);
    const session = h.requests.find(([path]) => path === '/api/selection/session');
    assert(session);
    h.sessionTimers()[0].run();
    await ready;
    assert.equal(session[3].aborted, true);
    assert.equal(h.get('#import-btn').disabled, false);
    assert.match(h.get('main > header').following.querySelector('#partner-identity').textContent, /无法核验/);
    h.cardCheckbox().onchange({target: {checked: true}});
    assert(h.app.selected.has(asset.id));
    assert(!h.requests.some(([path]) => path === '/api/selections'));
    pending.resolve({userId: 'late-account', mine: {ids: []}});
    await new Promise(resolve => setImmediate(resolve));
    assert(h.app.selected.has(asset.id), 'late identity response must not overwrite the unlocked local draft');
  });
}

for (const firstAction of ['checkbox', 'review', 'partner copy', 'legacy import']) {
  test(`hosted preserves server-only IDs after first ${firstAction} before an account draft exists`, async t => {
    let mine = {userId: 'reviewer', ids: ['unavailable-asset'], nickname: 'Server', revision: 1};
    const partner = {userId: 'other', ids: [asset.id], nickname: 'Partner', revision: 1};
    const h = await boot(t, 'hosted', {shared: true, sharedSession: {userId: 'reviewer', mine}, responses: {
      '/api/selections': () => ({lists: [partner]}),
      '/api/selections/me': body => {mine = {...mine, ...JSON.parse(body), revision: 2}; return {mine};}
    }});
    if (firstAction === 'legacy import') {
      const stored = h.stored();
      stored.selected = [asset.id];
      h.values.set(h.config.reviewKey, JSON.stringify(stored));
    }
    await h.ready();
    await new Promise(resolve => setImmediate(resolve));
    const key = 'asset-review-selection-v1:fixture:reviewer';
    assert(!h.values.has(key));
    assert.deepEqual([...h.app.selected], []);
    const panel = h.get('main > header').following;
    if (firstAction === 'checkbox') h.cardCheckbox().onchange({target: {checked: true}});
    if (firstAction === 'review') {
      await h.app.openDetail(h.app.itemMap.get(asset.id));
      h.buttons[1].onclick();
    }
    if (firstAction === 'partner copy') panel.querySelector('#partner-lists').children[0].querySelector('[data-copy]').onclick();
    if (firstAction === 'legacy import') panel.querySelector('#partner-legacy').onclick();
    assert(!h.app.selected.has('unavailable-asset'));
    await panel.querySelector('#partner-publish').onclick();
    const expected = firstAction === 'review' ? ['unavailable-asset'] : ['unavailable-asset', asset.id];
    assert.deepEqual(new Set(mine.ids), new Set(expected));
    assert.deepEqual(new Set(JSON.parse(h.values.get(key)).ids), new Set(expected));
  });
}

test('hosted incomplete local manifest exports restorable review state with unavailable IDs retained', async t => {
  const mine = {userId: 'reviewer', ids: ['unavailable-asset'], nickname: 'Server', revision: 2};
  const h = await boot(t, 'hosted', {shared: true, sharedSession: {userId: 'reviewer', mine}});
  await h.ready();
  const panel = h.get('main > header').following;
  await panel.querySelector('#partner-export').onclick();
  assert.equal(h.downloads.length, 1);
  const backup = JSON.parse(await h.downloads[0].blob.text());
  assert.equal(backup.version, 2);
  assert.equal(backup.scope, 'full-catalogue');
  assert.deepEqual(backup.selected, mine.ids);
  assert(!('assets' in backup));
  assert.match(panel.querySelector('#partner-status').textContent, /manifest 未完成.*不恢复账号或昵称.*待目录恢复后再导入/);
  const restored = await boot(t, 'hosted', {catalogObjects: [asset, {id: 'unavailable-asset', name: 'Returned asset'}]});
  await restored.ready();
  await restored.choose(async () => JSON.stringify(backup));
  assert(restored.app.selected.has('unavailable-asset'));
});

test('hosted recovery exports compact bounded state and round-trips despite a large catalogue', async t => {
  const catalogObjects = [asset, ...Array.from({length: 6000}, (_, i) => ({id: 'extra-' + i, name: 'Long catalogue name '.repeat(20)}))];
  const h = await boot(t, 'hosted', {shared: true, catalogObjects,
    responses: {'/api/selection/session': () => new Promise(() => {})}});
  const ready = h.ready();
  await new Promise(resolve => setImmediate(resolve));
  h.sessionTimers()[0].run();
  await ready;
  h.config.importLimitMiB = 1;
  h.cardCheckbox().onchange({target: {checked: true}});
  await h.app.openDetail(h.app.itemMap.get(asset.id));
  h.edit('Still typing');
  const recovery = h.get('main > header').following.children.find(child => child.id === 'partner-recovery-export');
  recovery.onclick();
  assert.equal(h.downloads.length, 1);
  assert(h.downloads[0].blob.size < 1024 * 1024);
  const text = await h.downloads[0].blob.text(), backup = JSON.parse(text);
  assert.equal(backup.scope, 'full-catalogue');
  assert.deepEqual(backup.selected, [asset.id]);
  assert.equal(backup.reviews[asset.id].comment, 'Still typing');
  for (const key of ['assets', 'animationPreviewRecords', 'actionLibraryRecords']) assert(!(key in backup));
  const restored = await boot(t, 'hosted', {catalogObjects});
  await restored.ready();
  restored.config.importLimitMiB = 1;
  await restored.choose(async () => text);
  assert.deepEqual([...restored.app.selected], [asset.id]);
  assert.equal(restored.app.reviews[asset.id].comment, 'Still typing');
  h.activate();
  h.edit('中文'.repeat(200000));
  recovery.onclick();
  assert.equal(h.downloads.length, 1, 'oversized UTF-8 state must not be labelled recoverable');
  assert.match(h.alerts.at(-1), /未导出可恢复备份.*不要刷新或关闭/);
});

test('hosted recovery reads latest reviews and pending edits without replacing authoritative account selections', async t => {
  const mine = {userId: 'reviewer', ids: ['unavailable-asset'], nickname: 'Server', revision: 2};
  const h = await boot(t, 'hosted', {shared: true, initialSelection: [asset.id], sharedSession: {userId: 'reviewer', mine}});
  await h.ready();
  await h.app.openDetail(h.app.itemMap.get(asset.id));
  h.setStorageError(h.config.reviewKey);
  h.buttons[1].onclick();
  h.edit('Pending textarea');
  const latest = h.stored();
  latest.reviews[asset.id] = {status: 'skip', comment: 'External'};
  latest.reviews['unavailable-review'] = {status: 'keep', comment: 'Preserve external unknown review'};
  h.values.set(h.config.reviewKey, JSON.stringify(latest));
  const bytes = h.values.get(h.config.reviewKey);
  const exportButton = h.get('main > header').following.querySelector('#partner-export');
  await exportButton.onclick();
  let backup = JSON.parse(await h.downloads[0].blob.text());
  assert.deepEqual(backup.selected, ['unavailable-asset']);
  assert.equal(backup.reviews[asset.id].status, 'check');
  assert.equal(backup.reviews[asset.id].comment, 'Pending textarea');
  assert.deepEqual(backup.reviews['unavailable-review'], latest.reviews['unavailable-review']);
  assert.equal(h.values.get(h.config.reviewKey), bytes);
  assert.equal(h.commentTimers().length, 1);
  h.values.set(h.config.reviewKey, '{broken');
  await exportButton.onclick();
  backup = JSON.parse(await h.downloads[1].blob.text());
  assert.equal(backup.reviews[asset.id].comment, 'Pending textarea');
  assert.deepEqual(backup.selected, ['unavailable-asset']);
  assert.match(backup.warnings[0], /无法确认其他标签页/);
  assert.equal(h.values.get(h.config.reviewKey), '{broken');
  h.values.delete(h.config.reviewKey);
  await exportButton.onclick();
  backup = JSON.parse(await h.downloads[2].blob.text());
  assert.equal(backup.reviews[asset.id].status, 'check');
  assert.match(backup.warnings[0], /无法确认其他标签页/);
});

test('hosted signed-in direct backup preserves failed writes even while manifest delivery hangs', async t => {
  const mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Server', revision: 2};
  const delivery = deferred();
  const h = await boot(t, 'hosted', {shared: true, sharedSession: {userId: 'reviewer', mine},
    responses: {'/delivery-index.json': () => delivery.promise}});
  await h.ready();
  await h.app.openDetail(h.app.itemMap.get(asset.id));
  h.setStorageError(h.config.reviewKey);
  h.buttons[1].onclick();
  h.edit('Unsaved while signed in');
  const panel = h.get('main > header').following;
  const manifest = panel.querySelector('#partner-export').onclick();
  const requestCount = h.requests.length;
  const recovery = panel.children.find(child => child.id === 'partner-recovery-export');
  assert(recovery);
  recovery.onclick();
  assert.equal(h.requests.length, requestCount, 'direct backup must not fetch any delivery information');
  assert.equal(h.downloads.length, 1);
  const backup = JSON.parse(await h.downloads[0].blob.text());
  assert.equal(backup.reviews[asset.id].status, 'check');
  assert.equal(backup.reviews[asset.id].comment, 'Unsaved while signed in');
  assert.deepEqual(backup.selected, [asset.id]);
  delivery.resolve({assets: {}});
  await manifest;
});

test('hosted unauthenticated split-key recovery reads latest local selections plus failed intents', async t => {
  const h = await boot(t, 'hosted', {shared: true, initialSelection: [],
    catalogObjects: [asset, {...libraryAsset, name: 'Other'}],
    responses: {'/api/selection/session': () => {throw Error('Offline');}}});
  await h.ready();
  h.values.set(h.config.selectionStorageKey, JSON.stringify([libraryAsset.id]));
  h.setStorageError(h.config.selectionStorageKey);
  h.card(asset.id).querySelector('.card-check').onchange({target: {checked: true}});
  const recovery = h.get('main > header').following.children.find(child => child.id === 'partner-recovery-export');
  recovery.onclick();
  const backup = JSON.parse(await h.downloads[0].blob.text());
  assert.deepEqual(new Set(backup.selected), new Set([asset.id, libraryAsset.id]));
  assert.deepEqual(JSON.parse(h.values.get(h.config.selectionStorageKey)), [libraryAsset.id]);
});

for (const bytes of ['', '  ', '{}', 'null', '{"version":1}', '{"version":1,"reviews":{}}', '{"version":1,"reviews":{},"selected":[]}']) {
  test(`hosted recovery distinguishes ${JSON.stringify(bytes)} from a valid empty review envelope`, async t => {
    const h = await boot(t, 'hosted', {shared: true, initialSelection: [],
      responses: {'/api/selection/session': () => {throw Error('Offline');}}});
    await h.ready();
    h.cardCheckbox().onchange({target: {checked: true}});
    h.values.set(h.config.reviewKey, bytes);
    const validEmpty = bytes === '{"version":1,"reviews":{},"selected":[]}';
    h.values.set(h.config.selectionStorageKey, validEmpty ? '[]' : '  ');
    const recovery = h.get('main > header').following.children.find(child => child.id === 'partner-recovery-export');
    recovery.onclick();
    const backup = JSON.parse(await h.downloads[0].blob.text());
    if (validEmpty) {
      assert.deepEqual(backup.reviews, {});
      assert.deepEqual(backup.selected, []);
      assert.deepEqual(backup.warnings, []);
    } else {
      assert.equal(backup.reviews[asset.id].comment, oldReview.comment);
      assert.deepEqual(backup.selected, [asset.id]);
      assert.match(backup.warnings[0], /无法确认其他标签页/);
    }
  });
}

test('hosted authenticated backup reads another tab additions/removals and pending account edits without writing', async t => {
  const mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Server', revision: 2};
  const third = {id: 'third', name: 'Third'};
  const storageValues = new Map(), key = 'asset-review-selection-v1:fixture:reviewer';
  const options = {shared: true, storageValues, sharedSession: {userId: 'reviewer', mine},
    catalogObjects: [asset, {...libraryAsset, name: 'Other'}, third]};
  const a = await boot(t, 'hosted', options);
  await a.ready();
  const b = await boot(t, 'hosted', options);
  await b.ready();
  const recovery = a.get('main > header').following.children.find(child => child.id === 'partner-recovery-export');
  b.card(asset.id).querySelector('.card-check').onchange({target: {checked: false}});
  b.card(libraryAsset.id).querySelector('.card-check').onchange({target: {checked: true}});
  a.activate();
  recovery.onclick();
  let backup = JSON.parse(await a.downloads[0].blob.text());
  assert.deepEqual(backup.selected, [libraryAsset.id]);
  a.setStorageError(key);
  a.card(third.id).querySelector('.card-check').onchange({target: {checked: true}});
  const bytes = storageValues.get(key), calls = a.calls.length;
  recovery.onclick();
  backup = JSON.parse(await a.downloads[1].blob.text());
  assert.deepEqual(new Set(backup.selected), new Set([libraryAsset.id, third.id]));
  assert.equal(a.calls.length, calls);
  assert.equal(storageValues.get(key), bytes);
  storageValues.set(key, '{broken');
  recovery.onclick();
  backup = JSON.parse(await a.downloads[2].blob.text());
  assert.deepEqual(new Set(backup.selected), new Set([asset.id, third.id]));
  assert.match(backup.warnings[0], /无法确认其他标签页/);
  storageValues.set(key, bytes);
  a.setStorageError(undefined);
  const nickname = a.get('main > header').following.querySelector('#partner-nickname');
  nickname.value = 'Recover pending';
  nickname.oninput();
  assert.deepEqual(new Set(JSON.parse(storageValues.get(key)).ids), new Set([libraryAsset.id, third.id]));
});

test('hosted backup retains a confirmed failed Load without consuming it and ignores reverted comment input', async t => {
  const key = 'asset-review-selection-v1:fixture:reviewer';
  const mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Server', revision: 2};
  const h = await boot(t, 'hosted', {shared: true, sharedSession: {userId: 'reviewer', mine},
    responses: {'/api/selections': () => ({lists: [mine]})}});
  await h.ready();
  await h.app.openDetail(h.app.itemMap.get(asset.id));
  h.edit('Changed');
  h.edit(oldReview.comment);
  const latest = h.stored();
  latest.reviews[asset.id].comment = 'Other tab current text';
  h.values.set(h.config.reviewKey, JSON.stringify(latest));
  h.values.set(key, '{broken');
  h.setStorageError(key);
  const panel = h.get('main > header').following;
  await panel.querySelector('#partner-load').onclick();
  panel.children.find(child => child.id === 'partner-recovery-export').onclick();
  const backup = JSON.parse(await h.downloads[0].blob.text());
  assert.deepEqual(backup.selected, mine.ids);
  assert.equal(backup.reviews[asset.id].comment, 'Other tab current text');
  assert.equal(h.values.get(key), '{broken');
  h.setStorageError(undefined);
  panel.querySelector('#partner-nickname').value = 'Retry';
  panel.querySelector('#partner-nickname').oninput();
  assert.deepEqual(JSON.parse(h.values.get(key)).ids, mine.ids);
});

test('hosted backup preserves visible confirmed Load when original storage bytes could not be read', async t => {
  const key = 'asset-review-selection-v1:fixture:reviewer';
  const mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Server', revision: 2};
  const h = await boot(t, 'hosted', {shared: true, sharedSession: {userId: 'reviewer', mine},
    responses: {'/api/selections': () => ({lists: [mine]})}});
  await h.ready();
  const stale = JSON.stringify({ids: [], nickname: 'Old persisted draft', baseRevision: 1});
  h.values.set(key, stale);
  h.setStorageError('method');
  const panel = h.get('main > header').following;
  await panel.querySelector('#partner-load').onclick();
  assert.match(h.confirmations[0], /无法读取当前浏览器草稿/);
  assert.deepEqual([...h.app.selected], mine.ids);
  h.setStorageError(undefined);
  panel.children.find(child => child.id === 'partner-recovery-export').onclick();
  const backup = JSON.parse(await h.downloads[0].blob.text());
  assert.deepEqual(backup.selected, mine.ids);
  assert.match(backup.warnings[0], /无法确认其他标签页/);
  assert.equal(h.values.get(key), stale, 'read-only backup must not authorize replacing previously unreadable bytes');
});

test('hosted confirmed Load retries unchanged malformed bytes after a temporary write failure', async t => {
  const key = 'asset-review-selection-v1:fixture:reviewer';
  const mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Server', revision: 2};
  const h = await boot(t, 'hosted', {shared: true, storageValues: new Map([[key, '{broken']]),
    sharedSession: {userId: 'reviewer', mine}, responses: {'/api/selections': () => ({lists: [mine]})}});
  await h.ready();
  const control = id => h.get('main > header').following.querySelector('#partner-' + id);
  h.setStorageError(key);
  await control('load').onclick();
  assert.match(h.confirmations[0], /无法读取当前浏览器草稿/);
  assert.equal(h.values.get(key), '{broken');
  h.setStorageError(undefined);
  control('nickname').value = 'Retry confirmed load';
  control('nickname').oninput();
  assert.deepEqual(JSON.parse(h.values.get(key)).ids, mine.ids);
  assert.equal(JSON.parse(h.values.get(key)).baseRevision, 2);
  assert.equal(control('status').following.hidden, true);
  h.values.set(key, '{broken-again');
  h.setStorageError(key);
  await control('load').onclick();
  h.setStorageError(undefined);
  h.values.set(key, '{intervening-write');
  control('nickname').value = 'Must not replace intervening bytes';
  control('nickname').oninput();
  assert.equal(h.values.get(key), '{intervening-write');
  assert.equal(control('status').following.hidden, false);
});

for (const split of [false, true]) {
  test(`hosted session timeout exposes recovery and accurately labels ${split ? 'independent local storage' : 'volatile selection'}`, async t => {
    const h = await boot(t, 'hosted', {shared: true, ...(split ? {initialSelection: []} : {}),
      responses: {'/api/selection/session': () => new Promise(() => {})}});
    const ready = h.ready();
    await new Promise(resolve => setImmediate(resolve));
    h.sessionTimers()[0].run();
    await ready;
    const panel = h.get('main > header').following;
    const status = panel.querySelector('#partner-status');
    const warning = status.textContent;
    if (split) assert.match(warning, /本浏览器本地存储/);
    else assert.match(warning, /仅保留在此页面.*关闭或刷新会丢失/);
    assert.doesNotMatch(panel.querySelector('#partner-identity').textContent, /请重新登录后刷新/);
    h.cardCheckbox().onchange({target: {checked: true}});
    await h.app.openDetail(h.app.itemMap.get(asset.id));
    h.buttons[1].onclick();
    assert.equal(status.textContent, warning, 'ordinary edits must not dismiss the persistence warning');
    if (split) assert.deepEqual(JSON.parse(h.values.get(h.config.selectionStorageKey)), [asset.id]);
    const recovery = panel.children.find(child => child.id === 'partner-recovery-export');
    assert(recovery, 'recovery must be visible without authenticated account controls');
    recovery.onclick();
    const backup = JSON.parse(await h.downloads[0].blob.text());
    assert.deepEqual(backup.selected, [asset.id]);
    assert.equal(backup.reviews[asset.id].status, 'check');
    assert.equal(status.textContent, warning);
    assert(!h.values.has('asset-review-selection-v1:fixture:reviewer'));
  });
}

test('hosted successful PUT advances the live draft while repeated storage writes fail', async t => {
  let mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Server', revision: 1};
  const key = 'asset-review-selection-v1:fixture:reviewer';
  const storageValues = new Map([[key, JSON.stringify({ids: mine.ids, nickname: mine.nickname, baseRevision: 1})]]);
  const h = await boot(t, 'hosted', {shared: true, storageValues, sharedSession: {userId: 'reviewer', mine}, responses: {
    '/api/selections/me': body => {
      const submitted = JSON.parse(body);
      assert.equal(submitted.revision, mine.revision);
      mine = {...mine, ...submitted, revision: mine.revision + 1};
      return {mine};
    }
  }});
  await h.ready();
  const panel = h.get('main > header').following;
  h.setStorageError(key);
  await panel.querySelector('#partner-publish').onclick();
  await panel.querySelector('#partner-publish').onclick();
  assert.equal(mine.revision, 3);
  assert.equal(JSON.parse(h.values.get(key)).baseRevision, 1);
  assert.equal(panel.querySelector('#partner-status').following.hidden, false);
  h.setStorageError(undefined);
  panel.querySelector('#partner-nickname').value = 'Recovered storage';
  panel.querySelector('#partner-nickname').oninput();
  assert.equal(JSON.parse(h.values.get(key)).baseRevision, 3);
});

for (const invalid of [{ids: 3}, {ids: [null]}, {ids: [], nickname: {}}, {ids: [], baseRevision: '1'}]) {
  test(`hosted invalid account draft ${JSON.stringify(invalid)} keeps identity controls and recovery available`, async t => {
    const key = 'asset-review-selection-v1:fixture:reviewer', bytes = JSON.stringify(invalid);
    const mine = {userId: 'reviewer', ids: [asset.id], nickname: 'Server', revision: 2};
    const h = await boot(t, 'hosted', {shared: true, storageValues: new Map([[key, bytes]]),
      sharedSession: {userId: 'reviewer', mine}, responses: {'/api/selections': () => ({lists: [mine]})}});
    await h.ready();
    const panel = h.get('main > header').following;
    assert.equal(panel.querySelector('#partner-controls').hidden, false);
    assert.match(panel.querySelector('#partner-identity').textContent, /reviewer/);
    assert.equal(panel.querySelector('#partner-status').following.hidden, false);
    assert.equal(h.values.get(key), bytes);
    assert.deepEqual([...h.app.selected], mine.ids);
    await panel.querySelector('#partner-load').onclick();
    assert.match(h.confirmations[0], /无法读取当前浏览器草稿/);
    assert.deepEqual(JSON.parse(h.values.get(key)).ids, mine.ids);
  });
}


test('public snapshot click rebases stored data and pending editor intent without a storage write',async t=>{
 const h=await boot(t,'public',{catalogObjects:[asset,{id:'two',name:'Second'}]});await h.ready();
 await h.app.openDetail(h.app.itemMap.get(asset.id));
 const latest=h.stored();latest.reviews.one={status:'skip',comment:'External'};latest.reviews.two={status:'keep',comment:'New'};latest.selected=['two'];
 h.values.set(h.config.reviewKey,JSON.stringify(latest));
 h.get('#export-snapshot').onclick();
 let payload=JSON.parse(await h.downloads[0].blob.text());assert.equal(payload.reviews.one.comment,'External');assert.deepEqual(payload.selected,['two']);
 h.setStorageError(h.config.reviewKey);h.buttons[1].onclick();
 h.get('#detail-selected').onchange({target:{checked:true}});h.edit('Dirty textarea');
 const before=h.values.get(h.config.reviewKey);h.get('#export-snapshot').onclick();
 payload=JSON.parse(await h.downloads[1].blob.text());assert.equal(payload.reviews.one.comment,'Dirty textarea');assert.equal(payload.reviews.one.status,'check');assert.deepEqual(new Set(payload.selected),new Set(['one','two']));
 assert.equal(h.values.get(h.config.reviewKey),before);assert.equal(h.commentTimers().length,1);
 h.values.set(h.config.reviewKey,'{corrupt');h.get('#export-snapshot').onclick();
 payload=JSON.parse(await h.downloads[2].blob.text());assert.equal(payload.reviews.one.comment,'Dirty textarea');assert.match(h.toast(),/无法确认/);assert.equal(h.values.get(h.config.reviewKey),'{corrupt');
});
for(const mode of Object.keys(reviewer))test(mode+' opens explicit assembly model instead of inherited fragment variant',async t=>{
 const previews=[];
 const h=await boot(t,mode,{catalogAssets:[{id:'fragment',name:'Fragment',modelUrl:'/review/fragment.glb',variants:[{id:'v',modelUrl:'/review/fragment-variant.glb'}]}],catalogObjects:[{...asset,assetId:'fragment',assemblyModelUrl:'/review/assembly.glb'}],createViewer:async(stage,url)=>{previews.push(url);return {dispose(){}};}});
 await h.ready();await h.app.openDetail(h.app.itemMap.get(asset.id));assert.equal(previews.at(-1),'/review/assembly.glb');assert.equal(h.get('#resource-variant').hidden,true);
});

for (const sameModel of [true, false]) {
  test(`hosted explicit object model ${sameModel ? 'retains a matching' : 'rejects a mismatched'} base download declaration`, async t => {
    const declaration = {format: 'glb', name: 'Base preview', preview_sha256: 'a'.repeat(64)};
    const previews = [], downloads = [];
    const h = await boot(t, 'hosted', {
      catalogAssets: [{id: 'base', name: 'Base', modelUrl: '/review/base.glb', modelAsset: declaration,
        variants: [{id: 'variant', modelUrl: '/review/variant.glb'}]}],
      catalogObjects: [{...asset, assetId: 'base', modelUrl: sameModel ? 'base.glb' : 'different.glb'}],
      createViewer: async (stage, url, options) => {previews.push({url, declaration: options.modelAsset}); return {dispose() {}};},
      downloadResource: async value => {downloads.push(value); return {bytes: new Uint8Array(), filename: 'base.glb'};}
    });
    await h.ready();
    await h.app.openDetail(h.app.itemMap.get(asset.id));
    assert.equal(previews.at(-1).url, sameModel ? 'base.glb' : 'different.glb');
    assert.deepEqual(previews.at(-1).declaration, sameModel ? declaration : undefined);
    assert.equal(h.get('#resource-variant').hidden, true);
    const button = h.get('#detail-downloads').querySelector('[data-verified-model-download]');
    if (sameModel) {
      await button.onclick();
      assert.deepEqual(downloads, [declaration]);
    } else assert.equal(button, undefined);
  });
}
