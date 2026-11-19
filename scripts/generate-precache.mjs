// Lists every file the app needs to open with no connection and stamps a version from their contents.
// Run after ANY change to js/, css/ or assets/:   node scripts/generate-precache.mjs
// (tests/pwa.test.mjs fails if precache.json is out of date, so a stale offline copy can't ship.)
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'supabase', 'tests', 'docs', 'scripts', 'sample-import-files', 'dist', '.git']);
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(relative(root, p).replaceAll('\\', '/'));
  }
  return out;
}
export function buildList() {
  return walk(root).filter((f) => /\.(js|css|html|png|ico|webmanifest|svg|woff2?)$/.test(f) && f !== 'precache.json' && f !== 'sw.js' && f !== 'report.html');
}
export function buildManifest() {
  const files = buildList(); const h = createHash('sha1');
  files.forEach((f) => { h.update(f); h.update(readFileSync(join(root, f))); });
  return { version: h.digest('hex').slice(0, 12), files: ['./', ...files.map((f) => `./${f}`)] };
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const m = buildManifest(); writeFileSync(join(root, 'precache.json'), JSON.stringify(m, null, 1) + '\n');
  console.log(`precache.json: ${m.files.length} files, version ${m.version}`);
}
