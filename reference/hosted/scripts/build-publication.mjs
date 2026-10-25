// Reproducible lightweight publish projection. Never edits/deletes source assets or evidence.
import {prepareReviewedM3} from './prepare-reviewed-m3.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const source='asset-source',out='out',read=p=>JSON.parse(fs.readFileSync(p)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const classification=read('batch/publication/classification.json'),catalog=read(source+'/data/catalog.json'),library=read(source+'/library-manifest.json'),baseline=read('tests/fixtures/live-v7-library-manifest.json');
if(classification.counts.sourceTotal!==1664||classification.entities.length!==catalog.entities.length)throw Error('Classification denominator mismatch');
const byId=new Map(classification.entities.map(e=>[e.entityId,e])),quarantined=new Set(classification.entities.filter(e=>e.publicationState==='quarantined').map(e=>e.entityId));
for(const e of catalog.entities)if(!byId.has(e.id))throw Error('Unclassified source identity '+e.id);
const allSourceAssets=library.sources.flatMap(s=>s.assets),knownAssets=new Map(allSourceAssets.map(a=>[a.resource_id,a]));
const prior=baseline.sources.flatMap(s=>s.assets),bundled=new Set();
for(const a of prior){const current=knownAssets.get(a.resource_id);if(!current||current.preview_uri!==a.preview_uri||(current.preview_sha256||current.sha256)!==(a.preview_sha256||a.sha256))throw Error('Live fixture identity changed: '+a.resource_id);if(a.coverage!=='associated-model'&&a.entity_ids?.some(id=>quarantined.has(id)))throw Error('A live fixture is now quarantined');bundled.add(a.resource_id);}
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const copy=relative=>{if(relative.includes('..')||path.isAbsolute(relative))throw Error('Unsafe publication path');const target=path.join(out,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,relative),target);};
const walk=relative=>{for(const ent of fs.readdirSync(path.join(source,relative),{withFileTypes:true})){const p=path.posix.join(relative,ent.name);if(ent.isDirectory())walk(p);else copy(p);}};
for(const name of fs.readdirSync(source))if(!['viewer-ui.js','visible-preview-grid.js'].includes(name)&&(/\.(js|mjs|css|svg)$/.test(name)||['index.html','project-config.json','project-directory.json'].includes(name)))copy(name);
walk('vendor');walk('shared');walk('adapters');walk('data');
const emitted=[];
for(const s of library.sources){s.assets=s.assets.filter(a=>{const ids=a.entity_ids||[];return !(ids.length&&ids.every(id=>quarantined.has(id))&&a.coverage!=='associated-model');}).map(a=>{
 const next={...a};delete next.poster_uri;delete next.transport;next.sourceRepresentation={status:a.status,sha256:a.preview_sha256||a.sha256,bytes:a.bytes,scope:a.coverage};
 if(bundled.has(a.resource_id)){const bytes=fs.readFileSync(path.join(source,a.preview_uri));if(hash(bytes)!==(a.preview_sha256||a.sha256)||bytes.length!==a.bytes)throw Error('Bundled bytes/hash mismatch: '+a.resource_id);copy(a.preview_uri);emitted.push({resourceId:a.resource_id,path:a.preview_uri,sha256:hash(bytes),bytes:bytes.length,format:a.format});}
 else{next.preview_uri=null;next.delivery={status:'unavailable',reason:'delivery-not-configured'};}
 return next;
 });}
