// Preserve legal zero-scale / singular source matrices. Three r170's automatic
// matrix decomposition can produce NaN quaternions for these static nodes.
// This does not change geometry, UVs, axes, visibility or any matrix coefficient.
export function applyExactSourceMatrices(gltf,json){
 const definitions=json.nodes||[];if(!definitions.some(n=>n.matrix))return 0;
 const associations=gltf.parser?.associations;if(!associations)throw Error('GLTF 源节点映射不可用');
 let count=0;const visited=new Set();
 for(const root of gltf.scenes||[gltf.scene])root?.traverse(object=>{
  if(visited.has(object))return;visited.add(object);
  const index=associations.get(object)?.nodes,matrix=definitions[index]?.matrix;
  if(!matrix)return;
  if(matrix.length!==16||!matrix.every(Number.isFinite))throw Error('GLTF 源矩阵无效');
  // Finite unused TRS fields avoid propagating decomposition NaNs into helpers.
  // The exact source matrix is authoritative with matrixAutoUpdate disabled.
  object.position.set(0,0,0);object.quaternion.identity();object.scale.set(1,1,1);
  object.matrix.fromArray(matrix);object.matrixAutoUpdate=false;object.matrixWorldNeedsUpdate=true;count++;
 });
 for(const root of gltf.scenes||[gltf.scene])root?.updateMatrixWorld(true);
 return count;
}
