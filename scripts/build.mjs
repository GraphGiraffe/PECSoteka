import { cp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))).flat().sort();
}
const list = await files('dist'), hash = createHash('sha256');
for (const file of list) { hash.update(file); hash.update(await readFile(file)); }
const revision = hash.digest('hex').slice(0, 12);
const sw = await readFile('dist/sw.js', 'utf8');
await writeFile('dist/sw.js', sw.replace("const CACHE = 'pecsoteka-0.1.1'", `const CACHE = 'pecsoteka-0.1.1-${revision}'`));
await writeFile('dist/.nojekyll', '');
console.log(`PECSотека 0.1.1 built: ${list.length} files, cache ${revision}`);
