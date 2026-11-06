"""Read a current local importer version; produce bounded MCP JSON arguments.
No network, credentials, production writes or source export/conversion.
"""
import argparse,base64,hashlib,importlib.util,json,pathlib,re,subprocess,sys
p=argparse.ArgumentParser();p.add_argument('--importer',required=True);p.add_argument('--store',required=True);p.add_argument('--dataset',default='verified');p.add_argument('--version');p.add_argument('--out',required=True);a=p.parse_args()
if re.fullmatch(r'[A-Za-z0-9_-]{1,64}',a.dataset) is None:p.error('--dataset must contain 1–64 ASCII letters, digits, underscores or hyphens')
module=pathlib.Path(a.importer).resolve();sys.path.insert(0,str(module.parent));spec=importlib.util.spec_from_file_location('existing_local_importer',module);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
root,marker=m.open_store(a.store);version=a.version or m.current_version(root);doc=m.validate_version(root,version);project=doc['scope']['rootId']
if project not in ['HamstersAway','CozyIsland','ParadiseMarsh','Sulfur']:raise ValueError('Project is not in the four-project allowlist')
ledger={e['id']:e for e in doc['sourceLedger']};files=[];blocks={}
for f in doc['snapshot']['files']:
 if f['path'].split('.')[-1].lower() not in ['glb','png','json']:raise ValueError('Unsupported normalized static package file: '+f['path'])
 desc=m.verify_object(root,f['sha256'],f['bytes']);data=b''.join(m.read_file(root/'blocks'/b['sha256'],m.CHUNK) for b in desc['chunks']);assert hashlib.sha256(data).hexdigest()==f['sha256'];parts=[]
 for i in range(0,len(data),32768):
  block=data[i:i+32768];sha=hashlib.sha256(block).hexdigest();parts.append({'sha256':sha,'bytes':len(block)});blocks[sha]=base64.b64encode(block).decode()
 entry=ledger[f['id']];files.append({k:f[k] for k in ['id','path','sha256','bytes','metadata','revision']}|{k:entry[k] for k in ['sourceId','identityKind','dependencyDetection','dependencies']}|{'blocks':parts})
manifest={'schema':'entity-incremental-indexed/1','projectId':project,'datasetId':a.dataset,'adapter':'indexed-v1','animation':'metadata-only','files':files}
try:
 # Escape lone surrogates as JSON while keeping ordinary Unicode compact.
 payload=json.dumps(manifest,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8','backslashreplace')
 validation=subprocess.run(['node',str(pathlib.Path(__file__).with_name('validate-manifest.mjs'))],input=payload,capture_output=True,check=False)
except (OSError,ValueError) as error:p.error('Hosted manifest validation unavailable: '+str(error))
if validation.returncode:p.error(validation.stderr.decode('utf-8','replace').strip() or 'Hosted manifest validation failed')
output=m.no_links(a.out);assert not output.exists();assert not m.overlaps(output,root);m.create_json(output,{'manifest':manifest,'blocks':blocks});print(json.dumps({'status':'exported-local-arguments-only','files':len(files),'uniqueBlocks':len(blocks),'sourceProject':project,'networkWrites':False}))
