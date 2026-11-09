import { cp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
const preview = process.argv.includes('--preview');
if (preview) {
  const manifest = JSON.parse(await readFile('dist/manifest.webmanifest', 'utf8'));
  manifest.id = '/pecsoteka-preview'; manifest.name = 'PECSотека · превью'; manifest.short_name = 'PECSотека · превью';
  await writeFile('dist/manifest.webmanifest', JSON.stringify(manifest, null, 2) + '\n');
  await writeFile('dist/config.js', "export const DATABASE_NAME = 'pecsoteka-preview';\nexport const STORAGE_PREFIX = 'pecsoteka-preview-';\n");
  const sw = await readFile('dist/sw.js', 'utf8');
  await writeFile('dist/sw.js', sw.replaceAll('pecsoteka-', 'pecsoteka-preview-'));
}

for (const path of ['LICENSE', 'PERMISSIONS.md', 'THIRD_PARTY_NOTICES.md', 'licenses']) {
  await cp(path, join('dist', path), { recursive: true });
}
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))).flat().sort();
}
const list = await files('dist'), hash = createHash('sha256');
for (const file of list) { hash.update(file); hash.update(await readFile(file)); }
const revision = hash.digest('hex').slice(0, 12);
const sw = await readFile('dist/sw.js', 'utf8');
await writeFile('dist/sw.js', sw.replace(/const CACHE = '([^']+)'/, (_, name) => `const CACHE = '${name}-${revision}'`));
await writeFile('dist/.nojekyll', '');
console.log(`PECSотека 0.2.0-preview.1 built: ${list.length} files, cache ${revision}`);