// One audited native-archive sample is independently complete, not a ready full corpus.
const sample=read('lib/generated/native-asset-sample.json');
if(sample.manifest.completeCorpusReady!==false||sample.manifest.uploadEnabled!==false||sample.manifest.modelCount!==1)throw Error('Sample scope widened');
let sampleMatches=0;
for(const source of library.sources)source.assets=source.assets.map(asset=>{
 if(asset.resource_id!==sample.manifest.resourceId)return asset;
 if(asset.entity_ids?.some(id=>quarantined.has(id))||bundled.has(asset.resource_id))throw Error('Sample conflicts with quarantine or baseline');
 sampleMatches++;return {...asset,...sample.manifest.asset,sourceRepresentation:asset.sourceRepresentation};
});
if(sampleMatches!==1)throw Error('Sample identity mismatch');
// Batch declarations are separately verified against tracked original source and exact closure.
const batchDeclarations=read('batch/native-batch/declarations.json'),batchSummary=read('batch/native-batch/manifest.json'),batchByID=new Map(batchDeclarations.map(a=>[a.resource_id,a]));
if(batchSummary.selectedCompleteStatic!==877||batchSummary.payloadBytes>20000000||batchSummary.fullCorpusReady!==false||batchSummary.uploadEnabled!==false)throw Error('Batch scope changed');
let batchMatches=0;
for(const source of library.sources)source.assets=source.assets.map(asset=>{const replacement=batchByID.get(asset.resource_id);if(!replacement)return asset;
 if(asset.entity_ids?.some(id=>quarantined.has(id))||bundled.has(asset.resource_id)||replacement.coverage!=='static-assembly')throw Error('Batch conflicts with original boundary');
 batchMatches++;const next={...asset,...replacement,sourceRepresentation:asset.sourceRepresentation};delete next.nativeReadOnlySample;return next;
});
if(batchMatches!==877)throw Error('Batch identity count mismatch');
const primary=new Map();for(const s of library.sources)for(const a of s.assets)if(a.coverage!=='associated-model')for(const id of a.entity_ids||[])if(!primary.has(id))primary.set(id,a);
for(const e of catalog.entities){const c=byId.get(e.id);e.publication={state:c.publicationState,entityKind:c.entityKind,reasonCodes:c.reasonCodes,reason:c.reason,childReferenceCount:c.childReferenceCount||0,needsOverrideResolution:c.needsOverrideResolution,readiness:c.publicationState==='quarantined'?'evidence_only_not_render_validated':'scope_only_not_render_validation'};
 if(e.preview&&e.preview.coverage!=='2d-source-sprite'){const a=primary.get(e.id)||allSourceAssets.find(a=>a.coverage!=='associated-model'&&a.entity_ids?.includes(e.id));if(!a)throw Error('No representation identity for '+e.id);e.preview={...e.preview,kind:'model',url:null,images:[],resourceId:a.resource_id,representationState:'converted',browserFrameGenerated:false};delete e.preview.modelUrl;}
}
const folder=read(source+'/folder-adapter/manifest.json');for(const s of folder.sources)for(const a of s.assets){delete a.poster_uri;delete a.transport;const uri='folder-adapter/'+a.preview_uri;copy(uri);emitted.push({resourceId:a.resource_id,path:uri,sha256:hash(fs.readFileSync(source+'/'+uri)),bytes:fs.statSync(source+'/'+uri).size,format:a.format});}
const summary={schemaVersion:'entity-publication/1',sourceTotal:catalog.entities.length,eligible:classification.counts.eligible,quarantined:quarantined.size,eligibleWithGLB:classification.counts.eligibleWithGLB,quarantinedWithGLB:classification.counts.quarantinedWithGLB,bundledStaticFixtures:prior.filter(a=>a.coverage==='static-assembly').length,bundledGLBResources:emitted.filter(a=>a.format==='glb').length,bundledSourceImages:emitted.filter(a=>a.format!=='glb').length,externalDelivery:'not-configured',runtimeComplete:0,browserGPUValidation:'not-performed',sourceClassificationSHA256:hash(fs.readFileSync('batch/publication/classification.json')),rendererBuildSHA256:hash(fs.readFileSync(source+'/renderer-build.js')),sourceEvidencePreserved:true,prebuiltThumbnailsPublished:0};
summary.nativeReadOnlySample={resourceId:sample.manifest.resourceId,name:sample.manifest.asset.name,version:sample.manifest.version,modelCount:1,fileCount:sample.manifest.fileCount,payloadBytes:sample.manifest.payloadBytes,remainingClosedBindings:sample.manifest.remainingClosedBindings,completeCorpusReady:false,uploadEnabled:false,R2Configured:false};
summary.nativeReadOnlyBatch={version:batchSummary.version,deliveryKind:'same-origin-static',authorizationBoundary:'existing-sites-custom-owner-plus-three-viewers',completeStatic:877,allCompleteStatic:992,remainingCompleteStatic:115,remainingClosedBindings:526,fileCount:2497,payloadBytes:batchSummary.payloadBytes,modelsWithTextures:688,distinctImageDependencies:42,fullCorpusReady:false,uploadEnabled:false,R2Configured:false,originalShadersVerified:false};
catalog.publicationSummary=summary;library.publicationSummary=summary;
const write=(p,value)=>{fs.mkdirSync(path.dirname(out+'/'+p),{recursive:true});fs.writeFileSync(out+'/'+p,JSON.stringify(value)+'\n');};
write('data/catalog.json',catalog);write('library-manifest.json',library);write('folder-adapter/manifest.json',folder);
write('publication.json',{...summary,resources:emitted,quarantinedEntities:classification.entities.filter(e=>quarantined.has(e.entityId)).map(e=>({entityId:e.entityId,entityKind:e.entityKind,reasonCodes:e.reasonCodes,childReferenceCount:e.childReferenceCount,needsOverrideResolution:e.needsOverrideResolution,readiness:'evidence_only_not_render_validated'}))});
for(const e of catalog.entities){const p='data/entities/'+e.id+'.json',detail=read(out+'/'+p);detail.publication=e.publication;write(p,detail);}
prepareReviewedM3();
console.log(JSON.stringify(summary,null,2));
