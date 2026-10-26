import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildExample, CLIP_ID } from '../animation-example/generate.mjs';
import { parseGLB, createSourceAnimation } from '../viewer.mjs';
import { verifiedAnimationRecord, resolveAnimation } from '../shared/animation-contract.mjs';
import { loadProject, loadProjectData } from '../shared/project-loader.mjs';

const base = new URL('../animation-example/', import.meta.url);
const fixture = buildExample();
const model = readFileSync(new URL('assets/linear-translation.glb', base));
const sidecar = JSON.parse(readFileSync(new URL('assets/linear-translation.animation.json', base)));
const pending = JSON.parse(readFileSync(new URL('assets/animation-catalog.json', base))).objects[0];
const copy = value => structuredClone(value);
const approx = (actual, expected) => assert(Math.abs(actual - expected) < 2e-5, `${actual} ≈ ${expected}`);
function withGLTF(change) {
  const gltf = copy(fixture.gltf); change(gltf);
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const oldJSONBytes = model.readUInt32LE(12), bin = model.subarray(28 + oldJSONBytes);
  const result = Buffer.alloc(28 + json.length + bin.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12); result.writeUInt32LE(0x4e4f534a, 16); json.copy(result, 20);
  result.writeUInt32LE(bin.length, 20 + json.length); result.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(result, 28 + json.length);
  return result;
}

test('all generated artifacts are byte-for-byte deterministic', () => {
  for (const [name, expected] of Object.entries(fixture.files)) assert.deepEqual(readFileSync(new URL(name, base)), expected, name);
  assert.deepEqual(buildExample().files, fixture.files);
});

test('GLB has a genuine 1 second LINEAR translation channel matching the sidecar', () => {
  const length = model.readUInt32LE(12);
  const gltf = JSON.parse(model.subarray(20, 20 + length).toString());
  const binOffset = 28 + length;
  assert.equal(model.readUInt32LE(8), model.length);
  assert.equal(model.readUInt32LE(20 + length), gltf.buffers[0].byteLength);
  assert.equal(gltf.animations[0].samplers[0].interpolation, 'LINEAR');
  assert.deepEqual(gltf.animations[0].channels[0].target, { node: 1, path: 'translation' });
  assert.deepEqual(gltf.nodes[0].children, [1]);
  assert.equal(gltf.nodes[1].extras.sourceId, sidecar.nodes[1].id);
  assert.equal(gltf.extras.sourceId, sidecar.sourceId);
  assert.equal(gltf.buffers[0].uri, undefined);
  const values = accessorIndex => {
    const accessor = gltf.accessors[accessorIndex], view = gltf.bufferViews[accessor.bufferView];
    const start = binOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const count = accessor.count * ({ SCALAR: 1, VEC3: 3 })[accessor.type];
    return Array.from({ length: count }, (_, i) => model.readFloatLE(start + i * 4));
  };
  assert.deepEqual(values(gltf.animations[0].samplers[0].input), [0, 1]);
  assert.deepEqual(values(gltf.animations[0].samplers[0].output), [0, .25, 0, 1, .25, 0]);
  assert.deepEqual(sidecar.clips[0].tracks[0].times, [0, 1]);
  assert.deepEqual(sidecar.clips[0].tracks[0].values, [[0, .25, 0], [1, .25, 0]]);
});

test('CPU source binding, parent and positions evaluate at 0, 0.5 and 1 seconds', () => {
  const geometry = parseGLB(model);
  assert.equal(geometry.skinSummary.skins, 0);
  assert.equal(geometry.skinSummary.skinnedPrimitives, 0);
  assert.equal(geometry.primitives.length, 1);
  const animation = createSourceAnimation(geometry, sidecar);
  assert.deepEqual(animation.diagnostics, []);
  assert.deepEqual(animation.clips.map(c => c.id), [CLIP_ID]);
  for (const [time, x] of [[0, -1], [.5, 1], [1, 3]]) {
    const sampled = animation.sample(CLIP_ID, time);
    approx(sampled.primitives[0].positions[0], x);
    approx(sampled.primitives[0].positions[1], -.8);
    assert.equal(sampled.animationEvaluation.skinnedPrimitives, 0);
  }
  assert.equal(animation.getState().time, 1);
  const rest = animation.reset();
  approx(rest.primitives[0].positions[0], -1);
});

test('ordinary STEP and CUBICSPLINE sidecar interpolation remain available', () => {
  const step = copy(sidecar);
  step.clips[0].tracks[0].interpolation = 'STEP';
  approx(createSourceAnimation(parseGLB(model), step).sample(CLIP_ID, .5).primitives[0].positions[0], -1);
  const cubic = copy(sidecar), track = cubic.clips[0].tracks[0];
  track.interpolation = 'CUBICSPLINE';
  track.inTangents = [[1, 0, 0], [1, 0, 0]];
  track.outTangents = [[1, 0, 0], [1, 0, 0]];
  approx(createSourceAnimation(parseGLB(model), cubic).sample(CLIP_ID, .5).primitives[0].positions[0], 1);
});

test('wrong object source ID, node index, static TRS and parent fail closed with diagnostics', () => {
  for (const [mutate, reason] of [
    [d => { d.sourceId += ':wrong'; }, /源对象 ID 不匹配/],
    [d => { d.nodes[1].glbNodeIndex = 0; }, /源节点绑定不匹配/],
    [d => { d.nodes[1].translation[0] = 2; }, /源静态变换与 GLB 矩阵不匹配/],
    [d => { d.nodes[1].parentId = null; }, /源父节点与 GLB 层级不匹配/]
  ]) {
    const data = copy(sidecar); mutate(data);
    const animation = createSourceAnimation(parseGLB(model), data);
    assert.deepEqual(animation.clips, []);
    assert.match(animation.diagnostics[0].reason, reason);
  }
});

