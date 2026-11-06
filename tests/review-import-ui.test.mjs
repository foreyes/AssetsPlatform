import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSelectionAssets } from '../reference/hosted/review-frontend/shared/selection-manifest.mjs';

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
    this.children.push(...children);
  }
  replaceChildren(...children) { this.children = children; }
  querySelector(selector) {
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
}

let fixtureId = 0;
async function boot(t, mode, {
  shared = false, sharedSession, sharedList, responses = {}, storageError, initialSelection,
  catalogAssets = [], catalogObjects = [asset], createViewer
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
  const values = new Map([[config.reviewKey, JSON.stringify({
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
      if (storageError === 'method') throw Error('Storage write blocked');
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
  const fetch = async (path, { method = 'GET', body: requestBody } = {}) => {
    requests.push([path, method, requestBody]);
    let body;
    if (Object.hasOwn(responses, path)) {
      body = await responses[path](requestBody);
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
      project, catalogue, createViewer, setTimeout: (run, delay) => {
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
  const viewerImport = /import \{ createViewer, createThumbnailRenderer, configureRenderer, renderIdentity, downloadResource \} from '[^']+';/;
  assert.match(source, projectImport);
  assert.match(source, viewerImport);
  assert.match(source, /init\(\);\s*$/);
  const script = source
    .replace(projectImport, `
      const loadProject = async () => globalThis.__importFixture.project;
      const loadProjectData = () => globalThis.__importFixture.catalogue.promise;
      const objectCategory = item => item.category;
    `)
    .replace(viewerImport, 'const { createViewer } = globalThis.__importFixture; const configureRenderer = async () => {};')
    .replace(/from '(\.\/shared\/[^']+)'/g, (_, path) => {
      // The hosted resolver imports generated private pins. This fixture has no native assets.
      const moduleRoot = path === './shared/resource-url.mjs' ? reviewer.public : root;
      return 'from ' + JSON.stringify(new URL(path, moduleRoot).href);
    })
    .replace(/init\(\);\s*$/, 'export const ready = init(); export { itemMap, reviews, selected, openDetail, openResource };');
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
    cardCheckbox: () => cards[0].querySelector('.card-check'),
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
    const nextFile = deferred();
    const nextImport = h.choose(() => nextFile.promise);
    nextFile.resolve(h.backup({ reviews: { unknown: incomingReview }, selected: ['unknown'] }));
    await nextImport;
    assert.match(h.toast(), /已合并 0 条有效记录/);
    assert(!h.app.selected.has('unknown'));
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
  assert.match(control('status').textContent, /已发布 1 项/);
  assert.match(control('lists').textContent, /Post-publish refresh failed/);
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /无法读取或保存账号草稿/);
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
  h.app.reviews.one.comment = '中文'.repeat(100);
  const {reviewStateSnapshot, reviewExportBlob} = await import('../apps/reviewer/shared/review-export.mjs');
  const payload = reviewStateSnapshot(h.config, h.app.reviews, h.app.selected);
  const text = JSON.stringify(payload, null, 2), bytes = new Blob([text]).size;
  assert(bytes > text.length);
  h.config.importLimitMiB = (text.length + 1) / 1024 / 1024;
  assert.equal(reviewExportBlob(payload, h.config).restorable, false);
  h.get('#export-snapshot').onclick();
  assert.equal(h.downloads.length, 0); assert.match(h.alerts[0], /未导出可恢复备份/);
  h.get('#export-all').onclick();
  assert.equal(h.downloads.length, 1); assert.match(h.alerts[1], /不能用于恢复/);
});
