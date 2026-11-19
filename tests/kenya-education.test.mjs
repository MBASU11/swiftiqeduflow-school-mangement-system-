import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KENYA_ASSESSMENT_LEVELS,
  KENYA_CBE_PATHWAYS,
  KENYA_COUNTIES,
  KENYA_GRADE_LEVELS,
  KENYA_SCHOOL_TYPES,
  KENYA_TERM_TEMPLATES,
} from '../js/config/kenyaEducation.js';
import { buildSchoolSetupRecords } from '../js/services/supabaseSchoolSetupService.js';

const migration = readFileSync(new URL('../supabase/migrations/202610220001_kenyan_education_reference.sql', import.meta.url), 'utf8');
let failed = 0;
const test = (label, run) => {
  try {
    run();
    console.log('  ✓', label);
  } catch (error) {
    failed += 1;
    console.error('  ✗', label, '\n    ', error.message);
  }
};

function seededRows(table) {
  const match = migration.match(new RegExp(`insert into public\\.${table}\\s*\\([^)]*\\)\\s*values([\\s\\S]*?);`));
  assert.ok(match, `Missing seed for ${table}`);
  return [...match[1].matchAll(/\(([^()]*)\)/g)].map(([, tuple]) =>
    [...tuple.matchAll(/'((?:''|[^'])*)'|(true|false|-?\d+)/g)].map(([, text, value]) =>
      text === undefined ? (value === 'true' ? true : value === 'false' ? false : Number(value)) : text.replaceAll("''", "'")
    )
  );
}

console.log('Kenyan education database reference');
test('includes all 47 county codes and names in the database seed', () => {
  assert.equal(KENYA_COUNTIES.length, 47);
  assert.deepEqual(seededRows('kenya_counties').map(([code, name]) => [code, name]), KENYA_COUNTIES);
});
test('school categories in setup match active database categories', () => {
  const types = seededRows('kenya_school_types').filter((row) => row[3] === false).map((row) => row.slice(0, 2));
  assert.deepEqual(types, KENYA_SCHOOL_TYPES);
});
test('cloud setup writes the selected county code and school type to the school profile', () => {
  globalThis.window = { crypto: globalThis.crypto };
  const records = buildSchoolSetupRecords({
    name: 'Test School',
    phone: '',
    email: '',
    address: '',
    schoolType: 'junior_school',
    countyCode: '032',
    curriculumName: 'CBC / CBE',
    curriculumType: 'cbc',
    yearLabel: '2026',
    yearStart: '',
    yearEnd: '',
    termNames: [],
    classes: [],
    subjects: [],
  });
  const profile = records.find((record) => record.collection === 'school');
  assert.equal(profile.payload.countyCode, '032');
  assert.equal(profile.payload.type, 'junior_school');
});
test('pre-primary and Grades 1-12 map to the right education stages', () => {
  assert.deepEqual(seededRows('kenya_grade_levels').map(([code, label, stage, order]) => [code, label, stage, Number(order)]), KENYA_GRADE_LEVELS);
});
test('Senior School CBE pathways match the seeded reference table', () => {
  assert.deepEqual(seededRows('kenya_cbe_pathways').map(([code, label, description, order]) => [code, label, description, Number(order)]), KENYA_CBE_PATHWAYS);
});
test('CBC assessment levels and term templates match the database', () => {
  assert.deepEqual(seededRows('kenya_assessment_levels').map(([code, label, value]) => [code, label, Number(value)]), KENYA_ASSESSMENT_LEVELS);
  assert.deepEqual(seededRows('kenya_term_templates').map(([code, label, order]) => [code, label, Number(order)]), KENYA_TERM_TEMPLATES);
});
test('reference tables are RLS protected and database writes are revoked', () => {
  assert.match(migration, /alter table public\.kenya_counties enable row level security/);
  assert.match(migration, /for select to anon, authenticated using \(true\)/);
  assert.match(migration, /revoke all on public\.kenya_counties[\s\S]*from public, anon, authenticated/);
});

console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
process.exitCode = failed ? 1 : 0;