test('provenance path cannot substitute for an explicit GLB object source ID', () => {
  const withoutIdentity = withGLTF(gltf => {
    delete gltf.extras.sourceId;
    delete gltf.nodes[0].extras.sourceId;
    gltf.extras.provenance = { sourceFile: 'synthetic:linear-translation', pathId: 'object' };
  });
  const animation = createSourceAnimation(parseGLB(withoutIdentity), sidecar);
  assert.deepEqual(animation.clips, []);
  assert.match(animation.diagnostics[0].reason, /源对象 ID 不匹配/);
});

test('public evaluator rejects removed source-engine clip formats without a fallback', () => {
  for (const [mutate, reason] of [
    [d => { d.clips[0].tracks[0].interpolation = 'UNITY_CANONICAL'; }, /未验证的源曲线插值/],
    [d => { d.clips[0].tracks[0].scalarCurves = []; }, /未转换的源引擎曲线/],
    [d => { d.clips[0].tracks[0].path = 'active'; }, /不支持的源动画属性/],
    [d => { d.nodes[1].sourceActive = false; }, /不支持未转换的源节点启用状态/],
    [d => { d.flows = []; }, /不支持源状态流程/],
    [d => { d.evaluation = 'source_constraint_baked'; }, /不支持源状态流程/],
    [d => { d.precomputedFraming = {}; }, /不支持源状态流程/],
    [d => { d.clips[0].segments = []; }, /不支持源状态流程/]
  ]) {
    const data = copy(sidecar); mutate(data);
    const animation = createSourceAnimation(parseGLB(model), data);
    assert.deepEqual(animation.clips, []);
    assert.match(animation.diagnostics[0].reason, reason);
  }
});

test('pending catalog record does not assert WebGL verification or unlock clips', () => {
  assert.equal(pending.status, 'pending');
  assert.equal(pending.skinBindingVerified, false);
  assert.equal(pending.sourceCurvesVerified, false);
  assert.equal(pending.pixelVerified, false);
  assert.deepEqual(pending.verifiedPlayableClipIds, []);
  assert.equal(verifiedAnimationRecord(pending), false);
  assert.deepEqual(JSON.parse(readFileSync(new URL('assets/actions-catalog.json', base))).objects, []);
  const ready = { ...pending, status: 'ready', skinBindingVerified: true, sourceCurvesVerified: true, pixelVerified: true, verifiedPlayableClipIds: [CLIP_ID] };
  assert.equal(verifiedAnimationRecord(ready), true);
  assert.equal(resolveAnimation({ enabled: true, item: { id: ready.objectId, sourceId: ready.sourceId, isObject: true }, base: ready }).record, ready);
  assert.equal(verifiedAnimationRecord({ ...ready, variants: { constraint: ready } }), false);
});

test('registered project loads both catalogs but leaves the animation gated', async () => {
  const appRoot = new URL('../', import.meta.url);
  const readJSON = async url => JSON.parse(readFileSync(new URL(new URL(url).pathname.slice(1), appRoot)));
  const project = await loadProject({ fetchJSON: readJSON, location: { href: 'http://localhost/', search: '?project=animation-example' } });
  assert.equal(project.config.verifiedAnimation, true);
  const data = await loadProjectData(project, readJSON);
  assert.equal(data.objectCatalog.objects[0].sourceId, sidecar.sourceId);
  assert.equal(data.animationIndex.objects.length, 1);
  assert.equal(data.actionIndex.objects.length, 0);
  assert.equal(verifiedAnimationRecord(data.animationIndex.objects[0]), false);
});

test('isolated WebGL harness wires real viewer calls without claiming GPU evidence', async () => {
  const html = readFileSync(new URL('validate-webgl.html', base), 'utf8');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]
    .replace("import { createViewer } from '../viewer.mjs';", 'const createViewer = globalThis.__mockCreateViewer;');
  assert(script?.includes('viewer = await createViewer('));
  assert(!script.includes('pixelVerified') && !script.includes('animation-catalog.json'));
  const ids = ['stage', 'play', 'pause', 'seek', 'stop', 'time', 'status'];
  const elements = Object.fromEntries(ids.map(id => [id, { disabled: true, value: '', textContent: '' }]));
  for (const id of ids) assert(html.includes(`id="${id}"`), `missing harness element ${id}`);
  const samples = [], frames = [];
  const viewer = {
    getAnimationClips: () => [{ id: CLIP_ID }], getAnimationDiagnostics: () => [],
    setAnimationTime: (id, time) => samples.push([id, time]), dispose: () => {}
  };
  await runInNewContext(`(async () => { ${script} })()`, {
    __mockCreateViewer: async () => viewer,
    document: { getElementById: id => elements[id] },
    fetch: async () => ({ ok: true, json: async () => sidecar }),
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    cancelAnimationFrame: () => {},
    window: { addEventListener: () => {} },
    console: { error: error => { throw error; } }
  });
  assert.deepEqual(samples, [[CLIP_ID, 0]]);
  for (const id of ['play', 'pause', 'seek', 'stop']) assert.equal(elements[id].disabled, false);
  elements.play.onclick();
  frames.shift()(1000); frames.shift()(1500);
  assert.deepEqual(samples.at(-1), [CLIP_ID, .5]);
  elements.pause.onclick();
  elements.seek.oninput({ target: { value: '750' } });
  assert.deepEqual(samples.at(-1), [CLIP_ID, .75]);
  elements.stop.onclick();
  assert.deepEqual(samples.at(-1), [CLIP_ID, 0]);
  assert.equal(elements.time.value, '0.00 s');
});
