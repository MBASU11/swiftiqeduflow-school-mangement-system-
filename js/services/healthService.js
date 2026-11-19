// School health (demo mode). Confidential: only administrators and the school nurse can reach these collections, and opening a
// learner's record is logged. Nothing here appears in the parent or learner portal, on reports, or on the principal's dashboard.
import { LocalStorageRepository } from '../storage/Repository.js';
import { studentRepo } from './studentService.js';
import { currentAccount } from './authService.js';
import * as L from './healthLogic.js';

export const profileRepo = new LocalStorageRepository('healthProfiles', 'health profile');
export const visitRepo = new LocalStorageRepository('healthVisits', 'sick-bay visit');
export const medRepo = new LocalStorageRepository('healthMedications', 'medication');
export const doseRepo = new LocalStorageRepository('healthDoses', 'dose');
export const immRepo = new LocalStorageRepository('healthImmunisations', 'immunisation');
export const accessRepo = new LocalStorageRepository('healthAccessLog', 'record access');
const today = () => new Date().toISOString().slice(0, 10);
const me = () => currentAccount()?.name ?? 'Administrator';

export const getProfile = (studentId) => profileRepo.getAll().find((p) => p.studentId === studentId) ?? null;
export function saveProfile(studentId, input) {
  const clean = { studentId, allergyStatus: input.allergyStatus, allergies: input.allergyStatus === 'listed' ? (input.allergies ?? []).map((a) => ({ substance: String(a.substance ?? '').trim(), severity: a.severity, reaction: String(a.reaction ?? '').trim() })) : [],
    conditions: (input.conditions ?? []).map((c) => String(c).trim()).filter(Boolean), bloodGroup: input.bloodGroup ?? '', emergencyName: String(input.emergencyName ?? '').trim(), emergencyPhone: String(input.emergencyPhone ?? '').trim(),
    doctor: String(input.doctor ?? '').trim(), consentFirstAid: Boolean(input.consentFirstAid), consentDate: input.consentFirstAid ? (input.consentDate || today()) : '', notes: String(input.notes ?? '').trim() };
  const errors = L.validateProfile(clean); if (errors.length) return { ok: false, errors };
  const prior = getProfile(studentId);
  return { ok: true, profile: prior ? profileRepo.update(prior.id, clean, 'updated health profile') : profileRepo.create(clean, 'created health profile') };
}
// Every opening of a learner's record is written down (who and when), because these records are sensitive.
export function logAccess(studentId) { accessRepo.create({ studentId, by: me(), at: new Date().toISOString() }, 'opened health record'); }
export const recentAccess = (studentId, n = 5) => accessRepo.getAll().filter((a) => a.studentId === studentId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, n);

export function addVisit(studentId, input) {
  const v = { studentId, date: input.date, time: input.time ?? '', complaint: String(input.complaint ?? '').trim(), temperature: input.temperature ?? '', pulse: input.pulse ?? '', observations: String(input.observations ?? '').trim(), action: String(input.action ?? '').trim(),
    medication: String(input.medication ?? '').trim(), dose: String(input.dose ?? '').trim(), outcome: input.outcome, parentNotified: Boolean(input.parentNotified), followUpDate: input.followUpDate ?? '' };
  const errors = L.validateVisit(v); if (errors.length) return { ok: false, errors };
  const profile = getProfile(studentId); const warnings = L.allergyWarnings(v.medication, profile);
  if (v.medication && !profile?.consentFirstAid && !input.overrideConsent) return { ok: false, errors: ['No parent consent for medication is recorded for this learner. Get the parent’s permission and update the profile, or confirm that a parent has agreed by phone.'], needsConsentOverride: true };
  if (warnings.length && !input.confirmAllergy) return { ok: false, errors: warnings.map((w) => `⚠ ${w} Do not give it unless a doctor has said it is safe.`), needsAllergyConfirm: true };
  return { ok: true, visit: visitRepo.create({ ...v, recordedBy: me() }, 'recorded sick-bay visit'), warnings };
}
export const visitsOf = (studentId) => visitRepo.getAll().filter((v) => v.studentId === studentId).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
export const recentVisits = (days = 7) => { const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10); return visitRepo.getAll().filter((v) => v.status !== 'entered-in-error' && v.date >= from).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)); };
function voidHealthEntry(repository, id, reason, message) {
  const cleanReason = String(reason ?? '').trim();
  if (!cleanReason) return { ok: false, reason: 'Provide a reason for this correction.' };
  const record = repository.getById(id);
  if (!record) return { ok: false, reason: 'This health record no longer exists.' };
  if (record.status === 'entered-in-error') return { ok: false, reason: 'This record has already been corrected.' };
  return { ok: true, record: repository.update(id, {
    status: 'entered-in-error',
    correctionReason: cleanReason,
    correctedAt: new Date().toISOString(),
    correctedBy: me(),
  }, message) };
}
export const voidVisit = (id, reason) => voidHealthEntry(visitRepo, id, reason, 'corrected sick-bay visit');

