// Boarding: dormitories, beds, exeats (leave-outs) and roll call, as pure functions (no storage, no DOM).
// hostelService.js applies them to the school's data.
export const GENDERS = [['boys', 'Boys'], ['girls', 'Girls'], ['mixed', 'Mixed']];
export const EXEAT_TYPES = [['exeat', 'Exeat (short leave)'], ['weekend', 'Weekend at home'], ['medical', 'Medical leave'], ['compassionate', 'Compassionate leave'], ['other', 'Other']];
export const EXEAT_STATUS = { requested: 'Requested', approved: 'Approved', rejected: 'Rejected', out: 'Out of school', returned: 'Returned', cancelled: 'Cancelled' };
const LIVE = ['requested', 'approved', 'out'];
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

export function validateHostel(h) {
  const e = [];
  if (!String(h.name ?? '').trim()) e.push('Give the hostel a name.');
  if (!GENDERS.some(([k]) => k === h.gender)) e.push('Choose who the hostel is for.');
  return e;
}
export function validateRoom(r) {
  const e = [];
  if (!String(r.name ?? '').trim()) e.push('Give the room a name or number.');
  if (!Number.isInteger(Number(r.capacity)) || Number(r.capacity) < 1) e.push('Beds must be a whole number of at least 1.');
  return e;
}
const live = (allocations) => allocations.filter((a) => a.status !== 'left');
export const bedsTaken = (allocations, roomId) => live(allocations).filter((a) => a.roomId === roomId).length;

// May this learner be given a bed in this room? Refusals are firm: one bed per learner, never over capacity, never the wrong hostel.
export function allocateCheck({ room, hostel, student, allocations, rooms, hostels }) {
  if (!room || !hostel || hostel.status === 'archived') return { ok: false, reason: 'This hostel is not in use.' };
  if (!student || (student.status ?? 'active') !== 'active') return { ok: false, reason: 'Only current learners can board.' };
  const current = live(allocations).find((a) => a.studentId === student.id);
  if (current) { const r = rooms.find((x) => x.id === current.roomId); const h = hostels.find((x) => x.id === r?.hostelId); return { ok: false, reason: `Already has a bed in ${h?.name ?? 'a hostel'}, ${r?.name ?? ''}. Move them instead.` }; }
  if (hostel.gender === 'boys' && student.gender === 'female') return { ok: false, reason: `${hostel.name} is a boys' hostel.` };
  if (hostel.gender === 'girls' && student.gender === 'male') return { ok: false, reason: `${hostel.name} is a girls' hostel.` };
  if (bedsTaken(allocations, room.id) >= Number(room.capacity)) return { ok: false, reason: `${room.name} is full (${room.capacity} beds).` };
  return { ok: true, reason: '' };
}

export function validateExeat(x, { allocated, existing = [] }) {
  const e = [];
  if (!allocated) e.push('Only boarders can be given an exeat.');
  if (!EXEAT_TYPES.some(([k]) => k === x.type)) e.push('Choose the type of leave.');
  if (!isoDay.test(x.fromDate ?? '') || !isoDay.test(x.returnDate ?? '')) e.push('Choose the leaving and return dates.');
  else if (x.returnDate < x.fromDate) e.push('The return date cannot be before the leaving date.');
  if (!String(x.reason ?? '').trim()) e.push('Give a reason.');
  if (!String(x.guardianContact ?? '').trim()) e.push('Give the parent or guardian the learner is going with, and a phone number.');
  if (existing.some((o) => o.studentId === x.studentId && LIVE.includes(o.status) && o.id !== x.id && isoDay.test(x.fromDate ?? '') && o.fromDate <= x.returnDate && x.fromDate <= o.returnDate)) e.push('This learner already has an exeat that overlaps these dates.');
  return e;
}

// The legal moves of an exeat. A rejection needs a reason; leaving and returning are recorded as they happen.
export const EXEAT_ACTIONS = {
  approve: { from: ['requested'], to: 'approved', label: 'Approve' },
  reject: { from: ['requested'], to: 'rejected', label: 'Reject', needsNote: true },
  checkout: { from: ['approved'], to: 'out', label: 'Release (leaves school)' },
  return: { from: ['out'], to: 'returned', label: 'Mark returned' },
  cancel: { from: ['requested', 'approved'], to: 'cancelled', label: 'Cancel' },
};
export function exeatAction(x, action, { note = '', canApprove = true, today = new Date().toISOString().slice(0, 10) } = {}) {
  const a = EXEAT_ACTIONS[action];
  if (!a || !a.from.includes(x.status)) return { ok: false, reason: `This exeat is ${EXEAT_STATUS[x.status].toLowerCase()}, so it cannot be ${a ? a.label.toLowerCase() : 'changed'}.` };
  if (['approve', 'reject', 'checkout'].includes(action) && !canApprove) return { ok: false, reason: "Only an administrator or this learner's hostel warden can do that." };
  if (a.needsNote && !String(note).trim()) return { ok: false, reason: 'Give a reason.' };
  if (action === 'checkout' && today < x.fromDate) return { ok: false, reason: `Leave starts on ${x.fromDate}; the learner cannot be released earlier.` };
  return { ok: true, patch: { status: a.to, ...(action === 'checkout' ? { outDate: today } : {}), ...(action === 'return' ? { returnedDate: today } : {}), ...(a.needsNote ? { decisionNote: String(note).trim() } : {}) } };
}
export const isOverdue = (x, today = new Date().toISOString().slice(0, 10)) => x.status === 'out' && x.returnDate < today;

// Roll call for one hostel: who is in, who is legitimately out on an exeat, and who is unaccounted for.
export function rollCall({ boarders, presentIds, exeats }) {
  const out = new Set(exeats.filter((x) => x.status === 'out').map((x) => x.studentId));
  const here = new Set(presentIds);
  return { present: boarders.filter((b) => here.has(b.id)), onExeat: boarders.filter((b) => !here.has(b.id) && out.has(b.id)), missing: boarders.filter((b) => !here.has(b.id) && !out.has(b.id)) };
}
