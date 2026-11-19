// The student profile tabs that read from other modules (demo mode): Academics, Attendance, Finance, Discipline, Health, Transport, Activities.
// Each tab says plainly when the person may not see it or the school's package does not include the module, instead of looking empty.
import { escapeHtml } from '../../components/dom.js';
import { canReadCollection } from '../../services/accessService.js';
import { moduleEnabled, featureEnabled } from '../../services/subscriptionService.js';
import { loadCompetency } from '../../services/competencyService.js';
import * as CL from '../../services/competencyLogic.js';
import { getSchool } from '../../services/schoolService.js';
import { classRepo } from '../../services/academicService.js';
import { examinationRepo } from '../../services/examService.js';
import { loadReportData, buildClassResults } from '../../services/reportCardService.js';
import { attendanceRepo } from '../../services/attendanceService.js';
import { getInvoicesForStudent, getPaymentsForStudent, studentTotals, invoicePaidAmount } from '../../services/financeService.js';
import { getRecordsForStudent, CATEGORIES as DISCIPLINE_CATEGORIES } from '../../services/disciplineService.js';
import { getAssignmentForStudent, routeRepo, vehicleRepo } from '../../services/transportService.js';
import { activitiesOfStudent, achievementRepo, memberAttendance } from '../../services/activitiesService.js';
import { getProfile, logAccess, immunisationsOf, visitsOf, medsOf } from '../../services/healthService.js';
import { isSevere, profileGaps, overdueImmunisations, SEVERITY } from '../../services/healthLogic.js';

const card = (inner) => `<div class="card card-p space-y-2">${inner}</div>`;
const note = (text) => `<div class="card card-p"><p class="text-sm text-ink-500">${escapeHtml(text)}</p></div>`;
const h = (t) => `<h3 class="text-sm text-ink-700" style="font-weight:600;">${escapeHtml(t)}</h3>`;
const money = (n) => `${escapeHtml(getSchool()?.currency || 'KES')} ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const row = (a, b) => `<div class="flex justify-between gap-3 text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><span>${a}</span><span>${b}</span></div>`;
const gate = (moduleKey, collection) => (!moduleEnabled(moduleKey) ? note('This is not included in your school\'s package.') : !canReadCollection(collection) ? note('Your role does not have access to this information.') : null);

async function academics(student) {
  const data = await loadReportData(); const cls = classRepo.getById(student.classId);
  const exams = examinationRepo.getAll().filter((e) => (e.classIds ?? []).includes(student.classId)).sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
  const rows = exams.map((e) => { const r = buildClassResults(data, e.id, student.classId); const rep = r.reports.get(student.id); return rep && rep.subjectsScored ? { e, rep, pos: r.positions.get(student.id), of: r.rankedCount } : null; }).filter(Boolean);
  if (!rows.length) return note(`No marks have been entered for ${cls?.name ?? 'this class'} yet.`);
  return rows.map(({ e, rep, pos, of }) => card(`${h(e.name)}<p class="text-xs text-ink-500">Average ${rep.average ?? '—'}${rep.overallGrade ? ` · Grade ${escapeHtml(rep.overallGrade)}` : ''}${pos ? ` · Position ${pos} of ${of}` : ''}</p>
    ${rep.rows.map((s) => row(escapeHtml(s.subjectName), s.score === null ? '—' : `${s.score}${s.grade ? ` (${escapeHtml(s.grade)})` : ''}`)).join('')}`)).join('');
}

function attendance(student) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const all = attendanceRepo.getAll().filter((a) => a.studentId === student.id).sort((a, b) => b.date.localeCompare(a.date)); const recent = all.filter((a) => a.date >= since);
  if (!all.length) return note('No attendance has been recorded for this learner yet.');
  const n = (s) => recent.filter((a) => a.status === s).length; const here = n('present') + n('late'); const pct = recent.length ? Math.round((here / recent.length) * 100) : null;
  const away = all.filter((a) => a.status !== 'present').slice(0, 10);
  return card(`${h('Last 30 days')}<p class="text-sm"><b>${pct === null ? '—' : `${pct}%`}</b> present · ${n('present')} present, ${n('late')} late, ${n('absent')} absent, ${n('excused')} excused (${recent.length} days recorded)</p>
    ${away.length ? `${h('Recent absences and lateness')}${away.map((a) => row(escapeHtml(a.date), `<span class="capitalize">${escapeHtml(a.status)}</span>`)).join('')}` : '<p class="text-sm text-ink-500">No absences recorded.</p>'}`);
}

