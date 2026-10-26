// Self-authored, deterministic glTF 2.0 fixture. No downloads or dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const SOURCE_ID = 'synthetic:linear-translation:object';
export const ROOT_ID = 'synthetic:linear-translation:root';
export const MESH_NODE_ID = 'synthetic:linear-translation:mesh';
export const CLIP_ID = 'synthetic-linear-1s';

const json = value => JSON.stringify(value, null, 2) + '\n';
const pad = (buffer, byte = 0) => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4, byte)]);

export function buildExample() {
  const positions = Buffer.alloc(4 * 3 * 4);
  [-.25, -.2, 0, .25, -.2, 0, .25, .2, 0, -.25, .2, 0]
    .forEach((v, i) => positions.writeFloatLE(v, i * 4));
  const indices = Buffer.alloc(6 * 2);
  [0, 1, 2, 0, 2, 3].forEach((v, i) => indices.writeUInt16LE(v, i * 2));
  const times = Buffer.alloc(2 * 4);
  [0, 1].forEach((v, i) => times.writeFloatLE(v, i * 4));
  const translations = Buffer.alloc(2 * 3 * 4);
  [0, .25, 0, 1, .25, 0].forEach((v, i) => translations.writeFloatLE(v, i * 4));
  const chunks = [positions, indices, times, translations].map(b => pad(b));
  let offset = 0;
  const views = chunks.map((b, i) => {
    const view = { buffer: 0, byteOffset: offset, byteLength: [positions, indices, times, translations][i].length };
    offset += b.length;
    return view;
  });
  const bin = Buffer.concat(chunks);
  const gltf = {
    asset: { version: '2.0', generator: 'AssetsPlatform animation-example/generate.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'SyntheticRoot', extras: { sourceId: ROOT_ID }, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], children: [1] },
      { name: 'MovingQuad', extras: { sourceId: MESH_NODE_ID }, mesh: 0, translation: [0, .25, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
    ],
    meshes: [{ name: 'SelfAuthoredQuad', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'SyntheticBlue', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [.12, .4, .9, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: bin.length }], bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-.25, -.2, 0], max: [.25, .2, 0] },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR', min: [0], max: [3] },
      { bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3', min: [0, .25, 0], max: [1, .25, 0] }
    ],
    animations: [{ name: 'LinearTranslationOneSecond', samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }],
    extras: { sourceId: SOURCE_ID, fixture: 'self-authored animation example; not source-game evidence' }
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(gltf)), 0x20);
  const glb = Buffer.alloc(28 + jsonChunk.length + bin.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(jsonChunk.length, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(glb, 20);
  glb.writeUInt32LE(bin.length, 20 + jsonChunk.length); glb.writeUInt32LE(0x004e4942, 24 + jsonChunk.length);
  bin.copy(glb, 28 + jsonChunk.length);
  const sidecar = {
    schemaVersion: 1, coordinateSystem: 'glTF', sourceId: SOURCE_ID,
    nodes: [
      { id: ROOT_ID, glbNodeIndex: 0, parentId: null, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { id: MESH_NODE_ID, glbNodeIndex: 1, parentId: ROOT_ID, translation: [0, .25, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
    ],
    clips: [{ id: CLIP_ID, name: '自制 1 秒线性平移', duration: 1, loop: false,
      limitations: ['合成刚性节点平移；不包含蒙皮、Animator、事件、物理、IK 或 morph。'],
      tracks: [{ nodeId: MESH_NODE_ID, path: 'translation', interpolation: 'LINEAR', times: [0, 1], values: [[0, .25, 0], [1, .25, 0]] }]
    }]
  };
  const files = {
    'assets/linear-translation.glb': glb,
    'assets/linear-translation.animation.json': Buffer.from(json(sidecar)),
    'assets/catalog.json': Buffer.from(json({ version: 1, assets: [{ id: 'mesh-synthetic-linear', name: '自制平移矩形网格', type: 'mesh', category: 'synthetic', modelUrl: 'assets/linear-translation.glb' }] })),
    'assets/objects-catalog.json': Buffer.from(json({ version: 1, objects: [{ id: 'object-synthetic-linear', sourceId: SOURCE_ID, name: '自制平移矩形', category: 'synthetic', modelUrl: 'assets/linear-translation.glb', assetId: 'mesh-synthetic-linear', description: '双节点刚性矩形；合成动画证据未经过浏览器 GPU 复验。' }] })),
    'assets/animation-catalog.json': Buffer.from(json({ version: 1, objects: [{ objectId: 'object-synthetic-linear', sourceId: SOURCE_ID, status: 'pending', modelUrl: 'assets/linear-translation.glb', dataUrl: 'assets/linear-translation.animation.json', playableClipIds: [CLIP_ID], verifiedPlayableClipIds: [], skinBindingVerified: false, sourceCurvesVerified: false, pixelVerified: false, limitations: ['待完成 CPU 数值、绑定与真实 WebGL 复验；不得仅为显示播放按钮更改验证字段。'] }] })),
    'assets/actions-catalog.json': Buffer.from(json({ version: 1, objects: [] })),
    'assets/render-profiles.json': Buffer.from(json({ version: 1, profiles: [], sources: [] }))
  };
  return { gltf, sidecar, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = new URL('./', import.meta.url);
  mkdirSync(new URL('assets/', base), { recursive: true });
  for (const [name, bytes] of Object.entries(buildExample().files)) writeFileSync(new URL(name, base), bytes);
}
