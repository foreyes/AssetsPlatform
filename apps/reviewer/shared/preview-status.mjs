// Original image evidence is distinct from a card thumbnail and from technical texture usage.
export function declaredDimension(item) {
  const declared = item.dimension || item.representationDimension || item.facets?.dimension;
  if (['2D','3D','mixed','unknown'].includes(declared)) return declared;
  if (item.modelUrl || item.modelAsset) return '3D';
  if (item.isObject && (item.imageUrl || item.originalUrl) && !item.modelUrl) return '2D';
  return 'unknown';
}
export function imageObjectPreviewLabel(item) {
  if (!item.isObject || item.modelUrl || item.modelAsset) return null;
  const dimension=declaredDimension(item);
  if (dimension==='2D' && (item.imageUrl || item.originalUrl)) return '独立 2D 原图预览 · 外观未验证';
  if (item.previewUrl || item.thumbnailUrl) return '仅缩略图 · 完整预览待补';
  return '已索引 · 尚无完整预览';
}