function finance(student) {
  const blocked = gate('finance', 'invoices'); if (blocked) return blocked;
  const t = studentTotals(student.id); const inv = getInvoicesForStudent(student.id).filter((i) => i.status !== 'void'); const pays = getPaymentsForStudent(student.id).slice(0, 8);
  return card(`${h('Fees')}<div class="grid grid-2 gap-2"><div><p class="text-xs text-ink-500">Invoiced</p><b>${money(t.totalInvoiced)}</b></div><div><p class="text-xs text-ink-500">Paid</p><b>${money(t.totalPaid)}</b></div><div><p class="text-xs text-ink-500">Balance</p><b style="${t.balance > 0 ? 'color:var(--bad);' : ''}">${money(t.balance)}</b></div></div>
    ${inv.length ? `${h('Invoices')}${inv.map((i) => row(`${escapeHtml(i.number ?? i.title ?? 'Invoice')} <span class="text-xs text-ink-500">${escapeHtml(i.dueDate ?? '')}</span>`, `${money(i.totalAmount)} <span class="text-xs text-ink-500">(paid ${money(invoicePaidAmount(i.id))})</span>`)).join('')}` : '<p class="text-sm text-ink-500">No invoices yet.</p>'}
    ${pays.length ? `${h('Latest payments')}${pays.map((p) => row(`${escapeHtml(p.date)} <span class="text-xs text-ink-500 capitalize">${escapeHtml(p.method ?? '')}${p.reference ? ` · ${escapeHtml(p.reference)}` : ''}${p.status && p.status !== 'confirmed' ? ` · ${escapeHtml(p.status)}` : ''}</span>`, money(p.amount))).join('')}` : ''}
    <p class="text-xs text-ink-400">Statements and receipts are under Finance.</p>`);
}

function discipline(student) {
  const blocked = gate('discipline', 'discipline'); if (blocked) return blocked;
  const recs = getRecordsForStudent(student.id); const label = Object.fromEntries(DISCIPLINE_CATEGORIES);
  return recs.length ? card(`${h('Discipline record (confidential)')}${recs.map((r) => `<div style="border-top:1px solid var(--ink-100);padding:.4rem 0;" class="text-sm"><b>${escapeHtml(r.date)}</b> · ${escapeHtml(label[r.category] ?? r.category)}${r.status ? ` · <span class="capitalize">${escapeHtml(r.status)}</span>` : ''}<br/><span class="text-xs text-ink-500">${escapeHtml(r.description ?? '')}${r.followUpDate ? ` · follow-up ${escapeHtml(r.followUpDate)}` : ''}</span></div>`).join('')}`) : note('No discipline records for this learner.');
}

function transport(student) {
  const blocked = gate('transport', 'transportAssignments'); if (blocked) return blocked;
  const a = getAssignmentForStudent(student.id); if (!a) return note(student.usesTransport ? 'Marked as using school transport, but no route has been assigned yet.' : 'This learner does not use school transport.');
  const route = routeRepo.getById(a.routeId); const stop = (route?.stops ?? []).find((s) => s.id === a.stopId); const vehicle = vehicleRepo.getById(route?.vehicleId);
  return card(`${h('School transport')}${row('Route', escapeHtml(route?.name ?? 'Unknown route'))}${row('Stop', escapeHtml(stop?.name ?? '—'))}${vehicle ? row('Vehicle', escapeHtml(vehicle.registration ?? vehicle.name ?? '')) : ''}`);
}

function activities(student) {
  const blocked = gate('activities', 'activityMembers'); if (blocked) return blocked;
  const mine = activitiesOfStudent(student.id); const wins = achievementRepo.getAll().filter((w) => w.studentId === student.id).sort((a, b) => b.date.localeCompare(a.date));
  if (!mine.length && !wins.length) return note('This learner is not in any club, sport or society.');
  return card(`${h('Clubs, sports and societies')}${mine.map(({ member, activity }) => { const att = memberAttendance(member); return row(`<b>${escapeHtml(activity.name)}</b>${member.role !== 'member' ? ` <span class="text-xs text-ink-500">${escapeHtml(member.role)}</span>` : ''}`, att.total ? `attended ${att.attended} of ${att.total}` : 'no sessions yet'); }).join('')}
    ${wins.length ? `${h('Achievements')}${wins.map((w) => row(escapeHtml(w.title), `<span class="text-xs text-ink-500">${escapeHtml(w.date)}</span>`)).join('')}` : ''}`);
}

