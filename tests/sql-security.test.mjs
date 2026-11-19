// Static security checks over every migration file. They do NOT replace running the SQL test script
// in staging (supabase/tests/privileges_and_isolation.sql) — they stop the common mistakes from coming back.
// Run: node tests/sql-security.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../supabase/migrations/', import.meta.url);
const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n').replace(/\r/g, '');
let fail = 0; const ok = (name, fn) => { try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', e.message); } };

const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map((m) => m[1]);
const rls = new Set([...sql.matchAll(/alter table public\.(\w+) enable row level security/g)].map((m) => m[1]));
const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)\s*returns\s+([\w\s]+?)\n[\s\S]*?\n\$\$;/g)].map((m) => ({ name: m[1], args: m[2], trigger: /trigger/i.test(m[3]), definer: /security definer/.test(m[0]), pathSet: /set search_path/.test(m[0]) }));

// What the API is allowed to expose to the ANONYMOUS role. Everything else must be signed-in only or internal.
const PUBLIC_OK = new Set(['get_platform_catalogue', 'get_shared_report_card']);
// Internal helpers: must never be executable by anon/authenticated.
const INTERNAL = ['log_platform_event', 'school_limits', 'count_active_students', 'assert_enrolment_room', 'capacity_excluded_statuses', 'require_platform_admin', 'my_school_id', 'enforce_student_capacity'];
const revokedFromAll = (n) => new RegExp(`revoke all on function public\\.${n}\\([^)]*\\) from public, anon, authenticated`).test(sql);
const lockedToSignedIn = (n) => revokedFromAll(n) || new RegExp(`revoke (?:all|execute) on function public\\.${n}\\b[^;]*from public`).test(sql) || sql.includes(`'public.${n}(`);

console.log('Row level security');
ok('every table in public has RLS enabled', () => assert.deepEqual(tables.filter((t) => !rls.has(t)), []));
console.log('Functions');
ok('every SECURITY DEFINER function pins search_path', () => assert.deepEqual(fns.filter((f) => f.definer && !f.pathSet).map((f) => f.name), []));
ok('internal helpers are revoked from every API role', () => assert.deepEqual(INTERNAL.filter((n) => !revokedFromAll(n)), []));
ok('no non-trigger definer function stays executable by PUBLIC/anon unless on the allow-list', () => {
  const exposed = fns.filter((f) => f.definer && !f.trigger && !PUBLIC_OK.has(f.name) && !lockedToSignedIn(f.name)).map((f) => f.name);
  assert.deepEqual(exposed, []);
});
ok('only the allow-listed functions are granted to anon', () => {
  const toAnon = [...sql.matchAll(/grant execute on function public\.(\w+)[^;]*to ([^;]*);/g)].filter((m) => /anon/.test(m[2])).map((m) => m[1]);
  assert.deepEqual(toAnon.filter((n) => !PUBLIC_OK.has(n)), []);
});
ok('platform invoice numbering avoids an invoice_year variable/column name collision', () => {
  const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const fix = readFileSync(new URL(migrations.at(-1), dir), 'utf8');
  const invoiceFix = readFileSync(new URL(migrations.find((f) => f.startsWith('202610260001_')), dir), 'utf8');
  assert.match(invoiceFix, /v_invoice_year integer/i);
  assert.match(invoiceFix, /values\s*\(v_invoice_year,\s*1\)/i);
  assert.doesNotMatch(invoiceFix, /\binvoice_year integer\b/i);
});
ok('platform settings read access uses one equivalent policy', () => {
  const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const fix = readFileSync(new URL(migrations.find((f) => f.startsWith('202610260002_')), dir), 'utf8');
  assert.match(fix, /drop policy if exists platform_settings_read_admin/i);
  assert.match(fix, /drop policy if exists platform_settings_read_school_payment_info/i);
  assert.match(fix, /create policy platform_settings_read_access/i);
  assert.match(fix, /public\.is_platform_admin\(\)[\s\S]*key = 'main'[\s\S]*public\.school_memberships/i);
});
ok('private document Storage policies enforce document collection roles', () => {
  const migration = readFileSync(new URL('../supabase/migrations/202611190001_storage_role_access.sql', import.meta.url), 'utf8');
  for (const policy of ['read', 'insert', 'update', 'delete']) {
    const statement = migration.match(new RegExp(`create policy school_documents_${policy}_approved[\\s\\S]*?;`, 'i'))?.[0];
    assert.ok(statement, `missing ${policy} policy`);
    assert.match(statement, /school-documents/);
    assert.match(statement, /current_school_ids/);
    assert.match(statement, /role_collection_access/);
    assert.match(statement, /'documents'/);
    assert.match(statement, policy === 'read' ? /<> 'none'/ : /= 'write'/);
  }
});
ok('attendance and score RPCs define a safe JSON object length helper', () => {
  const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const fix = readFileSync(new URL(migrations.find((f) => f.startsWith('202610260003_')), dir), 'utf8');
  assert.match(fix, /create or replace function public\.jsonb_object_length\(value jsonb\)/i);
  assert.match(fix, /pg_catalog\.jsonb_object_keys\(value\)/i);
  assert.match(fix, /revoke all on function public\.jsonb_object_length\(jsonb\) from public, anon, authenticated/i);
  assert.equal((fix.match(/set search_path = pg_catalog, public/gi) ?? []).length, 3);
});
console.log('Policies');
ok('no policy lets the platform administrator read school records (platform admins never see school data)', () => {
  const m = sql.match(/create policy school_records_[\s\S]*?;/g) ?? [];
  assert.ok(m.length >= 4); assert.ok(m.every((p) => !/is_platform_admin/.test(p)));
});
ok('no service-role key or JWT secret appears in any migration', () => assert.ok(!/service_role_key|eyJ[a-zA-Z0-9_-]{20,}/.test(sql)));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
