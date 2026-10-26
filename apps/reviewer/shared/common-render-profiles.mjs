// Six self-authored, catalogue-independent inspection presets. They change only
// browser lighting/material presentation; no profile reconstructs a source engine.
const light = {
  lightDirection: [0.4, 0.7, 0.6],
  ambientColor: [1, 1, 1],
  ambientStrength: 0.5,
  keyLightColor: [1, 1, 1],
  keyLightStrength: 0.8,
  baseTint: [1, 1, 1],
  saturation: 1,
  contrast: 1
};
const profile = (id, label, mode, parameters, description) => ({
  id, label, mode, parameters, implemented: true,
  status: 'browser-inspection', description,
  unsupportedFeatures: ['Source-engine shaders, scene lighting, and post-processing']
});
export const COMMON_RENDER_PROFILES = [
  profile('material', 'GLB 材质', 'material', {}, '显示受支持的 GLB 材质属性；仅为浏览器检视。'),
  profile('clay', '中性白模', 'clay', {...light, baseTint: [1, 1, 1]}, '统一浅色表面，便于检查轮廓和几何。'),
  profile('toon', '三阶明暗', 'toon', {...light, bands: 3, lightThreshold: 0.5, shadowColor: [0.45, 0.5, 0.55]}, '以三阶明暗检查形体可读性。'),
  profile('neutral-soft', '柔和中性', 'material', {...light, ambientStrength: 0.6, keyLightStrength: 0.55, saturation: 0.85, contrast: 0.9}, '降低对比度以检查材质和轮廓。'),
  profile('cool-bands', '冷调双阶', 'toon', {...light, bands: 2, lightThreshold: 0.5, shadowColor: [0.45, 0.55, 0.7], baseTint: [0.96, 0.98, 1]}, '自定义冷调双阶明暗；不代表来源风格。'),
  profile('warm-bands', '暖调双阶', 'toon', {...light, bands: 2, lightThreshold: 0.5, shadowColor: [0.7, 0.55, 0.4], baseTint: [1, 0.98, 0.95]}, '自定义暖调双阶明暗；不代表来源风格。')
];
export function commonIndexedProfiles(existing = []) {
  const map = new Map(COMMON_RENDER_PROFILES.map(p => [p.id, structuredClone(p)]));
  for (const p of existing) {
    if (!map.has(p.id)) map.set(p.id, p); // Explicit catalogue extras cannot redefine the core presets.
  }
  return [...map.values()];
}
