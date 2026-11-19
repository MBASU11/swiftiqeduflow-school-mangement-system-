// Run: node tests/bursar.test.mjs
import assert from 'node:assert/strict';
import * as b from '../js/services/bursarLogic.js';
let fail = 0;
const ok = (name, fn) => { try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', e.message); } };
const S = (id, parentIds, extra = {}) => ({ id, parentIds, admissionNumber: id, status: 'active', ...extra });

console.log('Payments only count once confirmed');
ok('cash is confirmed at once; M-Pesa/bank/cheque wait for verification', () => {
  assert.equal(b.initialPaymentStatus('cash'), 'confirmed');
  ['mpesa', 'bank', 'cheque', 'swiftiq_pay'].forEach((m) => assert.equal(b.initialPaymentStatus(m), 'pending_verification'));
});
ok('pending payments do not reduce the balance; legacy (no status) payments do', () => {
  const inv = { id: 'i1', totalAmount: 10000, dueDate: '2026-01-01' };
  const f = b.invoiceFigures(inv, [{ invoiceId: 'i1', amount: 4000 }, { invoiceId: 'i1', amount: 3000, status: 'pending_verification' }, { invoiceId: 'i1', amount: 500, status: 'rejected' }], '2026-02-01');
  assert.deepEqual([f.paid, f.pending, f.outstanding, f.status, f.overdue], [4000, 3000, 6000, 'partial', true]);
});
ok('overpaid is reported, status is paid', () => {
  const f = b.invoiceFigures({ id: 'i', totalAmount: 1000 }, [{ invoiceId: 'i', amount: 1300 }], '2026-01-01');
  assert.deepEqual([f.status, f.outstanding, f.overpaid], ['paid', 0, 300]);
});
ok('paid-out refunds reduce what the student has net paid; requested ones do not', () => {
  const f = b.studentFigures('s', [{ studentId: 's', status: 'unpaid', totalAmount: 5000 }], [{ studentId: 's', amount: 5000 }], [{ studentId: 's', amount: 1000, status: 'paid' }, { studentId: 's', amount: 500, status: 'requested' }]);
  assert.deepEqual([f.paid, f.outstanding], [4000, 1000]);
});

console.log('Numbering');
ok('numbers are sequential per prefix and year, never reused', () => {
  assert.equal(b.nextNumber([], 'INV', 2026), 'INV-2026-0001');
  assert.equal(b.nextNumber(['INV-2026-0001', 'INV-2026-0009', 'INV-2025-0500', 'x'], 'INV', 2026), 'INV-2026-0010');
  assert.equal(b.nextNumber(['RCT-2026-0003'], 'INV', 2026), 'INV-2026-0001');
});

console.log('Sibling discounts');
const kids = [S('a', ['p1'], { dateOfBirth: '2012-01-01' }), S('b', ['p1', 'p2'], { dateOfBirth: '2014-01-01' }), S('c', ['p2'], { dateOfBirth: '2016-01-01' }), S('d', ['p9']), S('e', [])];
const policy = { enabled: true, type: 'percent', tiers: { 2: 10, 3: 20 }, requireApproval: false };
ok('families link through shared parents (a-b via p1, b-c via p2); lone children are not families', () => {
  const fam = b.siblingFamilies(kids); assert.equal(fam.length, 1); assert.deepEqual(fam[0].map((s) => s.id), ['a', 'b', 'c']);
});
ok('eldest pays in full; 2nd gets 10%, 3rd gets 20%', () => {
  const fam = b.siblingFamilies(kids);
  assert.equal(b.siblingDiscountFor(kids[0], fam, policy, 50000), null);
  assert.equal(b.siblingDiscountFor(kids[1], fam, policy, 50000).amount, 5000);
  assert.equal(b.siblingDiscountFor(kids[2], fam, policy, 50000).amount, 10000);
  assert.equal(b.siblingDiscountFor(kids[3], fam, policy, 50000), null);
});
ok('disabled policy gives nothing; fixed amount is capped at the fee', () => {
  const fam = b.siblingFamilies(kids);
  assert.equal(b.siblingDiscountFor(kids[1], fam, { ...policy, enabled: false }, 50000), null);
  assert.equal(b.siblingDiscountFor(kids[1], fam, { enabled: true, type: 'amount', tiers: { 2: 99999 } }, 3000).amount, 3000);
});
ok('discount needing approval is NOT put on the invoice until approved', () => {
  const sib = b.siblingDiscountFor(kids[1], b.siblingFamilies(kids), { ...policy, requireApproval: true }, 10000);
  const r = b.buildInvoiceItems({ structure: { items: [{ name: 'Tuition', amount: 10000 }] }, sibling: sib });
  assert.equal(r.total, 10000); assert.equal(r.pendingApprovals.length, 1);
  const r2 = b.buildInvoiceItems({ structure: { items: [{ name: 'Tuition', amount: 10000 }] }, sibling: b.siblingDiscountFor(kids[1], b.siblingFamilies(kids), policy, 10000) });
  assert.equal(r2.total, 9000);
});

console.log('Invoice building & segments');
ok('fees + optional + transport − approved adjustment; never below zero', () => {
  const r = b.buildInvoiceItems({ structure: { items: [{ name: 'Tuition', amount: 20000 }, { name: 'Lunch', amount: 3000 }] }, optionalLines: [{ name: 'Trip', amount: 1500, qty: 2, chargeId: 't' }], transportLine: { name: 'Transport', amount: 4000 }, adjustments: [{ id: 'x', status: 'approved', amount: 2000, reason: 'Bursary' }, { id: 'y', status: 'pending', amount: 9999, reason: 'no' }] });
  assert.equal(r.total, 28000); assert.equal(b.buildInvoiceItems({ structure: { items: [{ name: 'a', amount: 10 }] }, adjustments: [{ status: 'approved', amount: 50, reason: 'r' }] }).total, 0);
});
ok('segments: classes, streams, individuals, boarders/transport groups; inactive students excluded', () => {
  const st = [{ id: '1', classId: 'c1', streamId: 's1', status: 'active', boardingStatus: 'boarder' }, { id: '2', classId: 'c1', status: 'active' }, { id: '3', classId: 'c2', status: 'withdrawn' }, { id: '4', classId: 'c2', status: 'active', usesTransport: true }];
  const ids = (x) => x.map((s) => s.id).join();
  assert.equal(ids(b.selectSegment(st, { mode: 'classes', classIds: ['c1'] })), '1,2');
  assert.equal(ids(b.selectSegment(st, { mode: 'streams', streamIds: ['s1'] })), '1');
  assert.equal(ids(b.selectSegment(st, { mode: 'students', studentIds: ['4', '3'] })), '4');
  assert.equal(ids(b.selectSegment(st, { mode: 'groups', groups: ['boarders'] })), '1');
  assert.equal(ids(b.selectSegment(st, { mode: 'groups', groups: ['transport'] })), '4');
  assert.equal(ids(b.selectSegment(st, { mode: 'all' })), '1,2,4');
});
ok('duplicate invoice for same student/term/structure is detected; void ones do not block', () => {
  const inv = [{ studentId: 's', termId: 't', structureId: 'f', status: 'unpaid' }];
  assert.equal(b.isDuplicateInvoice(inv, 's', 't', 'f'), true);
  assert.equal(b.isDuplicateInvoice([{ ...inv[0], status: 'void' }], 's', 't', 'f'), false);
});

console.log('Reminders');
ok('reminders fire once per stage, only while money is owed, and never say delivered', () => {
  const invoices = [{ id: 'i', studentId: 's', totalAmount: 1000, dueDate: '2026-03-10' }, { id: 'j', studentId: 's', totalAmount: 1000, dueDate: '2026-03-10' }];
  const payments = [{ invoiceId: 'j', amount: 1000 }];
  const sched = [{ when: 'before', days: 7 }, { when: 'after', days: 7 }];
  let r = b.dueReminders({ invoices, payments, schedule: sched, existing: [], today: '2026-03-04' });
  assert.deepEqual(r.map((x) => x.key), ['i|before:7']);
  r = b.dueReminders({ invoices, payments, schedule: sched, existing: r, today: '2026-03-20' });
  assert.deepEqual(r.map((x) => x.key), ['i|after:7']);
  assert.ok(r.every((x) => !('status' in x) && !('deliveredAt' in x)));
  assert.equal(b.renderTemplate('Hi {parent}, {x}', { parent: 'Ann' }), 'Hi Ann, {x}');
});

console.log('Reconciliation');
ok('statement parsing handles headers, quotes and thousands separators', () => {
  const l = b.parseStatement('Date,Transaction Code,Amount\n2026-03-01,QWE1,"5,000.00"\n2026-03-02,QWE2,200');
  assert.deepEqual(l.map((x) => [x.reference, x.amount]), [['QWE1', 5000], ['QWE2', 200]]);
  assert.throws(() => b.parseStatement('a,b\n1,2'), /reference/);
});
ok('matches by reference+amount; flags mismatches, duplicates, unknown and already-confirmed', () => {
  const pays = [{ id: 'p1', reference: 'qwe1', amount: 5000, status: 'pending_verification' }, { id: 'p2', reference: 'QWE2', amount: 100, status: 'pending_verification' }, { id: 'p3', reference: 'DONE', amount: 1, status: 'confirmed' }];
  const r = b.reconcile([{ reference: 'QWE1', amount: 5000 }, { reference: 'QWE2', amount: 200 }, { reference: 'QWE1', amount: 5000 }, { reference: 'ZZZ', amount: 5 }, { reference: 'DONE', amount: 1 }], pays);
  assert.deepEqual(r.map((x) => x.result), ['match', 'amount_mismatch', 'duplicate_line', 'unmatched', 'already_confirmed']);
});

console.log('Refunds');
ok('limited to confirmed payments less refunds already committed; flow is one-way', () => {
  const pays = [{ studentId: 's', amount: 5000 }, { studentId: 's', amount: 9000, status: 'pending_verification' }];
  const refs = [{ studentId: 's', amount: 1000, status: 'approved' }, { studentId: 's', amount: 2000, status: 'rejected' }];
  assert.equal(b.refundableAmount('s', pays, refs), 4000);
  assert.match(b.validateRefund({ studentId: 's', amount: 4001, reason: 'x' }, pays, refs), /most that can be refunded/);
  assert.equal(b.validateRefund({ studentId: 's', amount: 4000, reason: 'Withdrew' }, pays, refs), null);
  assert.match(b.validateRefund({ studentId: 's', amount: 10, reason: ' ' }, pays, refs), /reason/);
  assert.equal(b.canTransition('requested', 'approved'), true); assert.equal(b.canTransition('requested', 'paid'), false); assert.equal(b.canTransition('paid', 'rejected'), false);
});

console.log('Reports');
ok('monthly trend counts confirmed only; aging buckets sum outstanding', () => {
  assert.deepEqual(b.monthlyCollections([{ date: '2026-01-05', amount: 10 }, { date: '2026-01-20', amount: 5 }, { date: '2026-02-01', amount: 7, status: 'pending_verification' }]), [['2026-01', 15]]);
  const a = b.agingBuckets([{ id: 'i', totalAmount: 1000, dueDate: '2026-01-01' }, { id: 'j', totalAmount: 500, dueDate: '2026-03-30' }], [], '2026-03-31');
  assert.equal(a['31–60 days'], 0); assert.equal(a['1–30 days'], 500); assert.equal(a['61–90 days'], 1000);
  assert.equal(b.toCsv([['a,b', 'c"d']]), '"a,b","c""d"');
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