async function competencies(student) {
  if (!featureEnabled('competency_ratings')) return note('CBC competency tracking is not included in your school\'s package.');
  if (!canReadCollection('competencyRatings')) return note('Your role does not have access to this information.');
  const d = await loadCompetency(); const term = d.currentTerm ?? d.terms[0];
  const prog = CL.progressBySubject({ learner: student, subjects: d.subjects.filter((x) => (x.classIds ?? []).includes(student.classId)), outcomes: d.outcomes, ratings: d.ratings, termId: term?.id });
  if (!prog.length) return note('No learning outcomes have been set up for this learner\'s class yet.');
  return card(`${h(`Competencies${term ? `, ${term.name}` : ''}`)}${prog.map((p) => row(`<b>${escapeHtml(p.subject.name)}</b><br/><span class="text-xs text-ink-500">${CL.DEFAULT_RATING_SCALE.slice().sort((a, b) => b.value - a.value).map((l) => `${CL.shortLabel(l.key)} ${p.counts[l.key] ?? 0}`).join(' · ')}</span>`, `reached ${p.reached} of ${p.total}${p.rated < p.total ? `<br/><span class="text-xs text-ink-500">${p.total - p.rated} not yet rated</span>` : ''}`)).join('')}
    <p class="mt-2"><a class="btn btn-secondary btn-sm" href="#/academics">Open Competencies</a></p>`);
}

// Health is the most sensitive tab: administrators and the school nurse only, and looking at it is logged.
const shown = new Set();
function health(student) {
  const blocked = gate('health', 'healthProfiles'); if (blocked) return blocked;
  if (!shown.has(student.id)) { logAccess(student.id); shown.add(student.id); } // once per visit to the profile, not on every redraw
  const p = getProfile(student.id); const severe = (p?.allergies ?? []).filter(isSevere); const gaps = profileGaps(p);
  return card(`${h('Health summary (confidential)')}
    ${severe.length ? `<p class="text-sm" style="color:var(--bad);font-weight:600;">⚠ Severe allergy: ${severe.map((a) => escapeHtml(a.substance)).join(', ')}</p>` : ''}
    ${row('Allergies', !p || p.allergyStatus === 'unknown' ? 'not recorded' : p.allergyStatus === 'none' ? 'none known' : p.allergies.map((a) => `${escapeHtml(a.substance)} (${escapeHtml(SEVERITY.find(([k]) => k === a.severity)?.[1] ?? '')})`).join(', '))}
    ${row('Conditions', (p?.conditions ?? []).length ? p.conditions.map(escapeHtml).join(', ') : 'none recorded')}${row('Emergency contact', p?.emergencyPhone ? `${escapeHtml(p.emergencyName)} · ${escapeHtml(p.emergencyPhone)}` : 'not recorded')}
    ${row('Standing medication', `${medsOf(student.id).filter((m) => m.status !== 'stopped').length}`)}${row('Sick-bay visits', `${visitsOf(student.id).length}`)}${row('Overdue immunisations', `${overdueImmunisations(immunisationsOf(student.id)).length}`)}
    ${gaps.length ? `<p class="text-xs text-ink-500">To complete: ${gaps.map(escapeHtml).join(' · ')}</p>` : ''}
    <p class="mt-2"><a class="btn btn-secondary btn-sm" href="#/health">Open the health module</a></p>`);
}

// Returns the tab's HTML, or null for a tab handled elsewhere.
export async function profileTabHtml(tab, student) {
  switch (tab) {
    case 'Academics': return academics(student);
    case 'Attendance': return attendance(student);
    case 'Finance': return finance(student);
    case 'Discipline': return discipline(student);
    case 'Transport': return transport(student);
    case 'Activities': return activities(student);
    case 'Competencies': return competencies(student);
    case 'Health': return health(student);
    default: return null;
  }
}
