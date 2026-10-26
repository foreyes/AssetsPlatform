import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseGLB, PREVIEW_LIMITS} from '../apps/reviewer/viewer.mjs';
import {validateProjectDescriptor,validateProjectStorage,validateCatalogData} from '../apps/reviewer/shared/project-schema.mjs';
import {indexGLBDependencies as buildGLBDependencyIndex} from './index-glb-dependencies.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/reviewer');
export const IMPORT_LIMITS = Object.freeze({models:512, entries:10000, depth:32, totalBytes:256*1024*1024, indexRecords:10000, catalogBytes:16*1024*1024});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);
function noLinks(target) {
  let current = path.parse(target).root;
  for (const segment of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Symbolic links are not accepted: '+current);
  }
}
// The importer accepts the closed two-chunk GLB profile, not ambiguous duplicate chunks.
function embeddedDocument(bytes) {
  if(bytes.length<28 || bytes.readUInt32LE(0)!==0x46546c67 || bytes.readUInt32LE(4)!==2 || bytes.readUInt32LE(8)!==bytes.length) throw Error('Invalid GLB 2.0 header');
  const jsonLength=bytes.readUInt32LE(12);
  if(bytes.readUInt32LE(16)!==0x4e4f534a || jsonLength%4 || jsonLength>PREVIEW_LIMITS.jsonBytes || 28+jsonLength>bytes.length) throw Error('Invalid GLB JSON chunk or budget');
  const binOffset=20+jsonLength, binLength=bytes.readUInt32LE(binOffset);
  if(bytes.readUInt32LE(binOffset+4)!==0x004e4942 || binLength%4 || binOffset+8+binLength!==bytes.length) throw Error('Expected exactly one JSON and one BIN chunk');
  return JSON.parse(bytes.subarray(20,binOffset).toString('utf8').replace(/\0+$/,''));
}
function json(file, value) { fs.writeFileSync(file, JSON.stringify(value,null,2)+'\n', {flag:'wx'}); }
// This is an explicit local export, never a public build or a source-directory mutation.
export function importDirectory({source, output, id, label=id, indexGLBDependencies=false}) {
  if (!source || !output || !/^[a-z][a-z0-9-]{0,63}$/.test(id || '')) throw Error('Required: --source folder --output NEW-folder --id lowercase-project-id');
  if (typeof label !== 'string' || !label.trim() || label.length>160) throw Error('Label must contain 1–160 characters');
  if(typeof indexGLBDependencies!=='boolean') throw Error('indexGLBDependencies must be boolean');
  source=path.resolve(source); output=path.resolve(output);
  noLinks(source); noLinks(path.dirname(output));
  if (!fs.statSync(source).isDirectory()) throw Error('Source must be a directory');
  if (within(output,root) || within(output,source) || within(source,output)) throw Error('Output must be outside source and platform repository');
  if (fs.existsSync(output)) throw Error('Output already exists; nothing overwritten');
  const files=[]; let entries=0, totalBytes=0, indexRecordCount=0;
  function scan(dir, depth=0) {
    if (depth>IMPORT_LIMITS.depth) throw Error('Directory depth limit exceeded');
    for (const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
      if (++entries>IMPORT_LIMITS.entries) throw Error('Directory entry limit exceeded');
      if (e.name.startsWith('.')) continue;
      const file=path.join(dir,e.name);
      if (e.isSymbolicLink()) throw Error('Symbolic links are not accepted: '+file);
      if (e.isDirectory()) scan(file,depth+1);
      else if (e.isFile() && /\.glb$/i.test(e.name)) {
        if (files.length>=IMPORT_LIMITS.models) throw Error('Model count limit exceeded');
        const fd=fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        let bytes;
        try {
          const stat=fs.fstatSync(fd);
          if (!stat.isFile() || stat.size>PREVIEW_LIMITS.downloadBytes || stat.size+totalBytes>IMPORT_LIMITS.totalBytes) throw Error('Model byte budget exceeded');
          bytes=Buffer.alloc(stat.size);
          let offset=0;
          while(offset<bytes.length) { const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset); if(!n) throw Error('Source changed during read'); offset+=n; }
          if(fs.fstatSync(fd).size!==stat.size) throw Error('Source changed during read');
        } finally { fs.closeSync(fd); }
        const doc=embeddedDocument(bytes);
        // Fail closed on every external buffer/image URI, even if unused by the scene.
        if ((doc.buffers||[]).some(b=>b.uri!==undefined) || (doc.images||[]).some(i=>i.uri!==undefined && !/^data:image\/(png|jpeg);base64,/.test(i.uri))) throw Error('GLB must contain its buffers and images: '+e.name);
        const geometry=parseGLB(bytes);
        totalBytes+=bytes.length;
        const relative=path.relative(source,file).split(path.sep).join('/');
        const key=hash(relative),sha256=hash(bytes);
        const dependencyIndex=indexGLBDependencies?buildGLBDependencyIndex({doc,bytes,relative,key,sourceSha256:sha256,maxRecords:IMPORT_LIMITS.indexRecords-indexRecordCount-1}):null;
        if(dependencyIndex && ++indexRecordCount+dependencyIndex.assets.length>IMPORT_LIMITS.indexRecords) throw Error('GLB dependency index budget exceeded');
        if(dependencyIndex) indexRecordCount+=dependencyIndex.assets.length;
        files.push({relative,bytes,sha256,key,name:path.basename(file,path.extname(file)).trim() || 'Model '+key.slice(0,12),vertices:geometry.vertices,triangles:geometry.triangles,warnings:geometry.warnings,dependencyIndex});
      }
    }
  }
  scan(source);
  if (!files.length) throw Error('No visible .glb files found; nothing created');
  const datasetId='glb-'+hash(JSON.stringify(files.map(f=>[f.relative,f.sha256])));
  const descriptor=JSON.parse(fs.readFileSync(path.join(app,'demo-a/project-config.json'),'utf8'));
  Object.assign(descriptor,{id,datasetId});
  Object.assign(descriptor.config,{slug:id,label,reviewKey:`${id}:${datasetId}:reviews`,renderPreferenceKey:`${id}:${datasetId}:profile`,importFormat:'asset-review-local-glb',exportPrefix:id,auditSections:[{title:'本地 GLB 目录',text:'由明确选择的本地文件夹导入。仅完成 CPU 解析；GPU、材质外观与资产权利未验证。原生动画不自动启用。'}]});
  descriptor.categoryLabels={model:'模型'};
  if(indexGLBDependencies) descriptor.typeLabels={...descriptor.typeLabels,'mesh-definition':'网格定义',primitive:'图元定义',material:'材质定义',texture:'纹理定义',image:'图像定义',node:'节点定义',scene:'场景定义'};
  const fileAssets=files.map(f=>({id:'mesh-'+f.key,name:f.name,type:'mesh',category:'model',modelUrl:`assets/${f.key}.glb`,vertexCount:f.vertices,triangleCount:f.triangles,
    ...(indexGLBDependencies?{sourceFileSha256:f.sha256,provenance:{sourceFile:f.relative,evidence:'selected GLB file'},animationFacts:f.dependencyIndex.animationFacts,...f.dependencyIndex.links}:{} )}));
  const assets=indexGLBDependencies?files.flatMap((f,i)=>[fileAssets[i],...f.dependencyIndex.assets]):fileAssets;
  const objects=fileAssets.map((a,i)=>({...a,id:a.id.replace('mesh-','object-'),type:'object',assetId:a.id,assemblyStatus:'CPU parsed; GPU unverified',
    ...(indexGLBDependencies?{assetIds:[a.id,...files[i].dependencyIndex.assets.map(item=>item.id)],
      notes:['GLB 内部记录只作关系与来源审阅；并非独立可渲染物件，材质外观与 GPU 均未验证。']}:{} )}));
  if(indexGLBDependencies && (assets.length>IMPORT_LIMITS.indexRecords || Buffer.byteLength(JSON.stringify({version:1,assets}))>IMPORT_LIMITS.catalogBytes)) throw Error('GLB dependency index budget exceeded');
  validateProjectDescriptor(descriptor,{id});
  validateProjectStorage([descriptor]);
  validateCatalogData({catalog:{version:1,assets},objectCatalog:{version:1,objects}});
  // Exclusive creation prevents replacing any existing workspace, including concurrent runs.
  fs.mkdirSync(output);
  try {
    const allowlist=JSON.parse(fs.readFileSync(path.join(root,'scripts/public-build-inputs.json'),'utf8'));
    for (const relative of [...allowlist.filter(p=>!p.startsWith('demo-')&&!p.startsWith('animation-example/')&&!p.startsWith('tests/')&&p!=='project-directory.json'),'server.mjs','serve.py','validate-workspace.mjs']) {
      const input=path.join(app,relative); noLinks(input);
      const target=path.join(output,relative); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.copyFileSync(input,target,fs.constants.COPYFILE_EXCL);
    }
    fs.mkdirSync(path.join(output,'library/assets'),{recursive:true});
    fs.copyFileSync(path.join(app,'demo-a/assets/preview-pending.svg'),path.join(output,'library/assets/preview-pending.svg'),fs.constants.COPYFILE_EXCL);
    json(path.join(output,'project-directory.json'),{schema:'asset-review-project-directory/1',defaultProject:id,projects:[{id,label,config:'library/project-config.json',assetRoot:'./'}]});
    json(path.join(output,'library/project-config.json'),descriptor);
    json(path.join(output,'library/assets/catalog.json'),{version:1,assets});
    json(path.join(output,'library/assets/objects-catalog.json'),{version:1,objects});
    json(path.join(output,'library/assets/render-profiles.json'),{profiles:[]});
    for (const f of files) fs.writeFileSync(path.join(output,'library/assets',f.key+'.glb'),f.bytes,{flag:'wx'});
    const report={schema:'asset-review-local-import/1',projectId:id,datasetId,models:files.length,totalBytes,gpu:'not-verified',animations:'not-enabled',
      ...(indexGLBDependencies?{dependencyIndex:{schema:'gltf-internal-index/1',imageExtraction:'not-implemented',files:files.length,
        ...files.reduce((all,f)=>{for(const [k,v] of Object.entries(f.dependencyIndex.summary)) all[k]=(all[k]||0)+v;return all;},{})}}:{}),
      files:files.map(({bytes,dependencyIndex,...f})=>indexGLBDependencies?{...f,dependencyIndex:dependencyIndex.summary}:f)};
    json(path.join(output,'import-report.json'),report);
    fs.writeFileSync(path.join(output,'README.txt'),'Local AssetsPlatform workspace\n\nValidate: node validate-workspace.mjs\nRun: node server.mjs (or python3 serve.py)\nOpen: http://127.0.0.1:8768/\nNo installation or account required. Keep this folder private.\nReview state is stored in this browser, not this folder: use Export catalog for a complete JSON review backup before clearing browser data. JSON backups do not contain models.\nDo not edit dataset IDs to bypass review isolation. Reimporting changed content creates a new dataset identity.\nCPU parsing passed; GPU/material appearance, animation, and asset redistribution rights are not verified. See import-report.json for per-model warnings and relative source names.\n',{flag:'wx'});
    return {output,projectId:id,datasetId,models:files.length,totalBytes,
      ...(indexGLBDependencies?{dependencyIndex:report.dependencyIndex}:{}),
      warnings:files.flatMap(f=>f.warnings.map(w=>`${f.relative}: ${w}`))};
  } catch (error) { fs.rmSync(output,{recursive:true,force:true}); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2), opts={};
    if(args.includes('--help')) { console.log('npm run import:directory -- --source <GLB-folder> --output <new-folder-outside-repository> --id <project-id> [--label <display-name>] [--index-glb-dependencies]'); process.exit(0); }
    for(let i=0;i<args.length;i++) { const key=args[i].slice(2); if(!args[i].startsWith('--')) throw Error('Unknown option: '+args[i]);
      if(key==='index-glb-dependencies'){if(opts.indexGLBDependencies!==undefined) throw Error('Duplicate option: '+args[i]);opts.indexGLBDependencies=true;continue;}
      if(!['source','output','id','label'].includes(key)||!args[i+1]||args[i+1].startsWith('--')||opts[key]!==undefined) throw Error('Unknown, duplicate, or missing option: '+args[i]); opts[key]=args[++i]; }
    console.log(JSON.stringify(importDirectory(opts),null,2));
  } catch(error) { console.error('Import failed: '+error.message); process.exitCode=1; }
}
