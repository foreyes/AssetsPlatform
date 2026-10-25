import fs from 'node:fs';import {emitFrontend} from '../review-frontend/emit.mjs';
const descriptor=JSON.parse(fs.readFileSync('asset-source/project-config.json'));
const result=emitFrontend({destination:'asset-source',descriptor,viewerSource:descriptor.renderer.kind==='three'?'asset-source/viewer.js':null});
fs.writeFileSync('review-frontend-build.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({canonicalFrontend:true,projectId:result.projectId,mainSHA256:result.hashes['app.mjs']}));
