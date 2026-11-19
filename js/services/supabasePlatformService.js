import { getPlan } from '../config/plans.js';
import { buildQuote, getCatalogue } from './packageService.js';
import { MIN_PASSWORD_LENGTH } from '../lib/passwords.js';
import { getSupabaseClient } from './supabaseClient.js';

const DEFAULT_SETTINGS = { businessName: 'SwiftIQ Enterprise', paymentInstructions: '', contactLine: 'Nairobi, Kenya · 0742 210 099 · swiftiqenterprise@gmail.com' };

function invoiceTotals(invoice) {
  const total = invoice.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return { total, paid, balance: total - paid };
}

function withInvoiceStatus(invoice) {
  const totals = invoiceTotals(invoice);
  const status = invoice.voided ? 'void' : totals.total > 0 && totals.paid >= totals.total ? 'paid' : totals.paid > 0 ? 'partial' : 'unpaid';
  return { ...invoice, ...totals, status };
}

function mapInvoice(row, paymentRows) {
  return withInvoiceStatus({
    id: row.id,
    number: row.number,
    accountId: row.school_id,
    items: row.items,
    issueDate: row.issue_date,
    dueDate: row.due_date ?? undefined,
    note: row.note ?? undefined,
    payments: paymentRows.map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount),
      method: payment.method,
      reference: payment.reference ?? undefined,
      date: payment.received_on,
      recordedBy: payment.recorded_by ?? undefined,
    })),
    voided: row.voided,
    createdAt: row.created_at,
  });
}

async function loadInvoices() {
  const client = await getSupabaseClient();
  const [invoiceResult, paymentResult] = await Promise.all([
    client.from('platform_invoices').select('*').order('created_at', { ascending: false }),
    client.from('platform_invoice_payments').select('*').order('created_at'),
  ]);
  if (invoiceResult.error) throw invoiceResult.error;
  if (paymentResult.error) throw paymentResult.error;

  const paymentsByInvoice = new Map();
  for (const payment of paymentResult.data) {
    const list = paymentsByInvoice.get(payment.invoice_id) ?? [];
    list.push(payment);
    paymentsByInvoice.set(payment.invoice_id, list);
  }
  return invoiceResult.data.map((invoice) => mapInvoice(invoice, paymentsByInvoice.get(invoice.id) ?? []));
}

function paymentStateFor(invoices) {
  const live = invoices.filter((invoice) => invoice.status !== 'void');
  if (live.length === 0) return { state: 'none', invoiced: 0, paid: 0, balance: 0 };
  const invoiced = live.reduce((sum, invoice) => sum + invoice.total, 0);
  const paid = live.reduce((sum, invoice) => sum + invoice.paid, 0);
  return {
    state: live.every((invoice) => invoice.status === 'paid') ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
    invoiced,
    paid,
    balance: invoiced - paid,
  };
}

function mapSchool(row, history, invoices) {
  return {
    id: row.id,
    name: row.contact_name,
    schoolName: row.name,
    email: row.email,
    phone: row.phone ?? undefined,
    countyCode: row.county_code ?? undefined,
    schoolType: row.school_type ?? undefined,
    plan: { planId: row.plan_id, name: row.plan_name, billing: ['monthly', 'termly', 'annual'].includes(row.plan_modules) ? row.plan_modules : 'annual' },
    studentCount: row.student_count ?? undefined,
    role: 'admin',
    status: row.status,
    statusNote: row.status_note ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    createdAt: row.registered_at,
    history: history.map((entry) => ({
      at: entry.happened_at,
      action: entry.action,
      by: entry.actor_user_id ? 'Platform administrator' : 'System',
      note: entry.note ?? undefined,
    })),
    payment: paymentStateFor(invoices.filter((invoice) => invoice.accountId === row.id)),
  };
}

export async function getPlatformSettings() {
  const client = await getSupabaseClient();
  const { data, error } = await client.from('platform_settings').select('value').eq('key', 'main').maybeSingle();
  if (error) throw error;
  return { ...DEFAULT_SETTINGS, ...(data?.value ?? {}) };
}

export async function savePlatformSettings(patch) {
  const client = await getSupabaseClient();
  const next = { ...(await getPlatformSettings()), ...patch };
  const { error } = await client.from('platform_settings').upsert({ key: 'main', value: next }, { onConflict: 'key' });
  if (error) throw error;
  return next;
}

