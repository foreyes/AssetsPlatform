// Official Sites Worker build, with reproducible minimal static publication.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const run=file=>{const r=spawnSync(process.execPath,[file],{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);};
run('scripts/sync-canonical-frontend.mjs');run('scripts/verify-asset-pilot.mjs');run('scripts/verify-native-sample.mjs');run('scripts/verify-native-batch.mjs');run('scripts/lock-renderer-build.mjs');run('scripts/build-publication.mjs');run('scripts/reuse-model-bundles.mjs');run('scripts/build-batch877-r2-plan.mjs');
fs.rmSync('public/entity',{recursive:true,force:true});fs.mkdirSync('public',{recursive:true});fs.cpSync('out','public/entity',{recursive:true});
// The canonical source directory remains a reproducible fallback, but the
// publication must not shadow the authenticated dynamic ready directory.
fs.rmSync('public/entity/project-directory.json',{force:true});
fs.rmSync('public/entity/supplemental-preview-links.json',{force:true});
const batch=JSON.parse(fs.readFileSync('lib/generated/native-asset-batch.json'));
fs.rmSync('public/__entity_assets',{recursive:true,force:true});fs.rmSync('public/__entity_static_fallback',{recursive:true,force:true});fs.mkdirSync('public/__entity_static_fallback/__entity_assets',{recursive:true});fs.cpSync('batch/native-batch/payload','public/__entity_static_fallback/__entity_assets/'+batch.version,{recursive:true});
fs.rmSync('public/__entity_bundles',{recursive:true,force:true});fs.cpSync('.sites-runtime/model-bundles/payload','public/__entity_static_fallback/__entity_bundles',{recursive:true});
const r=spawnSync(process.execPath,['scripts/run-framework.mjs','build'],{stdio:'inherit'});if(r.error)throw r.error;process.exit(r.status??1);
