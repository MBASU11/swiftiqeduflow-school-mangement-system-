// Run: node tests/bursar3.test.mjs — Phase Three finance rules.
import assert from 'node:assert/strict';
import * as b from '../js/services/bursarLogic.js';
let fail = 0; const ok = (name, fn) => { try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', e.message); } };
const inv = (id, total, extra = {}) => ({ id, studentId: 's', totalAmount: total, status: 'unpaid', ...extra });

console.log('Credit notes');
ok('an APPROVED credit note lowers what the invoice is worth; pending/rejected ones do not; the invoice total is unchanged', () => {
  const i = inv('i', 10000); const cns = [{ invoiceId: 'i', amount: 1500, status: 'approved' }, { invoiceId: 'i', amount: 999, status: 'pending' }, { invoiceId: 'i', amount: 999, status: 'rejected' }];
  const f = b.invoiceFigures(i, [{ invoiceId: 'i', amount: 3000 }], '2026-01-01', cns);
  assert.deepEqual([f.gross, f.credits, f.billed, f.outstanding], [10000, 1500, 8500, 5500]); assert.equal(i.totalAmount, 10000);
});
ok('credit after payment can create an overpayment (a refund candidate), never a negative balance', () => {
  const f = b.invoiceFigures(inv('i', 5000), [{ invoiceId: 'i', amount: 5000 }], '2026-01-01', [{ invoiceId: 'i', amount: 2000, status: 'approved' }]);
  assert.deepEqual([f.outstanding, f.overpaid, f.status], [0, 2000, 'paid']);
});
ok('validation: needs a reason, an amount, and cannot credit more than the invoice (counting earlier credits)', () => {
  const i = inv('i', 1000);
  assert.match(b.validateCreditNote({ invoice: i, amount: 100, reason: ' ' }), /reason/); assert.match(b.validateCreditNote({ invoice: i, amount: 0, reason: 'x' }), /greater than zero/);
  assert.match(b.validateCreditNote({ invoice: i, amount: 700, reason: 'x' }, [{ invoiceId: 'i', amount: 400, status: 'approved' }]), /At most 600/);
  assert.equal(b.validateCreditNote({ invoice: i, amount: 700, reason: 'x' }, [{ invoiceId: 'i', amount: 400, status: 'rejected' }]), null);
  assert.match(b.validateCreditNote({ invoice: { ...i, status: 'void' }, amount: 1, reason: 'x' }), /void/);
});

console.log('Split payments and allocation');
ok('one payment split across invoices counts toward each; legacy single-invoice payments still work', () => {
  const pay = [{ id: 'p', studentId: 's', amount: 9000, allocations: [{ invoiceId: 'a', amount: 6000 }, { invoiceId: 'b', amount: 3000 }] }, { id: 'q', studentId: 's', invoiceId: 'a', amount: 1000 }];
  assert.equal(b.paidOn(inv('a', 8000), pay), 7000); assert.equal(b.paidOn(inv('b', 8000), pay), 3000);
});
ok('only confirmed allocations count', () => assert.equal(b.paidOn(inv('a', 1), [{ invoiceId: 'a', amount: 5, status: 'pending_verification' }, { invoiceId: 'a', amount: 7, status: 'rejected' }]), 0));
ok('auto allocation pays the oldest due invoice first and returns any credit left over', () => {
  const r = b.autoAllocate(12000, [{ id: 'new', outstanding: 5000, dueDate: '2026-05-01' }, { id: 'old', outstanding: 8000, dueDate: '2026-01-01' }, { id: 'paid', outstanding: 0, dueDate: '2025-01-01' }]);
  assert.deepEqual(r.allocations, [{ invoiceId: 'old', amount: 8000 }, { invoiceId: 'new', amount: 4000 }]); assert.equal(r.remainder, 0);
  assert.equal(b.autoAllocate(20000, [{ id: 'x', outstanding: 5000, dueDate: 'd' }]).remainder, 15000);
});
ok('manual allocation: no duplicates, no foreign invoices, never more than owed or than the payment', () => {
  const out = { a: 5000, b: 2000 }; const pay = { amount: 6000 };
  assert.equal(b.validateAllocation(pay, [{ invoiceId: 'a', amount: 4000 }, { invoiceId: 'b', amount: 2000 }], out), null);
  assert.match(b.validateAllocation(pay, [{ invoiceId: 'a', amount: 4000 }, { invoiceId: 'a', amount: 1 }], out), /once/);
  assert.match(b.validateAllocation(pay, [{ invoiceId: 'zzz', amount: 1 }], out), /does not belong/);
  assert.match(b.validateAllocation(pay, [{ invoiceId: 'b', amount: 3000 }], out), /still owes/);
  assert.match(b.validateAllocation(pay, [{ invoiceId: 'a', amount: 5000 }, { invoiceId: 'b', amount: 2000 }], out), /more than the payment/);
  assert.match(b.validateAllocation(pay, [], out), /at least one/);
});
ok('payment rules: overpaying an invoice is refused unless the school allows it', () => {
  assert.match(b.checkPaymentAgainstRules(6000, 5000, b.DEFAULT_RULES), /more than the outstanding/);
  assert.equal(b.checkPaymentAgainstRules(5000, 5000, b.DEFAULT_RULES), null); assert.equal(b.checkPaymentAgainstRules(9000, 5000, { ...b.DEFAULT_RULES, allowOverpayment: true }), null);
});

console.log('Installment plans');
ok('schedule: equal whole-shilling parts that always add up exactly; month ends handled', () => {
  const { schedule } = b.buildSchedule({ outstanding: 10000, count: 3, firstDue: '2026-01-31' });
  assert.deepEqual(schedule.map((s) => s.amount), [3333, 3333, 3334]); assert.equal(schedule.reduce((t, s) => t + s.amount, 0), 10000);
  assert.deepEqual(schedule.map((s) => s.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(b.addMonths('2024-01-31', 1), '2024-02-29');
});
ok('schedule rules: 2–12 installments, minimum size, needs a balance and a start date', () => {
  const r = { ...b.DEFAULT_RULES, minInstallment: 1000 };
  assert.match(b.buildSchedule({ outstanding: 10000, count: 1, firstDue: '2026-01-01' }).error, /at least 2/); assert.match(b.buildSchedule({ outstanding: 10000, count: 13, firstDue: '2026-01-01' }).error, /at most 12/);
  assert.match(b.buildSchedule({ outstanding: 3000, count: 4, firstDue: '2026-01-01' }, r).error, /at least 1,000/); assert.match(b.buildSchedule({ outstanding: 0, count: 3, firstDue: '2026-01-01' }).error, /Nothing is owed/);
  assert.match(b.buildSchedule({ outstanding: 9000, count: 3, firstDue: '' }).error, /first due/);
});
const planOf = () => ({ invoiceId: 'i', status: 'active', basePaid: 2000, schedule: [{ no: 1, dueDate: '2026-02-01', amount: 3000 }, { no: 2, dueDate: '2026-03-01', amount: 3000 }, { no: 3, dueDate: '2026-04-01', amount: 2000 }] });
ok('progress: payments since the plan was made fill installments oldest first; overdue and next are flagged', () => {
  const i = inv('i', 10000); const pay = [{ invoiceId: 'i', amount: 2000 }, { invoiceId: 'i', amount: 4000 }];     // 2000 was paid BEFORE the plan
  const p = b.planProgress(planOf(), i, pay, [], '2026-03-15');
  assert.deepEqual(p.installments.map((x) => [x.paid, x.status]), [[3000, 'paid'], [1000, 'overdue'], [0, 'upcoming']]); assert.equal(p.next.no, 2); assert.equal(p.overdue, 1); assert.equal(p.completed, false);
  assert.equal(b.planProgress(planOf(), i, [{ invoiceId: 'i', amount: 10000 }], [], '2026-03-15').completed, true);
});
ok('reminders follow the next unpaid INSTALLMENT, one per installment per stage', () => {
  const i = inv('i', 10000, { dueDate: '2026-04-01' }); const plans = [planOf()]; const sched = [{ when: 'before', days: 3 }];
  const r1 = b.dueReminders({ invoices: [i], payments: [{ invoiceId: 'i', amount: 2000 }], schedule: sched, existing: [], today: '2026-01-30', plans });
  assert.deepEqual(r1.map((x) => [x.key, x.outstanding]), [['i|before:3:i1', 3000]]);
  const r2 = b.dueReminders({ invoices: [i], payments: [{ invoiceId: 'i', amount: 5000 }], schedule: sched, existing: r1, today: '2026-02-27', plans });
  assert.deepEqual(r2.map((x) => x.key), ['i|before:3:i2']);
  assert.equal(b.dueReminders({ invoices: [i], payments: [{ invoiceId: 'i', amount: 5000 }], schedule: sched, existing: [...r1, ...r2], today: '2026-02-27', plans }).length, 0);
});

console.log('Scholarships and sponsorships');
const award = (o) => ({ id: 'a1', type: 'scholarship', studentId: 's', kind: 'percent', value: 50, status: 'approved', ...o });
ok('percent and fixed awards are capped at the fees; only approved, in-date awards are active', () => {
  assert.equal(b.awardDiscount(award({}), 40000).amount, 20000); assert.equal(b.awardDiscount(award({ kind: 'amount', value: 90000 }), 40000).amount, 40000);
  assert.equal(b.awardActive(award({}), '2026-02-01'), true); assert.equal(b.awardActive(award({ status: 'pending' }), '2026-02-01'), false);
  assert.equal(b.awardActive(award({ validFrom: '2026-03-01' }), '2026-02-01'), false); assert.equal(b.awardActive(award({ validTo: '2026-01-31' }), '2026-02-01'), false);
});
ok('validation', () => {
  assert.match(b.validateAward({ studentId: 's', type: 'sponsorship', kind: 'percent', value: 10 }), /sponsor/); assert.match(b.validateAward({ studentId: 's', type: 'scholarship', kind: 'percent', value: 150 }), /100/);
  assert.equal(b.validateAward({ studentId: 's', type: 'sponsorship', sponsor: 'Equity', kind: 'amount', value: 5000 }), null);
});
ok('discounts stack in order but can never push the bill below zero; each line shows what it really removed', () => {
  const st = { items: [{ name: 'Tuition', amount: 10000 }] };
  const aw = [b.awardDiscount(award({ kind: 'percent', value: 80 }), 10000), b.awardDiscount(award({ id: 'a2', type: 'sponsorship', sponsor: 'Equity', kind: 'amount', value: 5000 }), 10000)];
  const sib = { amount: 3000, label: 'Sibling', needsApproval: false };
  const r = b.buildInvoiceItems({ structure: st, awards: aw, sibling: sib });
  assert.equal(r.total, 0); assert.deepEqual(r.items.slice(1).map((x) => x.amount), [-8000, -2000]);
  assert.equal(b.buildInvoiceItems({ structure: st, awards: [aw[0]], sibling: sib }).total, 0); // 2000 left, sibling capped at 2000
});
ok('sponsor balances: invoiced to the sponsor less what the sponsor has paid (confirmed only)', () => {
  const invs = [{ id: 'i1', items: [{ kind: 'award', sponsor: 'Equity', amount: -5000 }] }, { id: 'i2', items: [{ kind: 'award', sponsor: 'Equity', amount: -3000 }, { kind: 'award', sponsor: 'KCB', amount: -1000 }] }, { id: 'v', status: 'void', items: [{ kind: 'award', sponsor: 'KCB', amount: -9999 }] }];
  const r = b.sponsorBalances(invs, [{ sponsor: 'Equity', amount: 6000 }, { sponsor: 'Equity', amount: 500, status: 'pending_verification' }]);
  assert.deepEqual(r.map((x) => [x.sponsor, x.claimed, x.paid, x.balance]), [['Equity', 8000, 6000, 2000], ['KCB', 1000, 0, 1000]]);
});

console.log('Statements and the books always agree');
ok('statement: running balance, opening balance, and period totals', () => {
  const st = b.buildStatement({ studentId: 's', invoices: [inv('i', 10000, { number: 'INV-1', issueDate: '2026-01-05' })], payments: [{ studentId: 's', amount: 4000, date: '2026-01-20', method: 'mpesa', reference: 'Q1' }, { studentId: 's', amount: 999, date: '2026-01-21', status: 'pending_verification' }], creditNotes: [{ studentId: 's', amount: 1000, status: 'approved', number: 'CN-1', reason: 'Error', decidedAt: '2026-02-02T10:00:00Z' }], refunds: [{ studentId: 's', amount: 500, status: 'paid', reason: 'Overpaid', paidAt: '2026-02-10' }] });
  assert.deepEqual(st.lines.map((l) => [l.type, l.balance]), [['invoice', 10000], ['payment', 6000], ['credit_note', 5000], ['refund', 5500]]); assert.equal(st.closing, 5500);
  const feb = b.buildStatement({ studentId: 's', invoices: [inv('i', 10000, { issueDate: '2026-01-05' })], payments: [{ studentId: 's', amount: 4000, date: '2026-01-20' }], from: '2026-02-01' }); assert.equal(feb.opening, 6000); assert.equal(feb.lines.length, 0);
});
ok('PROPERTY: for 300 random families, statement closing balance = billed − credits − paid + refunded = studentFigures', () => {
  let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; const pick = (n) => Math.floor(rnd() * n);
  for (let t = 0; t < 300; t++) {
    const invoices = Array.from({ length: 1 + pick(4) }, (_, k) => inv(`i${k}`, 1000 * (1 + pick(50)), { issueDate: `2026-0${1 + pick(9)}-1${pick(9)}`, status: pick(8) === 0 ? 'void' : 'unpaid' }));
    const payments = Array.from({ length: pick(6) }, () => ({ studentId: 's', invoiceId: pick(3) ? `i${pick(invoices.length)}` : undefined, amount: 100 * (1 + pick(300)), date: `2026-0${1 + pick(9)}-2${pick(9)}`, method: 'cash', status: ['confirmed', undefined, 'pending_verification', 'rejected'][pick(4)] }));
    const live = invoices.filter((i) => i.status !== 'void');
    const creditNotes = live.slice(0, pick(3)).map((i) => ({ studentId: 's', invoiceId: i.id, amount: Math.min(i.totalAmount, 100 * (1 + pick(20))), status: ['approved', 'pending', 'rejected'][pick(3)], decidedAt: '2026-06-01' }));
    const refunds = Array.from({ length: pick(3) }, () => ({ studentId: 's', amount: 100 * (1 + pick(30)), status: ['paid', 'requested', 'approved'][pick(3)], paidAt: '2026-07-01' }));
    const sf = b.studentFigures('s', invoices, payments, refunds, creditNotes); const st = b.buildStatement({ studentId: 's', invoices, payments, creditNotes, refunds });
    const net = sf.billed - sf.paid;                                  // billed after credits, minus money kept after refunds
    assert.equal(st.closing, net, `trial ${t}: statement ${st.closing} vs figures ${net}`);
    assert.equal(Math.max(0, st.closing), sf.outstanding); assert.equal(Math.max(0, -st.closing), sf.overpaid);
  }
});

console.log('Cashbook');
ok('receipts in, refunds and expenses out, running balance, opening balance, totals per account; pending/rejected excluded', () => {
  const cb = b.buildCashbook({ payments: [{ date: '2026-01-10', amount: 5000, method: 'mpesa', reference: 'Q1' }, { date: '2026-01-11', amount: 2000, method: 'cash' }, { date: '2026-01-12', amount: 9999, method: 'bank', status: 'pending_verification' }], refunds: [{ status: 'paid', amount: 500, paidAt: '2026-01-15', reason: 'x', payoutReference: 'R1' }, { status: 'requested', amount: 9, paidAt: '2026-01-16' }], expenses: [{ date: '2026-01-13', amount: 1200, category: 'Stationery', method: 'cash' }], sponsorPayments: [{ date: '2026-01-14', amount: 3000, method: 'bank', sponsor: 'Equity' }] });
  assert.equal(cb.totalIn, 10000); assert.equal(cb.totalOut, 1700); assert.equal(cb.closing, 8300); assert.deepEqual(cb.lines.map((l) => l.balance), [5000, 7000, 5800, 8800, 8300]); assert.deepEqual(cb.byAccount.Bank, { inn: 3000, out: 0 });
  const feb = b.buildCashbook({ payments: [{ date: '2026-01-10', amount: 5000, method: 'cash' }, { date: '2026-02-02', amount: 100, method: 'cash' }], from: '2026-02-01' }); assert.equal(feb.opening, 5000); assert.equal(feb.closing, 5100);
});

console.log('Unmatched transactions queue');
const studs = [{ id: 'a', admissionNumber: 'ADM-101', status: 'active' }, { id: 'b', admissionNumber: 'ADM-102', status: 'active' }, { id: 'c', admissionNumber: '5', status: 'active' }, { id: 'd', admissionNumber: 'ADM-103', status: 'withdrawn' }];
ok('each line is matched, suggested (one learner), ambiguous, unmatched, or already known — nothing is ever auto-confirmed', () => {
  const pays = [{ reference: 'P1', amount: 100, status: 'pending_verification' }, { reference: 'DONE', amount: 1, status: 'confirmed' }];
  const r = b.classifyTransactions([{ reference: 'p1', amount: 100 }, { reference: 'Z1', amount: 50, account: 'ADM 101 term 1' }, { reference: 'Z2', amount: 50, account: 'ADM-101 and ADM-102' }, { reference: 'Z3', amount: 50, account: 'school fees' }, { reference: 'DONE', amount: 1 }, { reference: 'Z1', amount: 50 }, { reference: 'Z4', amount: 5, account: 'fees for 5' }, { reference: 'Z5', amount: 5, account: 'ADM-103' }], { payments: pays, students: studs, known: [] });
  assert.deepEqual(r.map((x) => x.result), ['match', 'suggested', 'ambiguous', 'unmatched', 'already_known', 'duplicate_line', 'suggested', 'unmatched']);
  assert.equal(r[1].student.id, 'a'); assert.equal(r[6].student.id, 'c'); assert.deepEqual(r[2].candidates.map((s) => s.id), ['a', 'b']);
});
ok('a reference already in the queue or on a confirmed payment is "already known" (so importing a statement twice adds nothing)', () => {
  const r = b.classifyTransactions([{ reference: 'Q9', amount: 1 }], { payments: [], students: studs, known: [{ reference: 'q9' }] }); assert.equal(r[0].result, 'already_known');
});
ok('statement parser keeps an account/narrative column', () => assert.equal(b.parseStatement('Date,Transaction Code,Amount,Account Narrative\n2026-01-01,Q1,"1,000",ADM-101').at(0).account, 'ADM-101'));

console.log('Dashboard and audit');
ok('metrics: expected net of credits, collected, outstanding, collection %, unmatched, daily totals', () => {
  const invs = [inv('a', 10000, { dueDate: '2026-01-01' }), inv('b', 5000)];
  const m = b.bursarMetrics({ invoices: invs, payments: [{ invoiceId: 'a', amount: 4000, date: '2026-03-02' }, { invoiceId: 'a', amount: 1000, date: '2026-03-02' }, { invoiceId: 'b', amount: 777, status: 'pending_verification', date: '2026-03-02' }], refunds: [{ status: 'requested' }, { status: 'paid' }], creditNotes: [{ invoiceId: 'b', amount: 1000, status: 'approved' }], bankTx: [{ status: 'unmatched', amount: 200 }, { status: 'assigned', amount: 9 }], today: '2026-03-10' });
  assert.deepEqual([m.expected, m.collected, m.outstanding, m.collectionPct, m.overdue, m.pending, m.unmatched, m.unmatchedAmount, m.pendingRefunds], [14000, 5000, 9000, 35.7, 1, 1, 1, 200, 1]);
  assert.deepEqual(m.daily, [{ date: '2026-03-02', count: 2, total: 5000 }]);
  assert.equal(b.bursarMetrics({ invoices: [], payments: [], today: 'x' }).collectionPct, null);
});
ok('class summaries add up to the totals', () => {
  const invs = [inv('a', 10000, { cls: 'G4' }), inv('b', 6000, { cls: 'G4' }), inv('c', 8000, { cls: 'G5' })];
  const rows = b.summaryBy(invs, [{ invoiceId: 'a', amount: 10000 }, { invoiceId: 'c', amount: 2000 }], [], (i) => i.cls);
  assert.deepEqual(rows.map((r) => [r.key, r.billed, r.paid, r.outstanding, r.pct]), [['G4', 16000, 10000, 6000, 63], ['G5', 8000, 2000, 6000, 25]]);
});
ok('audit view keeps only finance changes', () => assert.deepEqual(b.financeAudit([{ entityType: 'payments' }, { entityType: 'students' }, { entityType: 'creditNotes' }]).map((e) => e.entityType), ['payments', 'creditNotes']));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
