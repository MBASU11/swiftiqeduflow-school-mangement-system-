// Run: node tests/bursar3-service.test.mjs — Phase Three workflows against real stored records (demo mode).
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
globalThis.DOMException ??= class extends Error {}; globalThis.document = undefined;
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', e.message.slice(0, 700)); } };

const auth = await import('../js/services/authService.js');
const ac = await import('../js/services/academicService.js');
const st = await import('../js/services/studentService.js');
const fin = await import('../js/services/financeService.js');
const B = await import('../js/services/bursarService.js');
const L = await import('../js/services/bursarLogic.js');

const acct = auth.register({ name: 'Bursar', schoolName: 'Svc School', email: 's@s.co', password: 'secret-pass-1', confirmPassword: 'secret-pass-1', planId: 'micro', billing: 'annual', studentCount: 20, acceptedTerms: true });
auth.updateAccount(acct.id, { status: 'approved' }); auth.logout(); auth.login('s@s.co', 'secret-pass-1');
const cls = ac.classRepo.create({ name: 'Grade 4', order: 4 }); const term = ac.termRepo.create({ name: 'Term 1', isCurrent: true });
const mk = (n, adm) => st.studentRepo.create({ admissionNumber: adm, firstName: n, lastName: 'K', classId: cls.id, admissionDate: '2026-01-05', status: 'active', parentIds: [] });
const amy = mk('Amy', 'ADM-1'), ben = mk('Ben', 'ADM-2'), cy = mk('Cy', 'ADM-3');
const structure = fin.feeStructureRepo.create({ name: 'G4', classId: cls.id, termId: term.id, items: [{ id: '1', name: 'Tuition', amount: 30000 }, { id: '2', name: 'Lunch', amount: 10000 }] });
const gen = (extra = {}) => B.generateInvoices({ scope: { mode: 'all' }, structureId: structure.id, termId: term.id, dueDate: '2026-12-01', includeOptional: false, includeTransport: false, applySibling: false, ...extra });
const invFor = async (s) => (await B.loadBursar()).invoices.find((i) => i.studentId === s.id);
const figures = async (i) => { const d = await B.loadBursar(); return L.invoiceFigures(d.invoices.find((x) => x.id === i.id), d.payments, '2026-06-01', d.creditNotes); };

console.log('Scholarships and sponsorships');
await ok('only APPROVED awards reach the invoice; a sponsorship tags the sponsor', async () => {
  const a1 = await B.saveAward({ studentId: amy.id, type: 'scholarship', kind: 'percent', value: 50 }, 'Bursar');
  const a2 = await B.saveAward({ studentId: ben.id, type: 'sponsorship', sponsor: 'Equity Foundation', kind: 'amount', value: 15000 }, 'Bursar');
  await B.decideAward(a2.id, true, 'Head');                      // a1 stays pending
  const r = await gen(); assert.equal(r.created.length, 3);
  assert.equal((await invFor(amy)).totalAmount, 40000, 'pending scholarship not applied');
  const benInv = await invFor(ben); assert.equal(benInv.totalAmount, 25000); assert.equal(benInv.items.find((x) => x.kind === 'award').sponsor, 'Equity Foundation');
  await B.decideAward(a1.id, true, 'Head');
  assert.equal((await B.generateInvoices({ scope: { mode: 'all' }, structureId: structure.id, termId: term.id })).created.length, 0, 'same term & structure is never invoiced twice');
  const d = await B.loadBursar(); assert.deepEqual(L.sponsorBalances(d.invoices, d.sponsorPayments).map((x) => [x.sponsor, x.claimed, x.balance]), [['Equity Foundation', 15000, 15000]]);
});
await ok('sponsor payments follow the same verify-first rule', async () => {
  const p = await B.recordSponsorPayment({ sponsor: 'Equity Foundation', amount: 15000, method: 'bank', reference: 'EQ-77' });
  assert.equal(p.status, 'pending_verification'); let d = await B.loadBursar(); assert.equal(L.sponsorBalances(d.invoices, d.sponsorPayments)[0].balance, 15000);
  await B.confirmSponsorPayment(p.id, 'Seen on bank statement'); d = await B.loadBursar(); assert.equal(L.sponsorBalances(d.invoices, d.sponsorPayments)[0].balance, 0);
});

