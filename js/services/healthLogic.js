// School health: profiles (allergies, conditions, consent), sick-bay visits, standing medication and immunisation.
// Pure functions (no storage, no DOM). healthService.js applies them to the school's data. These records are confidential.
export const SEVERITY = [['mild', 'Mild'], ['moderate', 'Moderate'], ['severe', 'Severe'], ['life_threatening', 'Life-threatening (anaphylaxis)']];
export const OUTCOMES = [['returned', 'Returned to class'], ['rested', 'Rested in sick bay'], ['sent_home', 'Sent home'], ['referred', 'Referred to hospital / clinic'], ['other', 'Other']];
export const VACCINES = ['BCG', 'Polio (OPV/IPV)', 'Pentavalent (DPT-HepB-Hib)', 'Pneumococcal (PCV)', 'Rotavirus', 'Measles-Rubella', 'Yellow fever', 'Typhoid', 'HPV', 'Tetanus-diphtheria', 'COVID-19', 'Other'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/; const DAY = /^\d{4}-\d{2}-\d{2}$/; const PHONE = /^\+?[\d\s-]{9,16}$/;
const today = () => new Date().toISOString().slice(0, 10);
export const isSevere = (a) => a.severity === 'severe' || a.severity === 'life_threatening';

// allergyStatus makes "nothing recorded" different from "checked, none": 'unknown' | 'none' | 'listed'.
export function validateProfile(p) {
  const e = [];
  if (!['unknown', 'none', 'listed'].includes(p.allergyStatus)) e.push('Say whether the learner has allergies.');
  if (p.allergyStatus === 'listed' && !(p.allergies ?? []).length) e.push('List at least one allergy, or choose "No known allergies".');
  for (const a of p.allergies ?? []) {
    if (!String(a.substance ?? '').trim()) e.push('Every allergy needs a name (for example "peanuts").');
    if (!SEVERITY.some(([k]) => k === a.severity)) e.push(`Choose how severe the ${a.substance || 'allergy'} reaction is.`);
  }
  if (p.emergencyPhone && !PHONE.test(String(p.emergencyPhone).trim())) e.push('The emergency phone number does not look right.');
  if (p.emergencyPhone && !String(p.emergencyName ?? '').trim()) e.push('Give the name of the emergency contact.');
  return e;
}
// What is still missing from a learner's record: shown as a to-do, never as an error.
export function profileGaps(p) {
  const g = [];
  if (!p || p.allergyStatus === 'unknown') g.push('Allergies not recorded');
  if (!p?.emergencyPhone) g.push('No emergency contact');
  if (!p?.consentFirstAid) g.push('No parent consent for first aid and basic medication');
  return g;
}

export function validateVisit(v, now = today()) {
  const e = [];
  if (!String(v.complaint ?? '').trim()) e.push('Say what the learner came in with.');
  if (!OUTCOMES.some(([k]) => k === v.outcome)) e.push('Choose what happened next.');
  if (!DAY.test(v.date ?? '')) e.push('Choose the date.'); else if (v.date > now) e.push('A visit cannot be recorded for a future date.');
  if (v.time && !TIME.test(v.time)) e.push('Use a time like 10:30.');
  if (v.temperature !== '' && v.temperature != null && !(Number(v.temperature) >= 30 && Number(v.temperature) <= 45)) e.push('Temperature should be between 30 and 45 °C.');
  if (v.pulse !== '' && v.pulse != null && !(Number(v.pulse) >= 30 && Number(v.pulse) <= 220)) e.push('Pulse should be between 30 and 220 beats a minute.');
  if (['sent_home', 'referred'].includes(v.outcome) && !v.parentNotified) e.push('A learner sent home or referred needs their parent or guardian told first. Tick that it was done.');
  if (v.medication && !String(v.dose ?? '').trim()) e.push('Record the dose given.');
  return e;
}

// Medicines that belong to a family people are allergic to. A penicillin allergy also rules out amoxicillin, and so on.
const RELATED = {
  penicillin: ['amoxicillin', 'amoxil', 'ampicillin', 'augmentin', 'co-amoxiclav', 'coamoxiclav', 'flucloxacillin', 'cloxacillin', 'benzylpenicillin', 'phenoxymethylpenicillin', 'piperacillin'],
  sulfa: ['septrin', 'co-trimoxazole', 'cotrimoxazole', 'bactrim', 'sulfamethoxazole', 'sulphamethoxazole', 'sulfadoxine', 'sulphadoxine', 'fansidar', 'sulfadiazine'],
  sulphonamide: ['septrin', 'co-trimoxazole', 'cotrimoxazole', 'bactrim', 'sulfamethoxazole', 'sulphamethoxazole', 'sulfadoxine', 'sulphadoxine', 'fansidar'],
};
const singular = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
// Does this medicine (or anything the learner is being given) match a recorded allergy? Loose matching on purpose: better a false alarm.
export function allergyWarnings(name, profile) {
  const n = String(name ?? '').trim().toLowerCase(); if (n.length < 3) return [];
  const out = [];
  for (const a of profile?.allergies ?? []) {
    const raw = String(a.substance ?? '').trim().toLowerCase(); const sub = singular(raw); if (sub.length < 3) continue;
    const sev = a.severity === 'life_threatening' ? 'life-threatening' : a.severity;
    if (n.includes(sub) || sub.includes(n)) out.push(`${a.substance} is a recorded ${sev} allergy for this learner.`);
    else { const fam = Object.keys(RELATED).find((k) => sub.includes(k) || k.includes(sub)); if (fam && RELATED[fam].some((m) => n.includes(m))) out.push(`${name} is related to ${a.substance}, a recorded ${sev} allergy for this learner.`); }
  }
  return out;
}

export function validateMedication(m) {
  const e = [];
  if (!String(m.name ?? '').trim()) e.push('Give the medicine a name.');
  if (!String(m.dose ?? '').trim()) e.push('Give the dose.');
  if (!(m.times ?? []).length || (m.times ?? []).some((t) => !TIME.test(t))) e.push('Give at least one time of day, like 13:00.');
  if (!DAY.test(m.startDate ?? '')) e.push('Choose the start date.');
  if (m.endDate && (!DAY.test(m.endDate) || m.endDate < m.startDate)) e.push('The end date cannot be before the start date.');
  if (!String(m.authorisedBy ?? '').trim()) e.push('Say who authorised it (the parent, or the doctor who prescribed it). Medicine is never given without that.');
  return e;
}
// Today's doses for the standing medication: given, missed, due now, overdue (more than 30 minutes late), or upcoming.
export function dosesDue(meds, doses, date, hhmm) {
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); const now = mins(hhmm); const out = [];
  for (const m of meds.filter((x) => x.status !== 'stopped' && x.startDate <= date && (!x.endDate || x.endDate >= date))) {
    for (const t of m.times) {
      const d = doses.find((x) => x.medicationId === m.id && x.date === date && x.time === t);
      out.push({ medication: m, time: t, record: d ?? null, status: d ? (d.given ? 'given' : 'missed') : mins(t) + 30 < now ? 'overdue' : mins(t) <= now ? 'due' : 'upcoming' });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export function validateImmunisation(i, now = today()) {
  const e = [];
  if (!String(i.vaccine ?? '').trim()) e.push('Choose the vaccine.');
  if (!DAY.test(i.dateGiven ?? '')) e.push('Choose the date given.'); else if (i.dateGiven > now) e.push('The date given cannot be in the future.');
  if (i.doseNumber !== '' && i.doseNumber != null && !(Number.isInteger(Number(i.doseNumber)) && Number(i.doseNumber) >= 1)) e.push('The dose number must be a whole number from 1.');
  if (i.nextDue && (!DAY.test(i.nextDue) || i.nextDue <= i.dateGiven)) e.push('The next due date must be after the date given.');
  return e;
}
// A vaccine is overdue when its next dose date has passed and no later dose of it has been recorded.
export const overdueImmunisations = (records, now = today()) => records.filter((r) => r.nextDue && r.nextDue < now && !records.some((o) => o.id !== r.id && o.vaccine === r.vaccine && o.dateGiven > r.dateGiven));

// Learners who keep coming back: worth a conversation with the parent.
export function frequentAttenders(visits, { days = 30, min = 3, now = today() } = {}) {
  const from = new Date(new Date(now).getTime() - days * 864e5).toISOString().slice(0, 10); const n = {};
  visits.filter((v) => v.date >= from && v.date <= now).forEach((v) => { n[v.studentId] = (n[v.studentId] ?? 0) + 1; });
  return Object.entries(n).filter(([, c]) => c >= min).map(([studentId, count]) => ({ studentId, count })).sort((a, b) => b.count - a.count);
}
