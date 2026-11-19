import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildManifest } from './generate-precache.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'dist');

if (output !== join(root, 'dist')) throw new Error('Refusing to write outside the project dist folder.');
await build({
  entryPoints: ['@supabase/supabase-js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  outfile: join(root, 'js', 'vendor', 'supabase.js'),
});
const manifest = buildManifest();
writeFileSync(join(root, 'precache.json'), JSON.stringify(manifest, null, 1) + '\n');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const directory of ['assets', 'css', 'js']) {
  cpSync(join(root, directory), join(output, directory), { recursive: true });
}

for (const file of ['index.html', 'report.html', 'manifest.webmanifest', 'precache.json', 'sw.js']) {
  cpSync(join(root, file), join(output, file));
}

console.log(`Netlify static site built in ${output}`);
