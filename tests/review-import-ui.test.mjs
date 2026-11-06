import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
async function boot(t, mode, { shared = false, sharedSession, sharedList } = {}) {
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
    catalog: { assets: [] },
    objectCatalog: { objects: [asset] },
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
  const calls = [];
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
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
  const fetch = async (path, { method = 'GET' } = {}) => {
    requests.push([path, method]);
    let body;
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
      default:
        assert.fail(`Unexpected request ${method} ${path}`);
    }
    return new Response(JSON.stringify(body));
  };
  const timers = new Map();
  const bindings = {
    document: {
      querySelector: get, getElementById: id => get('#' + id), createElement: () => new Element(),
      querySelectorAll: selector => {
        switch (selector) {
          case '.review-buttons button': return buttons;
          default: return [];
        }
      },
      addEventListener() {}, body: new Element()
    },
    window: { addEventListener(name, run) {
      if (!windowEvents.has(name)) windowEvents.set(name, []);
      windowEvents.get(name).push(run);
    } },
    location: { href: url, assign() {} }, localStorage, fetch,
    __importFixture: {
      project, catalogue, setTimeout: (run, delay) => {
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
    Object.defineProperty(globalThis, name, { value, configurable: true });
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
    .replace(viewerImport, 'const configureRenderer = async () => {};')
    .replace(/from '(\.\/shared\/[^']+)'/g, (_, path) => {
      // The hosted resolver imports generated private pins. This fixture has no native assets.
      const moduleRoot = path === './shared/resource-url.mjs' ? reviewer.public : root;
      return 'from ' + JSON.stringify(new URL(path, moduleRoot).href);
    })
    .replace(/init\(\);\s*$/, 'export const ready = init(); export { itemMap, reviews, selected, openDetail };');
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
    app, get, config, buttons, calls, values, stored, requests, choose, backup, dispatch,
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
  session.resolve({ userId: 'reviewer' });
  await new Promise(resolve => setImmediate(resolve));
  assert(h.requests.some(([path]) => path === '/api/selections'));
  assert.equal(ready, true, 'catalogue initialization must finish without the shared list');
  await loading;
  for (const id of controls) assert.equal(h.get(id).disabled, false);
  assert.deepEqual([...h.app.selected], [libraryAsset.id]);
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
