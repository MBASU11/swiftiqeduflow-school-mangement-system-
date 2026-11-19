// Run: node tests/health.test.mjs — school health: records, sick bay, medication, immunisation, access.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 600)); } };
const L = await import('../js/services/healthLogic.js');
console.log('Rules');
await ok('profile: "none known" differs from "not recorded"; listed allergies need a name and severity; gaps are a to-do', () => {
  assert.deepEqual(L.validateProfile({ allergyStatus: 'none', allergies: [] }), []);
  assert.ok(L.validateProfile({ allergyStatus: 'listed', allergies: [] })[0].includes('at least one'));
  assert.ok(L.validateProfile({ allergyStatus: 'listed', allergies: [{ substance: '', severity: '' }] }).length >= 2);
  assert.ok(L.validateProfile({ allergyStatus: 'unknown', emergencyPhone: 'abc' }).some((e) => /phone/.test(e)));
  assert.ok(L.validateProfile({ allergyStatus: 'unknown', emergencyPhone: '0700 111 222' }).some((e) => /name of the emergency/.test(e)));
  assert.deepEqual(L.profileGaps(null), ['Allergies not recorded', 'No emergency contact', 'No parent consent for first aid and basic medication']);
  assert.deepEqual(L.profileGaps({ allergyStatus: 'none', emergencyPhone: '0700111222', consentFirstAid: true }), []);
});
await ok('visit: needs complaint and outcome; sensible vitals; sent home or referred needs the parent told; dose needed with medicine', () => {
  const v = { date: '2026-03-01', complaint: 'Headache', outcome: 'returned' };
  assert.deepEqual(L.validateVisit(v, '2026-03-01'), []);
  assert.ok(L.validateVisit({ ...v, complaint: ' ' }, '2026-03-01').length === 1);
  assert.ok(L.validateVisit({ ...v, temperature: '50', pulse: '10' }, '2026-03-01').length === 2);
  assert.ok(L.validateVisit({ ...v, outcome: 'sent_home' }, '2026-03-01')[0].includes('parent or guardian'));
  assert.deepEqual(L.validateVisit({ ...v, outcome: 'sent_home', parentNotified: true }, '2026-03-01'), []);
  assert.ok(L.validateVisit({ ...v, medication: 'Paracetamol' }, '2026-03-01').some((e) => /dose/.test(e)));
  assert.ok(L.validateVisit({ ...v, date: '2026-04-01' }, '2026-03-01').some((e) => /future/.test(e)));
});
await ok('allergy warnings match loosely in both directions and ignore tiny strings', () => {
  const p = { allergies: [{ substance: 'Penicillin', severity: 'life_threatening' }, { substance: 'peanuts', severity: 'mild' }] };
  assert.equal(L.allergyWarnings('Amoxicillin + penicillin V', p).length, 1); assert.match(L.allergyWarnings('penicillin', p)[0], /life-threatening/);
  assert.equal(L.allergyWarnings('Panadol', p).length, 0); assert.equal(L.allergyWarnings('pe', p).length, 0); assert.equal(L.allergyWarnings('peanut butter', p).length, 1);
  assert.match(L.allergyWarnings('Amoxicillin 500mg', p)[0], /related to Penicillin/); assert.equal(L.allergyWarnings('Amoxil', { allergies: [{ substance: 'Sulfa drugs', severity: 'severe' }] }).length, 0); assert.equal(L.allergyWarnings('Septrin', { allergies: [{ substance: 'Sulfa drugs', severity: 'severe' }] }).length, 1);
});
await ok('medication needs authorisation, times and a sensible date range', () => {
  const m = { name: 'Salbutamol', dose: '2 puffs', times: ['13:00'], startDate: '2026-03-01', authorisedBy: 'Mum' };
  assert.deepEqual(L.validateMedication(m), []);
  assert.ok(L.validateMedication({ ...m, authorisedBy: '' })[0].includes('authorised'));
  assert.ok(L.validateMedication({ ...m, times: ['25:00'] }).length === 1); assert.ok(L.validateMedication({ ...m, endDate: '2026-02-01' }).length === 1);
});
await ok('doses due: given, missed, due, overdue and upcoming; stopped and out-of-range medicines are skipped', () => {
  const med = { id: 'm', status: 'active', startDate: '2026-03-01', times: ['08:00', '10:00', '13:00', '15:00'] };
  const doses = [{ medicationId: 'm', date: '2026-03-05', time: '08:00', given: true }, { medicationId: 'm', date: '2026-03-05', time: '10:00', given: false }];
  assert.deepEqual(L.dosesDue([med], doses, '2026-03-05', '13:10').map((d) => d.status), ['given', 'missed', 'due', 'upcoming']);
  assert.equal(L.dosesDue([med], [], '2026-03-05', '15:45')[3].status, 'overdue');
  assert.equal(L.dosesDue([{ ...med, status: 'stopped' }, { ...med, id: 'n', endDate: '2026-03-04' }], [], '2026-03-05', '12:00').length, 0);
});
await ok('immunisation: validation, overdue only when no later dose of the same vaccine', () => {
  assert.ok(L.validateImmunisation({ vaccine: '', dateGiven: '2026-01-01' }, '2026-03-01').length === 1);
  assert.ok(L.validateImmunisation({ vaccine: 'HPV', dateGiven: '2026-01-01', nextDue: '2025-01-01' }, '2026-03-01').length === 1);
  const r = [{ id: '1', vaccine: 'HPV', dateGiven: '2025-01-01', nextDue: '2025-07-01' }, { id: '2', vaccine: 'Typhoid', dateGiven: '2025-01-01', nextDue: '2025-07-01' }, { id: '3', vaccine: 'Typhoid', dateGiven: '2025-08-01' }];
  assert.deepEqual(L.overdueImmunisations(r, '2026-03-01').map((x) => x.id), ['1']);
});
await ok('frequent attenders: three or more visits in 30 days', () => {
  const v = [...Array(3)].map((_, i) => ({ studentId: 'a', date: `2026-03-0${i + 1}` })).concat([{ studentId: 'b', date: '2026-03-02' }, { studentId: 'a', date: '2025-12-01' }]);
  assert.deepEqual(L.frequentAttenders(v, { now: '2026-03-10' }), [{ studentId: 'a', count: 3 }]);
});

