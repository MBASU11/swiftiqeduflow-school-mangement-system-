// Runs every test file and fails if any does.  node tests/run-all.mjs
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('.', import.meta.url));
let bad = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.test.mjs')).sort()) {
  const r = spawnSync(process.execPath, [join(dir, f)], { encoding: 'utf8' });
  const last = (r.stdout.trim().split('\n').pop() ?? '').trim();
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'}  ${f.padEnd(26)} ${last}`);
  if (r.status !== 0) { bad++; console.log(r.stdout.split('\n').filter((l) => l.includes('✗')).join('\n')); }
}
process.exitCode = bad ? 1 : 0;