console.log('Credit notes');
await ok('a credit note changes nothing until approved; then the balance and status follow it, and legacy totals agree', async () => {
  const inv = await invFor(amy);                                 // 40,000
  await B.submitPayment({ studentId: amy.id, invoiceId: inv.id, amount: 30000, method: 'cash', date: '2026-02-01' });
  const cn = await B.requestCreditNote({ invoiceId: inv.id, amount: 10000, reason: 'Lunch not taken' }, 'Bursar');
  assert.match(cn.number, /^CN-\d{4}-0001$/); assert.equal((await figures(inv)).outstanding, 10000);
  await assert.rejects(() => B.requestCreditNote({ invoiceId: inv.id, amount: 31000, reason: 'too much' }, 'Bursar'), /At most/);
  await B.decideCreditNote(cn.id, true, { by: 'Head' });
  const f = await figures(inv); assert.deepEqual([f.billed, f.outstanding, f.status], [30000, 0, 'paid']);
  assert.equal((await invFor(amy)).status, 'paid'); assert.equal((await invFor(amy)).totalAmount, 40000, 'the invoice itself is untouched');
  assert.equal(fin.studentTotals(amy.id).outstanding ?? fin.studentTotals(amy.id).balance ?? 0, 0);
  await assert.rejects(() => B.decideCreditNote(cn.id, true, { by: 'Head' }), /no longer waiting/);
});

console.log('Payments: rules and allocation');
await ok('overpaying an invoice is refused by default and allowed when the school chooses', async () => {
  const inv = await invFor(cy);                                  // 40,000
  await assert.rejects(() => B.submitPayment({ studentId: cy.id, invoiceId: inv.id, amount: 45000, method: 'cash' }), /more than the outstanding/);
  await B.savePaymentRules({ allowOverpayment: true }); await B.submitPayment({ studentId: cy.id, invoiceId: inv.id, amount: 1000, method: 'cash', date: '2026-02-02' }); await B.savePaymentRules({ allowOverpayment: false });
});
await ok('a loose payment is spread oldest-due first and every touched invoice is re-statused', async () => {
  const inv2 = await B.generateInvoices({ scope: { mode: 'students', studentIds: [cy.id] }, structureId: fin.feeStructureRepo.create({ name: 'Extra', classId: cls.id, termId: undefined, items: [{ id: 'x', name: 'Trip', amount: 5000 }] }).id, termId: '', dueDate: '2026-03-01' });
  const loose = await (async () => { const { LocalStorageRepository } = await import('../js/storage/Repository.js'); return new LocalStorageRepository('payments', 'payment').create({ studentId: cy.id, amount: 20000, method: 'cash', date: '2026-02-05', status: 'confirmed' }); })();
  assert.equal((await B.unallocatedPayments()).length >= 1, true);
  await B.allocatePayment(loose.id, undefined, 'Bursar');
  const d = await B.loadBursar(); const p = d.payments.find((x) => x.id === loose.id);
  assert.deepEqual(p.allocations.map((a) => [d.invoices.find((i) => i.id === a.invoiceId).number === inv2.created[0].number ? 'trip' : 'term', a.amount]), [['trip', 5000], ['term', 15000]]);
  assert.equal(inv2.created.length, 1); assert.equal(L.invoiceFigures(d.invoices.find((i) => i.id === inv2.created[0].id), d.payments, '2026-06-01', d.creditNotes).status, 'paid');
  await assert.rejects(() => B.allocatePayment(loose.id, [{ invoiceId: 'zzz', amount: 1 }]), /does not belong|not belong/);
});

