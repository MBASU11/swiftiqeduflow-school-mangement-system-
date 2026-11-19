// The principal's view, as pure functions (no storage, no DOM): what needs the principal's attention, and how the school is doing.
// principalService.js gathers the facts from the school's data; this file only decides what they mean.
export const LOW_ATTENDANCE = 85; // % below which a class is flagged

export const collectionRate = (billed, paid) => (billed > 0 ? Math.round((Math.min(paid, billed) / billed) * 100) : null);

// Classes whose average attendance is below the line, lowest first. Classes with no records are never flagged.
export const lowAttendanceClasses = (rows, line = LOW_ATTENDANCE) => rows.filter((r) => r.averagePercentage !== null && r.averagePercentage < line).sort((a, b) => a.averagePercentage - b.averagePercentage);

// One row per class for the newest examination: where its report is in the approval workflow.
export function reportBoard(classes, runs, examinationId) {
  return classes.map((c) => ({ classId: c.id, className: c.name, status: runs.find((r) => r.examinationId === examinationId && r.classId === c.id)?.status ?? 'draft' }));
}

// facts: { inModeration, approved, enquiries, toAdmit, lowAttendance[], arrearsCount, arrearsTotal, lowStock, currency, reportsOpen }
// Returns [{ level: 'act' | 'watch', text, path }], most urgent first. "act" = waiting on the principal.
export function attentionItems(f) {
  const out = []; const plural = (n, w, p = `${w}s`) => `${n} ${n === 1 ? w : p}`;
  if (f.inModeration) out.push({ level: 'act', text: `${plural(f.inModeration, 'class report')} waiting for your approval`, path: '#/exams' });
  if (f.approved) out.push({ level: 'act', text: `${plural(f.approved, 'approved report')} not yet published to parents`, path: '#/exams' });
  if (f.enquiries) out.push({ level: 'act', text: `${plural(f.enquiries, 'admission application')} waiting for a decision`, path: '#/admissions' });
  if (f.toAdmit) out.push({ level: 'watch', text: `${plural(f.toAdmit, 'approved applicant')} not yet admitted into a class`, path: '#/admissions' });
  (f.lowAttendance ?? []).slice(0, 3).forEach((r) => out.push({ level: 'watch', text: `${r.className} attendance is ${r.averagePercentage}% over the last 30 days`, path: '#/attendance' }));
  if (f.arrearsCount) out.push({ level: 'watch', text: `${plural(f.arrearsCount, 'learner')} ${f.arrearsCount === 1 ? 'has' : 'have'} unpaid fees, ${f.currency} ${Math.round(f.arrearsTotal).toLocaleString()} in total`, path: '#/finance' });
  if (f.lowStock) out.push({ level: 'watch', text: `${plural(f.lowStock, 'inventory item')} running low`, path: '#/inventory' });
  return out;
}
