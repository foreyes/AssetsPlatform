/** Resolve only needed immutable catalog shards; no external URLs, no credentials. */
export async function resolveSelectionAssets(catalog,ids,readShard) {
 const wanted=new Set(ids),pending=[...ids],assets=[],cache=new Map();
 while(pending.length){const id=pending.pop(),pointer=catalog.assets[id];if(!pointer)continue;
  let asset=pointer;
  if(typeof pointer==='string'){
   if(!/^\/delivery-shards\/[0-9a-f]{2}\.json(?:\.gz)?$/.test(pointer))throw Error('invalid-catalog-shard');
   if(!cache.has(pointer))cache.set(pointer,await readShard(pointer));asset=cache.get(pointer)[id];
  }
  if(!asset||asset.id!==id)throw Error('missing-catalog-asset');assets.push(asset);
  for(const dep of asset.dependencyIds||[])if(!wanted.has(dep)){wanted.add(dep);pending.push(dep)}
 }
 return assets;
}

/** Compressed metadata is transport-only; original preview payloads stay byte-identical. */
export async function fetchDeliveryShard(path) {
 const response=await fetch(path,{credentials:'same-origin'});
 if(!response.ok)throw Error('资源分片读取失败');
 if(path.endsWith('.gz')){
  if(typeof DecompressionStream!=='function')throw Error('请使用支持 gzip 解压的新版浏览器导出 manifest');
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
 }
 return response.json();
}
