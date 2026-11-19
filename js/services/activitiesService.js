// Clubs, sports and societies (demo mode): activities, who is in them, session attendance and achievements.
import { LocalStorageRepository } from '../storage/Repository.js';
import { studentRepo } from './studentService.js';
import * as L from './activitiesLogic.js';

export const activityRepo = new LocalStorageRepository('activities', 'activity');
export const memberRepo = new LocalStorageRepository('activityMembers', 'activity member');
export const sessionRepo = new LocalStorageRepository('activitySessions', 'activity session');
export const achievementRepo = new LocalStorageRepository('activityAchievements', 'achievement');
const today = () => new Date().toISOString().slice(0, 10);

export function saveActivity(input, id) {
  const clean = { name: String(input.name ?? '').trim(), category: input.category, coordinatorId: input.coordinatorId || '', capacity: input.capacity === '' || input.capacity == null ? '' : Number(input.capacity),
    meetingDay: input.meetingDay || '', startTime: input.startTime || '', endTime: input.endTime || '', venue: String(input.venue ?? '').trim(), status: input.status ?? 'active' };
  const errors = L.validateActivity(clean);
  if (activityRepo.getAll().some((a) => a.id !== id && a.status !== 'archived' && a.name.toLowerCase() === clean.name.toLowerCase() && clean.name)) errors.push('There is already a running activity with this name.');
  if (id && clean.capacity) { const n = membersOf(id).length; if (n > clean.capacity) errors.push(`${n} learners are already in it; capacity cannot be below that.`); }
  if (errors.length) return { ok: false, errors };
  return { ok: true, activity: id ? activityRepo.update(id, clean, 'updated activity') : activityRepo.create(clean, 'created activity') };
}
export const archiveActivity = (id) => activityRepo.update(id, { status: 'archived' }, 'archived activity');
export const reopenActivity = (id) => activityRepo.update(id, { status: 'active' }, 'reopened activity');

export const membersOf = (activityId) => memberRepo.getAll().filter((m) => m.activityId === activityId && m.status !== 'left');
export function joinActivity(activityId, studentId, role = 'member') {
  const check = L.joinCheck({ activity: activityRepo.getById(activityId), student: studentRepo.getById(studentId), members: memberRepo.getAll(), activities: activityRepo.getAll() });
  if (!check.ok) return check;
  const prior = memberRepo.getAll().find((m) => m.activityId === activityId && m.studentId === studentId); // a learner who left and returns reuses the record
  const rec = { activityId, studentId, role, status: 'active', joinedDate: today(), leftDate: '' };
  return { ...check, member: prior ? memberRepo.update(prior.id, rec, 'rejoined activity') : memberRepo.create(rec, 'joined activity') };
}
export const setRole = (memberId, role) => memberRepo.update(memberId, { role }, 'changed activity role');
export const leaveActivity = (memberId) => memberRepo.update(memberId, { status: 'left', leftDate: today() }, 'left activity');

// One session per activity per date; recording it again replaces the earlier attendance.
export function recordSession(activityId, { date, presentIds, note = '' }) {
  const memberIds = membersOf(activityId).map((m) => m.studentId);
  const errors = L.validateSession({ date, presentIds, memberIds });
  if (errors.length) return { ok: false, errors };
  const prior = sessionRepo.getAll().find((s) => s.activityId === activityId && s.date === date);
  const rec = { activityId, date, presentIds, note: String(note).trim() };
  return { ok: true, session: prior ? sessionRepo.update(prior.id, rec, 'updated session') : sessionRepo.create(rec, 'recorded session') };
}
export const sessionsOf = (activityId) => sessionRepo.getAll().filter((s) => s.activityId === activityId).sort((a, b) => b.date.localeCompare(a.date));
export const removeSession = (id) => sessionRepo.remove(id, 'removed activity session');

export function addAchievement(activityId, { title, date, level, studentId = '', description = '' }) {
  const errors = [];
  if (!String(title ?? '').trim()) errors.push('Describe the achievement.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) errors.push('Choose the date.');
  if (!L.LEVELS.some(([k]) => k === level)) errors.push('Choose the level.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, achievement: achievementRepo.create({ activityId, title: title.trim(), date, level, studentId, description: String(description).trim() }, 'recorded achievement') };
}
export const achievementsOf = (activityId) => achievementRepo.getAll().filter((a) => a.activityId === activityId).sort((a, b) => b.date.localeCompare(a.date));
export const removeAchievement = (id) => achievementRepo.remove(id, 'removed achievement');

export const activitiesOfStudent = (studentId) => memberRepo.getAll().filter((m) => m.studentId === studentId && m.status !== 'left').map((m) => ({ member: m, activity: activityRepo.getById(m.activityId) })).filter((x) => x.activity && x.activity.status !== 'archived');
export const participationNow = () => L.participation(studentRepo.getAll(), memberRepo.getAll(), activityRepo.getAll());
export const memberAttendance = (member) => L.attendanceFor(sessionsOf(member.activityId), member);
