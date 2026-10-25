import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['tests', 'incremental-candidate', 'review-frontend/tests', 'shared-core/render-profile-registry-0.2.0/tests'];
function discover(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? discover(file) : /\.test\.(?:mjs|js)$/.test(entry.name) ? [file] : [];
  });
}
const files = roots.flatMap(dir => discover(path.join(root, dir))).sort();
if (process.argv.includes('--list')) console.log(files.map(file => path.relative(root, file)).join('\n'));
else {
  const result = spawnSync(process.execPath, ['--test', ...files], {cwd: root, stdio: 'inherit'});
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
