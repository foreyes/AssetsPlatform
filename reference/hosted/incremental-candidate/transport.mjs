// Same driver accepts official connector tool callbacks or isolated local MCP.
// It has no credentials, filesystem target, URL, or direct production HTTP client.
import {validateManifest} from './manifest.mjs';
export async function applyIncremental({bundle,baseVersion=null,call}){
 const v=await validateManifest(bundle.manifest),common={projectId:v.manifest.projectId,datasetId:v.manifest.datasetId,version:v.version};
 const begin=await call('entity_assets_begin',{manifest:bundle.manifest,baseVersion});if(begin.noop)return {...begin,blocksCreated:0,objectsCreated:0};let blocksCreated=0,objectsCreated=0,reconciledResults=0;
 for(const f of v.unique){const current=await call('entity_assets_check_file',{...common,sha256:f.sha256});if(current.verified)continue;
  for(const b of f.blocks){const args={...common,sha256:b.sha256};if((await call('entity_assets_check_block',args)).verified)continue;let result;try{result=await call('entity_assets_put_block',{...args,base64:bundle.blocks[b.sha256]})}catch(error){if(!(await call('entity_assets_check_block',args)).verified)throw error;reconciledResults++;continue}if(result.created)blocksCreated++;}
  try{const result=await call('entity_assets_commit_file',{...common,sha256:f.sha256});if(result.created)objectsCreated++}catch(error){if(!(await call('entity_assets_check_file',{...common,sha256:f.sha256})).verified)throw error;reconciledResults++}
 }
 let ready;try{ready=await call('entity_assets_finalize',common)}catch(error){ready=await call('entity_assets_status',common);if(!ready.ready)throw error;reconciledResults++}
 return {...ready,blocksCreated,objectsCreated,reconciledResults,createCountersComplete:reconciledResults===0};
}
