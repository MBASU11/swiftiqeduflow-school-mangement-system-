// Clubs, sports and societies: the rules, as pure functions (no storage, no DOM). activitiesService.js applies them to the school's data.
export const CATEGORIES = [['club', 'Club'], ['sport', 'Sport'], ['society', 'Society'], ['arts', 'Music & drama'], ['service', 'Service & community']];
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const LEVELS = [['school', 'School'], ['zone', 'Zone / sub-county'], ['county', 'County'], ['regional', 'Regional'], ['national', 'National'], ['international', 'International']];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateActivity(a) {
  const e = [];
  if (!String(a.name ?? '').trim()) e.push('Give the activity a name.'); else if (String(a.name).trim().length > 60) e.push('Keep the name under 60 characters.');
  if (!CATEGORIES.some(([k]) => k === a.category)) e.push('Choose a category.');
  if (a.capacity !== '' && a.capacity != null && (!Number.isInteger(Number(a.capacity)) || Number(a.capacity) < 1)) e.push('Capacity must be a whole number of at least 1, or left empty for no limit.');
  if (a.meetingDay && !DAYS.includes(a.meetingDay)) e.push('Choose a meeting day from Monday to Saturday.');
  for (const k of ['startTime', 'endTime']) if (a[k] && !TIME.test(a[k])) e.push('Use times like 16:00.');
  if (a.startTime && a.endTime && TIME.test(a.startTime) && TIME.test(a.endTime) && a.endTime <= a.startTime) e.push('The end time must be after the start time.');
  return e;
}

const overlaps = (x, y) => Boolean(x.meetingDay) && x.meetingDay === y.meetingDay && x.startTime && x.endTime && y.startTime && y.endTime && x.startTime < y.endTime && y.startTime < x.endTime;
const activeMembers = (members, activityId) => members.filter((m) => m.activityId === activityId && m.status !== 'left');

// May this learner join? Refusals are firm; warnings (a timetable clash) are shown but allowed.
export function joinCheck({ activity, student, members, activities }) {
  if (!activity || activity.status === 'archived') return { ok: false, reason: 'This activity is no longer running.', warnings: [] };
  if (!student || (student.status ?? 'active') !== 'active') return { ok: false, reason: 'Only current learners can join.', warnings: [] };
  if (activeMembers(members, activity.id).some((m) => m.studentId === student.id)) return { ok: false, reason: 'Already a member.', warnings: [] };
  if (activity.capacity && activeMembers(members, activity.id).length >= Number(activity.capacity)) return { ok: false, reason: `Full: all ${activity.capacity} places are taken.`, warnings: [] };
  const mine = members.filter((m) => m.studentId === student.id && m.status !== 'left').map((m) => activities.find((a) => a.id === m.activityId)).filter((a) => a && a.id !== activity.id && a.status !== 'archived');
  return { ok: true, reason: '', warnings: mine.filter((a) => overlaps(a, activity)).map((a) => `Clashes with ${a.name} (${a.meetingDay} ${a.startTime}–${a.endTime}).`) };
}

// A learner's attendance counts only sessions held on or after the day they joined, and before they left.
export function attendanceFor(sessions, member) {
  const held = sessions.filter((s) => s.date >= (member.joinedDate ?? '') && (!member.leftDate || s.date <= member.leftDate));
  const attended = held.filter((s) => (s.presentIds ?? []).includes(member.studentId)).length;
  return { attended, total: held.length, pct: held.length ? Math.round((attended / held.length) * 100) : null };
}

export function validateSession({ date, presentIds = [], memberIds = [] }, today = new Date().toISOString().slice(0, 10)) {
  const e = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) e.push('Choose the session date.'); else if (date > today) e.push('A session cannot be recorded for a future date.');
  if (presentIds.some((id) => !memberIds.includes(id))) e.push('Only members can be marked present.');
  return e;
}

// How many current learners take part in at least one activity, and who takes part in none.
export function participation(students, members, activities) {
  const running = new Set(activities.filter((a) => a.status !== 'archived').map((a) => a.id));
  const inAny = new Set(members.filter((m) => m.status !== 'left' && running.has(m.activityId)).map((m) => m.studentId));
  const active = students.filter((s) => (s.status ?? 'active') === 'active');
  const taking = active.filter((s) => inAny.has(s.id));
  return { total: active.length, taking: taking.length, pct: active.length ? Math.round((taking.length / active.length) * 100) : null, none: active.filter((s) => !inAny.has(s.id)) };
}
