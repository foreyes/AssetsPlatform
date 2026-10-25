import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Deliberately separate from the corpus-bound private Worker publication build.
// The only supported public build is the included synthetic static reviewer.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'apps/reviewer');
const destination = path.join(root, 'dist/reviewer');
const inputs = JSON.parse(fs.readFileSync(path.join(root, 'scripts/public-build-inputs.json'), 'utf8'));
if (!Array.isArray(inputs) || new Set(inputs).size !== inputs.length) throw new Error('invalid public build allowlist');
function noSymlink(file, base) {
  let current = base;
  for (const segment of path.relative(base, file).split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('symlink not permitted in public build');
  }
}
// Validate all inputs before replacing an existing build. Unlisted files never copy.
const records = inputs.map(relative => {
  if (typeof relative !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(relative)
      || relative.split('/').some(p => !p || p === '..' || p.startsWith('.')))
    throw new Error('unsafe public build path');
  const file = path.join(source, relative);
  noSymlink(file, root);
  if (!fs.statSync(file).isFile()) throw new Error('public build input must be a file');
  const bytes = fs.readFileSync(file);
  return {relative, bytes, sha256: createHash('sha256').update(bytes).digest('hex')};
});
noSymlink(destination, root);
fs.rmSync(destination, {recursive: true, force: true});
fs.mkdirSync(destination, {recursive: true});
for (const {relative, bytes} of records) {
  fs.mkdirSync(path.dirname(path.join(destination, relative)), {recursive: true});
  fs.writeFileSync(path.join(destination, relative), bytes);
}
const manifest = {
  profile: 'public-synthetic-static-v1',
  capabilities: {staticReview: true, hostedAuthentication: false, backendIngestion: false, fixedPrivatePilots: false},
  files: Object.fromEntries(records.map(({relative, sha256}) => [relative, sha256]))
};
fs.writeFileSync(path.join(destination, 'build-manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
console.log(JSON.stringify({profile: manifest.profile, output: 'dist/reviewer', files: records.length}));
