// Run: node tests/legal.test.mjs — privacy notice, terms, data processing terms, and the school's parent notice.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 700)); } };
const T = await import('../js/config/legalText.js');
const text = (sections) => JSON.stringify(sections); const filled = { businessName: 'SwiftIQ EduFlow', legalName: 'SwiftIQ Ltd', registeredAddress: 'PO Box 1, Nairobi', privacyEmail: 'privacy@swiftiq.co.ke', privacyPhone: '+254700000000', dpoName: 'Jane Mwangi', odpcRegistration: 'ODPC/123', dataLocation: 'Safaricom data centre, Nairobi', subProcessors: 'Safaricom Cloud: hosting\nAfrica\'s Talking: SMS', retentionDays: 60 };

console.log('Placeholders');
await ok('with nothing filled in, every required detail shows as a visible to-do and is listed as missing', () => {
  const f = T.legalFacts({}); assert.deepEqual(T.missingFields(f), T.REQUIRED_FIELDS);
  for (const build of [T.privacySections, T.termsSections, T.processingSections]) { const t = text(build(f)); assert.match(t, /\[to be completed: /); }
  const p = text(T.privacySections(f)); for (const k of ['company', 'address', 'dpo', 'odpc', 'location']) assert.ok(p.includes(`[to be completed: ${T.FIELD_LABELS[k]}]`), k);
});
await ok('with everything filled in, no to-do remains in the three documents and the details appear', () => {
  const f = T.legalFacts(filled); assert.deepEqual(T.missingFields(f), []);
  for (const build of [T.privacySections, T.processingSections]) assert.doesNotMatch(text(build(f)), /\[to be completed/);
  const p = text(T.privacySections(f)); assert.ok(p.includes('SwiftIQ Ltd') && p.includes('ODPC/123') && p.includes('Safaricom data centre, Nairobi') && p.includes('Jane Mwangi') && p.includes('privacy@swiftiq.co.ke') && p.includes('Africa\'s Talking: SMS'));
  assert.match(p, /within 60 days/); assert.match(text(T.processingSections(f)), /within 60 days/); assert.match(text(T.termsSections(f)), /within 60 days/);
  assert.equal(T.legalFacts({ ...filled, retentionDays: 'x' }).retention, '90'); // a bad value falls back to the default
});
await ok('the terms keep the owner/lawyer decisions visible instead of inventing them', () => { const t = text(T.termsSections(T.legalFacts(filled))); for (const w of ['owner decision', 'for the lawyer to complete']) assert.ok(t.includes(w), w); });

console.log('Content follows the law');
await ok('privacy notice covers what regulation 23 asks for, with the Regulations\' own time limits', () => {
  const s = T.privacySections(T.legalFacts(filled)); const ids = s.map((x) => x.id); for (const id of ['who', 'roles', 'collect', 'why', 'children', 'sharing', 'location', 'security', 'keep', 'rights', 'contact']) assert.ok(ids.includes(id), id);
  const t = text(s); assert.match(t, /within 7 days/); assert.match(t, /within 14 days/); assert.match(t, /within 30 days/); assert.match(t, /72 hours/); assert.match(t, /48 hours/); assert.match(t, /odpc\.go\.ke/); assert.match(t, /data controller/); assert.match(t, /data processor/);
  assert.match(t, /basic education/); assert.match(t, /DPG 1 to DPG 5/);
});
await ok('data processing terms contain every item regulation 24(2) requires, plus sub-processor authorisation', () => {
  const t = text(T.processingSections(T.legalFacts(filled))).toLowerCase();
  for (const w of ['subject matter', 'duration', 'nature and purpose', 'types of data', 'categories of data subjects', 'documented instructions', 'confidential', 'security measures', 'return', 'delete', 'audit', 'prior authorisation', 'breach', 'serving copy']) assert.ok(t.includes(w), w);
});
await ok('the text promises nothing the system does not do: no certifications, absolutes, or unbuilt security features', () => {
  const all = [T.privacySections, T.termsSections, T.processingSections].map((b) => text(b(T.legalFacts(filled)))).join(' ');
  for (const bad of [/ISO ?27001/i, /SOC ?2/i, /end-to-end/i, /100%/, /guarantee/i, /unhackable/i, /GDPR compliant/i, /fully compliant/i, /certified/i, /two-step/i, /multi-factor/i, /2fa/i, /lock(ed)? out after/i, /penetration test/i]) assert.doesNotMatch(all, bad, String(bad));
  assert.doesNotMatch(all, /we (will )?never (share|sell|lose)/i);
});
await ok('children and health get their own plain statements: parental consent, no marketing to children, restricted health access', () => {
  const p = text(T.privacySections(T.legalFacts(filled))); assert.match(p, /parent or guardian’s consent/); assert.match(p, /never used to target messages to the child/); assert.match(p, /only school administrators and the school nurse/); assert.match(p, /never appear in the parent or learner portal/);
});

console.log('The school\'s notice to parents');
const school = { name: 'Hill Academy' };
await ok('the notice is built from the school\'s answers: optional parts appear only when they apply', () => {
  const none = text(T.parentNoticeSections(school, {})); assert.ok(!none.includes('health information that helps') && !none.includes('boarding details') && !none.includes('Photographs')); assert.match(none, /do not share your child’s information with anyone else/);
  const all = text(T.parentNoticeSections(school, { health: true, boarding: true, photos: true, shares: ['sms', 'mpesa'], contactName: 'Mrs Wanjiru', contactPhone: '0700111222', retention: 'For 7 years after they leave' }));
  for (const w of ['health information that helps', 'boarding details', 'Photographs', 'SMS provider', 'M-Pesa', 'Mrs Wanjiru, 0700111222', 'For 7 years after they leave', 'Hill Academy']) assert.ok(all.includes(w), w);
  assert.doesNotMatch(all, /\[to be completed/); assert.match(all, /within 7 days[\s\S]*14 days/);
});
await ok('missing contact and retention show as to-dos; consent items follow the answers and are each separate', () => {
  assert.equal((text(T.parentNoticeSections(school, {})).match(/\[to be completed/g) ?? []).length, 2);
  assert.deepEqual(T.parentConsentItems({}).map((x) => x[0]), ['sms']); assert.deepEqual(T.parentConsentItems({ health: true, photos: true }).map((x) => x[0]), ['firstaid', 'health', 'photos', 'sms']);
  assert.match(T.parentConsentItems({ photos: true }).find((x) => x[0] === 'photos')[1], /Optional/);
});

console.log('Acceptance is recorded');
const A = await import('../js/services/authService.js');
await ok('signup needs the terms accepted and the account keeps which version was accepted, and when', () => {
  const d = { name: 'Pat', schoolName: 'S', email: 'p@s.co', phone: '0700111222', password: 'secret-pass-1', confirmPassword: 'secret-pass-1', planId: 'micro', billing: 'annual', studentCount: 50 };
  assert.match(A.validateSignup({ ...d, acceptedTerms: false }).find((e) => e.field === 'acceptedTerms').message, /Terms, the Privacy Notice and the Data Processing Terms/); assert.equal(A.validateSignup({ ...d, acceptedTerms: true }).length, 0);
  const acc = A.register({ ...d, acceptedTerms: true, legalVersion: T.LEGAL_VERSION }); assert.equal(acc.terms.version, T.LEGAL_VERSION); assert.ok(Date.parse(acc.terms.acceptedAt) > 0);
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