export async function changeAdminPassword(_adminId, current, next, confirm) {
  if (!next || next.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.` };
  }
  if (next !== confirm) return { ok: false, error: "The two new passwords don't match." };

  const client = await getSupabaseClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user?.email) {
    return { ok: false, error: userError?.message ?? 'Your administrator session has expired.' };
  }
  const { error: verifyError } = await client.auth.signInWithPassword({
    email: userData.user.email,
    password: current || '',
  });
  if (verifyError) return { ok: false, error: 'Your current password is incorrect.' };
  const { error } = await client.auth.updateUser({ password: next });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export function defaultInvoiceItems(account, extra = {}) {
  const pkg = getPlan(account.plan?.planId);
  if (!pkg) return [{ description: 'Package', amount: 0 }];
  const quote = buildQuote({ packageId: pkg.id, billing: account.plan?.billing ?? 'annual', addons: extra.addons ?? [], charges: extra.charges ?? [] }, getCatalogue());
  return quote.lines.map((l) => ({ description: l.amount == null ? `${l.label} (price to be confirmed)` : l.label, amount: l.amount ?? 0 }));
}

export function validateInvoice(items, dueDate) {
  const errors = [];
  const cleaned = items.filter((item) => String(item.description).trim() !== '' || String(item.amount).trim() !== '');
  if (cleaned.length === 0) errors.push('Add at least one line to the invoice.');
  cleaned.forEach((item, index) => {
    if (!String(item.description).trim()) errors.push(`Line ${index + 1} needs a description.`);
    if (String(item.amount).trim() === '' || Number.isNaN(Number(item.amount))) errors.push(`Line ${index + 1} needs an amount.`);
  });
  if (cleaned.length && cleaned.reduce((sum, item) => sum + Number(item.amount || 0), 0) <= 0) {
    errors.push('The invoice total must be more than zero.');
  }
  if (dueDate && Number.isNaN(Date.parse(dueDate))) errors.push('The due date is not a valid date.');
  return { errors, items: cleaned.map((item) => ({ description: String(item.description).trim(), amount: Number(item.amount) })) };
}

export async function createInvoice(schoolId, { items, dueDate, note }) {
  const client = await getSupabaseClient();
  const { data, error } = await client.from('platform_invoices').insert({
    school_id: schoolId,
    number: '',
    items,
    due_date: dueDate || null,
    note: note?.trim() || null,
  }).select('*').single();
  if (error) throw error;
  return mapInvoice(data, []);
}

export async function recordInvoicePayment(invoiceId, { amount, method, reference, date }) {
  const client = await getSupabaseClient();
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: 'Enter the amount received.' };
  if (!date || Number.isNaN(Date.parse(date))) return { ok: false, error: 'Enter the date the payment was received.' };
  const { error } = await client.from('platform_invoice_payments').insert({
    invoice_id: invoiceId,
    amount: value,
    method,
    reference: reference?.trim() || null,
    received_on: date,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function voidInvoice(invoiceId) {
  const client = await getSupabaseClient();
  const { error } = await client.from('platform_invoices').update({ voided: true }).eq('id', invoiceId);
  if (error) throw error;
}

export async function invoicesForAccount(schoolId) {
  return (await loadInvoices()).filter((invoice) => invoice.accountId === schoolId);
}

export async function paymentState(schoolId) {
  return paymentStateFor(await invoicesForAccount(schoolId));
}

export async function allInvoices() {
  return loadInvoices();
}

export async function getInvoice(id) {
  return (await loadInvoices()).find((invoice) => invoice.id === id);
}

export async function listSchools() {
  const client = await getSupabaseClient();
  const [schoolResult, historyResult, invoices] = await Promise.all([
    client.from('schools').select('*').order('registered_at', { ascending: false }),
    client.from('school_history').select('*').order('happened_at'),
    loadInvoices(),
  ]);
  if (schoolResult.error) throw schoolResult.error;
  if (historyResult.error) throw historyResult.error;
  const historyBySchool = new Map();
  for (const entry of historyResult.data) {
    const list = historyBySchool.get(entry.school_id) ?? [];
    list.push(entry);
    historyBySchool.set(entry.school_id, list);
  }
  return schoolResult.data.map((school) => mapSchool(school, historyBySchool.get(school.id) ?? [], invoices));
}

export async function getSchool(id) {
  return (await listSchools()).find((school) => school.id === id);
}

export async function deleteSchool(schoolId) {
  const client = await getSupabaseClient();
  const { error } = await client.rpc('delete_school', { target_school_id: schoolId });
  if (error) throw error;
}

export async function setSchoolStatus(schoolId, status, note) {
  if (!['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
    throw new Error('Choose a valid school status.');
  }
  const client = await getSupabaseClient();
  const { error } = await client.from('schools')
    .update({ status, status_note: note?.trim() || null })
    .eq('id', schoolId);
  if (error) throw error;
}

export async function changeSchoolPlan(schoolId, planId, billing) {
  const plan = getPlan(planId);
  if (!plan) return false;
  const client = await getSupabaseClient();
  const { error } = await client.from('schools').update({
    plan_id: plan.id,
    plan_name: plan.name,
    plan_modules: ['monthly', 'termly', 'annual'].includes(billing) ? billing : 'annual', // holds billing frequency now
  }).eq('id', schoolId);
  if (error) throw error;
  return true;
}