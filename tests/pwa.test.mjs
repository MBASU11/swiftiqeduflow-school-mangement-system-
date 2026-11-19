// Run: node tests/pwa.test.mjs — guards the offline app shell.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../scripts/generate-precache.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
let fail = 0; const ok = (name, fn) => { try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', e.message); } };
const pre = JSON.parse(readFileSync(join(root, 'precache.json'), 'utf8'));
const normalized = (path) => normalize(path).replaceAll('\\', '/');
const cached = new Set(pre.files.map((f) => normalized(f.replace(/^\.\//, ''))));

ok('precache.json is up to date (run: node scripts/generate-precache.mjs)', () => assert.equal(pre.version, buildManifest().version));
ok('every precached file exists', () => assert.deepEqual(pre.files.filter((f) => f !== './' && !existsSync(join(root, f))), []));
ok('every JavaScript module the app imports is in the offline cache', () => {
  const missing = [];
  for (const f of pre.files.filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = normalized(join(dirname(f), m[1]).replace(/^\.\//, ''));
      if (!cached.has(target)) missing.push(`${f} → ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
ok('index, styles, manifest and icons are cached', () => ['index.html', 'css/styles.css', 'manifest.webmanifest', 'assets/logo-badge-192.png', 'assets/logo-badge.png'].forEach((f) => assert.ok(cached.has(f), f)));
ok('Supabase client is bundled locally from an exact locked dependency', () => {
  const client = readFileSync(join(root, 'js/services/supabaseClient.js'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  assert.match(client, /import\(['"]\.\.\/vendor\/supabase\.js['"]\)/);
  assert.doesNotMatch(client, /https?:\/\/.*supabase-js/);
  assert.equal(manifest.dependencies['@supabase/supabase-js'], '2.119.1');
  assert.equal(lock.packages['node_modules/@supabase/supabase-js'].version, '2.119.1');
  assert.ok(cached.has('js/vendor/supabase.js'));
});
ok('manifest is valid and index.html links it', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone'); assert.ok(m.icons.every((i) => existsSync(join(root, i.src))));
  assert.match(readFileSync(join(root, 'index.html'), 'utf8'), /rel="manifest"/);
});
ok('service worker never touches other sites, non-GET requests or school data', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  assert.match(sw, /req\.method !== 'GET' \|\| url\.origin !== self\.location\.origin\) return/);
  assert.ok(!/supabase/i.test(sw));
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