export function addMedication(studentId, input) {
  const m = { studentId, name: String(input.name ?? '').trim(), dose: String(input.dose ?? '').trim(), times: (input.times ?? []).map((t) => t.trim()).filter(Boolean), startDate: input.startDate, endDate: input.endDate ?? '', instructions: String(input.instructions ?? '').trim(), authorisedBy: String(input.authorisedBy ?? '').trim(), status: 'active' };
  const errors = L.validateMedication(m); if (errors.length) return { ok: false, errors };
  const warnings = L.allergyWarnings(m.name, getProfile(studentId));
  if (warnings.length && !input.confirmAllergy) return { ok: false, errors: warnings.map((w) => `⚠ ${w} Check with the parent or doctor.`), needsAllergyConfirm: true };
  return { ok: true, medication: medRepo.create(m, 'added standing medication') };
}
export const stopMedication = (id) => medRepo.update(id, { status: 'stopped', endDate: today() }, 'stopped medication');
export const medsOf = (studentId) => medRepo.getAll().filter((m) => m.studentId === studentId);
export function recordDose(medicationId, time, given, note = '') {
  const med = medRepo.getById(medicationId); if (!med || med.status === 'stopped') return { ok: false, reason: 'This medication is no longer active.' };
  if (!given && !String(note).trim()) return { ok: false, reason: 'Say why the dose was missed.' };
  if (doseRepo.getAll().some((d) => d.medicationId === medicationId && d.date === today() && d.time === time)) return { ok: false, reason: 'This dose is already recorded.' };
  return { ok: true, dose: doseRepo.create({ medicationId, studentId: med.studentId, date: today(), time, given, note: String(note).trim(), by: me(), at: new Date().toISOString() }, given ? 'gave dose' : 'recorded missed dose') };
}
export function dosesToday() {
  const now = new Date(); const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return L.dosesDue(medRepo.getAll(), doseRepo.getAll(), today(), hhmm);
}

export function addImmunisation(studentId, input) {
  const i = { studentId, vaccine: String(input.vaccine ?? '').trim(), dateGiven: input.dateGiven, doseNumber: input.doseNumber ?? '', nextDue: input.nextDue ?? '', notes: String(input.notes ?? '').trim() };
  const errors = L.validateImmunisation(i); if (errors.length) return { ok: false, errors };
  return { ok: true, immunisation: immRepo.create({ ...i, doseNumber: i.doseNumber === '' ? '' : Number(i.doseNumber) }, 'recorded immunisation') };
}
export const immunisationsOf = (studentId) => immRepo.getAll().filter((i) => i.studentId === studentId).sort((a, b) => b.dateGiven.localeCompare(a.dateGiven));
export const voidImmunisation = (id, reason) => voidHealthEntry(immRepo, id, reason, 'corrected immunisation record');

// What the nurse should look at today.
export function overview() {
  const students = studentRepo.getAll().filter((s) => (s.status ?? 'active') === 'active'); const ids = new Set(students.map((s) => s.id)); const profiles = profileRepo.getAll().filter((p) => ids.has(p.studentId));
  const doses = dosesToday();
  return {
    severe: profiles.filter((p) => (p.allergies ?? []).some(L.isSevere)).map((p) => ({ studentId: p.studentId, allergies: p.allergies.filter(L.isSevere) })),
    gaps: students.filter((s) => L.profileGaps(profiles.find((p) => p.studentId === s.id)).length).length, learners: students.length,
    frequent: L.frequentAttenders(visitRepo.getAll().filter((visit) => visit.status !== 'entered-in-error')).filter((f) => ids.has(f.studentId)),
    overdueDoses: doses.filter((d) => d.status === 'overdue'), dueDoses: doses.filter((d) => d.status === 'due'),
    overdueVaccines: students.filter((s) => L.overdueImmunisations(immunisationsOf(s.id).filter((entry) => entry.status !== 'entered-in-error')).length).length,
  };
}