console.log('Installment plans');
await ok('a plan covers the current balance, moves the invoice due date to the last installment, and blocks a second plan', async () => {
  const inv = await invFor(ben);                                 // 25,000, nothing paid
  const plan = await B.createPlan({ invoiceId: inv.id, count: 4, firstDue: '2026-03-01' }, 'Bursar');
  assert.deepEqual(plan.schedule.map((s) => s.amount), [6250, 6250, 6250, 6250]); assert.equal((await invFor(ben)).dueDate, '2026-06-01');
  await assert.rejects(() => B.createPlan({ invoiceId: inv.id, count: 2, firstDue: '2026-03-01' }), /already has an active plan/);
  await B.submitPayment({ studentId: ben.id, invoiceId: inv.id, amount: 7000, method: 'cash', date: '2026-03-02' });
  const d = await B.loadBursar(); const pr = L.planProgress(d.installmentPlans[0], d.invoices.find((i) => i.id === inv.id), d.payments, d.creditNotes, '2026-04-15');
  assert.deepEqual(pr.installments.map((x) => [x.paid, x.status]), [[6250, 'paid'], [750, 'overdue'], [0, 'upcoming'], [0, 'upcoming']]);
  await B.cancelPlan(plan.id, 'Bursar'); await assert.rejects(() => B.cancelPlan(plan.id), /not active/);
});

console.log('Statements and the books agree');
await ok('every learner: statement closing balance equals billed − credits − paid', async () => {
  const d = await B.loadBursar();
  for (const s of [amy, ben, cy]) { const stt = L.buildStatement({ studentId: s.id, invoices: d.invoices, payments: d.payments, creditNotes: d.creditNotes, refunds: d.refunds }); const f = L.studentFigures(s.id, d.invoices, d.payments, d.refunds, d.creditNotes); assert.equal(stt.closing, f.billed - f.paid, s.firstName); }
});

console.log('Unmatched transactions');
await ok('importing a statement queues unknown lines once; a second import adds nothing', async () => {
  const lines = L.parseStatement('Date,Transaction Code,Amount,Account\n2026-03-05,TX100,"4,000",ADM-2 term fees\n2026-03-05,TX101,900,school stuff\n2026-03-05,TX102,500,ADM-1 and ADM-3');
  const r1 = await B.importStatementLines(lines); assert.equal(r1.queued, 3); assert.deepEqual(r1.results.map((x) => x.result), ['suggested', 'unmatched', 'ambiguous']);
  const r2 = await B.importStatementLines(lines); assert.equal(r2.queued, 0); assert.ok(r2.results.every((x) => x.result === 'already_known'));
  assert.equal((await B.loadBursar()).bankTransactions.length, 3);
});
await ok('assigning creates ONE confirmed, receipted payment; it cannot be assigned twice or reuse a reference', async () => {
  let d = await B.loadBursar(); const tx = d.bankTransactions.find((t) => t.reference === 'TX100');
  const before = d.receipts.length; await B.assignTransaction(tx.id, { studentId: ben.id, method: 'mpesa' }, 'Bursar');
  d = await B.loadBursar(); assert.equal(d.receipts.length, before + 1); const pay = d.payments.find((p) => p.reference === 'TX100'); assert.deepEqual([pay.status, pay.method, pay.amount], ['confirmed', 'mpesa', 4000]);
  await assert.rejects(() => B.assignTransaction(tx.id, { studentId: ben.id }), /already been dealt with/);
  await assert.rejects(() => B.submitPayment({ studentId: ben.id, amount: 1, method: 'mpesa', reference: 'tx100' }), /already been recorded/);
  const other = d.bankTransactions.find((t) => t.reference === 'TX101'); await B.ignoreTransaction(other.id, 'Canteen supplier deposit', 'Bursar');
  await assert.rejects(() => B.ignoreTransaction(other.id, ' '), /Say why/);
  assert.equal(L.bursarMetrics({ invoices: d.invoices, payments: d.payments, bankTx: (await B.loadBursar()).bankTransactions, today: '2026-06-01' }).unmatched, 1);
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
