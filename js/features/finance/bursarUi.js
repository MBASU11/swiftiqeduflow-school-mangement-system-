// Small helpers shared by the Bursar Pack screens.
import { escapeHtml } from '../../components/dom.js';
import { fullName } from '../../services/studentService.js';

export const today = () => new Date().toISOString().slice(0, 10);
export const money = (d, v) => `${d.currency} ${Number(v || 0).toLocaleString('en-US')}`;
export const METHODS = [['cash', 'Cash'], ['mpesa', 'M-Pesa'], ['bank', 'Bank'], ['cheque', 'Cheque'], ['swiftiq_pay', 'SwiftIQ Pay'], ['other', 'Other']];
export const methodLabel = (m) => METHODS.find(([k]) => k === m)?.[1] ?? m;
export const sName = (d, id) => (d.studentById[id] ? fullName(d.studentById[id]) : '—');
export const badge = (tone, text) => `<span class="badge badge-${tone}">${escapeHtml(text)}</span>`;
export const TONE = { paid: 'good', partial: 'gold', unpaid: 'muted', void: 'muted', confirmed: 'good', pending_verification: 'gold', rejected: 'bad', requested: 'gold', approved: 'good', paid_out: 'good', queued: 'gold', handed_to_device: 'muted', pending: 'gold', revoked: 'bad', overdue: 'bad', upcoming: 'muted', active: 'good', cancelled: 'muted', completed: 'good', unmatched: 'bad', ambiguous: 'gold', suggested: 'gold', assigned: 'good', ignored: 'muted' };
export function download(name, text, type = 'text/csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
export const errBox = (e) => `<div class="notice" role="alert"><span>${escapeHtml(e?.message ?? e)}</span></div>`;
export const opt = (list, sel, label) => list.map((x) => `<option value="${escapeHtml(x.id)}" ${x.id === sel ? 'selected' : ''}>${escapeHtml(label(x))}</option>`).join('');
export const studentOptions = (d, sel = '') => `<option value="">Choose a learner…</option>${opt(d.students.filter((s) => (s.status ?? 'active') === 'active'), sel, (s) => `${fullName(s)} (${s.admissionNumber})`)}`;