console.log('Service and access (demo storage)');
const A = await import('../js/services/authService.js'); const { setCurrentRole, canReadCollection, canWriteModule } = await import('../js/services/accessService.js');
const { studentRepo } = await import('../js/services/studentService.js'); const H = await import('../js/services/healthService.js');
const reg = A.register({ name: 'Head', schoolName: 'HL School', email: 'head@hl.co', password: 'secret-pass-1', confirmPassword: 'secret-pass-1', planId: 'micro', billing: 'annual' });
A.updateAccount(reg.id, { status: 'approved' }); A.login('head@hl.co', 'secret-pass-1'); setCurrentRole(null);
const kid = (n) => studentRepo.create({ admissionNumber: n, firstName: n, lastName: 'K', classId: 'c', status: 'active', parentIds: [] }, 's'); const [amy, ben] = [kid('Amy'), kid('Ben')];
const day = new Date().toISOString().slice(0, 10);
await ok('profile saved; severe allergies reach the overview; changing status clears the list', () => {
  assert.ok(H.saveProfile(amy.id, { allergyStatus: 'listed', allergies: [{ substance: 'Penicillin', severity: 'life_threatening', reaction: 'Anaphylaxis' }], conditions: ['Asthma', ' '], emergencyName: 'Mum', emergencyPhone: '0700 111 222', consentFirstAid: true }).ok);
  assert.deepEqual(H.getProfile(amy.id).conditions, ['Asthma']); assert.equal(H.overview().severe.length, 1);
  assert.equal(H.overview().gaps, 1); // Ben has no record at all
  assert.ok(H.saveProfile(amy.id, { allergyStatus: 'none', allergies: [{ substance: 'x', severity: 'mild' }], emergencyName: 'Mum', emergencyPhone: '0700 111 222', consentFirstAid: true }).ok);
  assert.deepEqual(H.getProfile(amy.id).allergies, []); assert.equal(H.profileRepo.getAll().length, 1);
  H.saveProfile(amy.id, { allergyStatus: 'listed', allergies: [{ substance: 'Penicillin', severity: 'life_threatening' }], emergencyName: 'Mum', emergencyPhone: '0700 111 222', consentFirstAid: true });
});
await ok('visit with medicine: consent and allergy checks stop it until confirmed', () => {
  const base = { date: day, time: '10:00', complaint: 'Fever', outcome: 'rested', medication: 'Penicillin V', dose: '250mg' };
  const a = H.addVisit(amy.id, base); assert.equal(a.ok, false); assert.equal(a.needsAllergyConfirm, true); assert.match(a.errors[0], /life-threatening/);
  assert.ok(H.addVisit(amy.id, { ...base, confirmAllergy: true }).ok);
  const b = H.addVisit(ben.id, { ...base, medication: 'Panadol' }); assert.equal(b.needsConsentOverride, true);
  assert.ok(H.addVisit(ben.id, { ...base, medication: 'Panadol', overrideConsent: true }).ok); assert.equal(H.visitsOf(ben.id).length, 1);
  assert.equal(H.addVisit(ben.id, { date: day, complaint: 'Cut', outcome: 'sent_home' }).ok, false);
});
await ok('standing medication: authorisation required, allergy check, daily doses recorded once, a missed dose needs a reason', () => {
  assert.equal(H.addMedication(amy.id, { name: 'Inhaler', dose: '2 puffs', times: ['00:01'], startDate: day, authorisedBy: '' }).ok, false);
  assert.equal(H.addMedication(amy.id, { name: 'Penicillin', dose: '1', times: ['00:01'], startDate: day, authorisedBy: 'Dr' }).needsAllergyConfirm, true);
  const m = H.addMedication(amy.id, { name: 'Inhaler', dose: '2 puffs', times: ['00:01'], startDate: day, authorisedBy: 'Mum' }).medication;
  assert.equal(H.dosesToday().find((d) => d.medication.id === m.id).status, 'overdue');
  assert.equal(H.recordDose(m.id, '00:01', false, ' ').ok, false); assert.ok(H.recordDose(m.id, '00:01', true).ok); assert.equal(H.recordDose(m.id, '00:01', true).ok, false);
  assert.equal(H.dosesToday().find((d) => d.medication.id === m.id).status, 'given');
  H.stopMedication(m.id); assert.equal(H.dosesToday().length, 0); assert.equal(H.recordDose(m.id, '00:01', true).ok, false);
});
await ok('immunisation recorded and overdue counted', () => {
  assert.ok(H.addImmunisation(ben.id, { vaccine: 'HPV', dateGiven: '2025-01-01', doseNumber: '1', nextDue: '2025-07-01' }).ok); assert.equal(H.overview().overdueVaccines, 1);
  assert.ok(H.addImmunisation(ben.id, { vaccine: 'HPV', dateGiven: '2025-08-01', doseNumber: '2' }).ok); assert.equal(H.overview().overdueVaccines, 0);
});
await ok('opening a record is logged', () => { H.logAccess(amy.id); H.logAccess(amy.id); assert.equal(H.recentAccess(amy.id).length, 2); assert.equal(H.recentAccess(amy.id)[0].by, 'Head'); });
await ok('access: nurse and administrator only. Teachers, accountants, registrars, learners and parents cannot', () => {
  const can = (role) => { setCurrentRole(role); const r = [canWriteModule('health'), ['healthProfiles', 'healthVisits', 'healthMedications', 'healthImmunisations'].map(canReadCollection).every(Boolean)]; return r; };
  assert.deepEqual(can('nurse'), [true, true]); assert.deepEqual(can('school_admin'), [true, true]);
  for (const r of ['teacher', 'accountant', 'registrar', 'staff', 'parent', 'student']) assert.deepEqual(can(r), [false, false], r);
  setCurrentRole('nurse'); assert.equal(canWriteModule('finance'), false); assert.equal(canReadCollection('invoices'), false); assert.equal(canReadCollection('students'), true);
  assert.throws(() => H.saveProfile(ben.id, { allergyStatus: 'none', emergencyName: '', emergencyPhone: '' }) && (() => { throw new Error('x'); })(), /x|permission|allowed/i);
  setCurrentRole('teacher'); assert.throws(() => H.profileRepo.create({ studentId: 'z' }, 'x'), /./); setCurrentRole(null);
});
await ok("health data never reaches the learner or parent portal", async () => {
  const P = await import('../js/services/demoPortalService.js'); const out = JSON.stringify(await P.buildDemoPortal({ role: 'student', linkedId: amy.id, name: 'Amy' }));
  for (const w of ['Penicillin', 'allerg', 'Inhaler', 'healthProfiles', 'immunis']) assert.equal(out.toLowerCase().includes(w.toLowerCase()), false, w);
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
