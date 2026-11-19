// Boarding (demo mode): hostels, rooms, bed allocation, exeats and roll call.
import { LocalStorageRepository } from '../storage/Repository.js';
import { studentRepo } from './studentService.js';
import { teacherRepo } from './peopleService.js';
import { currentAccount } from './authService.js';
import { getCurrentRole } from './accessService.js';
import * as L from './hostelLogic.js';

export const hostelRepo = new LocalStorageRepository('hostels', 'hostel');
export const roomRepo = new LocalStorageRepository('hostelRooms', 'room');
export const allocationRepo = new LocalStorageRepository('hostelAllocations', 'bed allocation');
export const exeatRepo = new LocalStorageRepository('hostelExeats', 'exeat');
export const rollRepo = new LocalStorageRepository('hostelRollCalls', 'roll call');
const today = () => new Date().toISOString().slice(0, 10);

export function saveHostel(input, id) {
  const clean = { name: String(input.name ?? '').trim(), gender: input.gender, wardenId: input.wardenId || '', status: input.status ?? 'active' };
  const errors = L.validateHostel(clean);
  if (clean.name && hostelRepo.getAll().some((h) => h.id !== id && h.status !== 'archived' && h.name.toLowerCase() === clean.name.toLowerCase())) errors.push('There is already a hostel with this name.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, hostel: id ? hostelRepo.update(id, clean, 'updated hostel') : hostelRepo.create(clean, 'created hostel') };
}
export function archiveHostel(id) {
  if (boardersIn(id).length) return { ok: false, errors: ['Move or check out every boarder before archiving this hostel.'] };
  return { ok: true, hostel: hostelRepo.update(id, { status: 'archived' }, 'archived hostel') };
}
export const reopenHostel = (id) => hostelRepo.update(id, { status: 'active' }, 'reopened hostel');

export const roomsOf = (hostelId) => roomRepo.getAll().filter((r) => r.hostelId === hostelId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
export function saveRoom(hostelId, input, id) {
  const clean = { hostelId, name: String(input.name ?? '').trim(), capacity: Number(input.capacity) };
  const errors = L.validateRoom(clean);
  if (clean.name && roomsOf(hostelId).some((r) => r.id !== id && r.name.toLowerCase() === clean.name.toLowerCase())) errors.push('This hostel already has a room with that name.');
  if (id && clean.capacity < L.bedsTaken(allocationRepo.getAll(), id)) errors.push('Beds cannot be fewer than the learners already in the room.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, room: id ? roomRepo.update(id, clean, 'updated room') : roomRepo.create(clean, 'added room') };
}
export function removeRoom(id) {
  if (allocationRepo.getAll().some((allocation) => allocation.roomId === id)) return { ok: false, errors: ['This room has current or historical bed allocations; keep it so those records remain intact.'] };
  roomRepo.remove(id, 'removed room'); return { ok: true };
}
export const roomHasAllocationHistory = (id) => allocationRepo.getAll().some((allocation) => allocation.roomId === id);

const liveAllocs = () => allocationRepo.getAll().filter((a) => a.status !== 'left');
export const boardersIn = (hostelId) => { const rooms = new Set(roomsOf(hostelId).map((r) => r.id)); return liveAllocs().filter((a) => rooms.has(a.roomId)).map((a) => ({ ...a, student: studentRepo.getById(a.studentId) })).filter((a) => a.student); };
export const allocationOf = (studentId) => liveAllocs().find((a) => a.studentId === studentId);
export function allocate(roomId, studentId, bed = '') {
  const room = roomRepo.getById(roomId); const check = L.allocateCheck({ room, hostel: hostelRepo.getById(room?.hostelId), student: studentRepo.getById(studentId), allocations: allocationRepo.getAll(), rooms: roomRepo.getAll(), hostels: hostelRepo.getAll() });
  if (!check.ok) return check;
  const prior = allocationRepo.getAll().find((a) => a.studentId === studentId && a.status === 'left' && a.roomId === roomId);
  const rec = { roomId, studentId, bed: String(bed).trim(), status: 'active', checkedInDate: today(), leftDate: '' };
  return { ok: true, allocation: prior ? allocationRepo.update(prior.id, rec, 'checked in') : allocationRepo.create(rec, 'checked in') };
}
export function checkOut(studentId) {
  if (exeatRepo.getAll().some((x) => x.studentId === studentId && x.status === 'out')) return { ok: false, reason: 'This learner is currently out on an exeat. Mark them returned first.' };
  const a = allocationOf(studentId); if (!a) return { ok: false, reason: 'Not currently boarding.' };
  exeatRepo.getAll().filter((x) => x.studentId === studentId && ['requested', 'approved'].includes(x.status)).forEach((x) => exeatRepo.update(x.id, { status: 'cancelled', decisionNote: 'Learner left boarding' }, 'cancelled exeat'));
  return { ok: true, allocation: allocationRepo.update(a.id, { status: 'left', leftDate: today() }, 'checked out of hostel') };
}
export function move(studentId, toRoomId) {
  const a = allocationOf(studentId); if (!a) return { ok: false, reason: 'Not currently boarding.' };
  const room = roomRepo.getById(toRoomId); if (!room) return { ok: false, reason: 'Choose a room.' };
  if (room.id === a.roomId) return { ok: false, reason: 'Already in that room.' };
  const hostel = hostelRepo.getById(room.hostelId); const student = studentRepo.getById(studentId);
  const others = allocationRepo.getAll().filter((x) => x.id !== a.id);
  const check = L.allocateCheck({ room, hostel, student, allocations: others, rooms: roomRepo.getAll(), hostels: hostelRepo.getAll() });
  return check.ok ? { ok: true, allocation: allocationRepo.update(a.id, { roomId: toRoomId, bed: '' }, 'moved room') } : check;
}

// ---- exeats ----
// Only an administrator, or the warden of the learner's own hostel (a teacher whose email matches the signed-in account), may decide.
export function canDecide(studentId) {
  const role = getCurrentRole(); if (!role || role === 'school_admin') return true;
  const a = allocationOf(studentId); const hostel = hostelRepo.getById(roomRepo.getById(a?.roomId)?.hostelId); const me = currentAccount();
  const warden = teacherRepo.getById(hostel?.wardenId);
  return Boolean(warden && me && warden.email && warden.email.toLowerCase() === String(me.email).toLowerCase());
}
export function requestExeat(input) {
  const clean = { studentId: input.studentId, type: input.type, fromDate: input.fromDate, returnDate: input.returnDate, reason: input.reason, guardianContact: input.guardianContact };
  const errors = L.validateExeat(clean, { allocated: Boolean(allocationOf(clean.studentId)), existing: exeatRepo.getAll() });
  if (errors.length) return { ok: false, errors };
  return { ok: true, exeat: exeatRepo.create({ ...clean, reason: clean.reason.trim(), guardianContact: clean.guardianContact.trim(), status: 'requested', requestedBy: currentAccount()?.name ?? 'Administrator', requestedDate: today() }, 'requested exeat') };
}
export function actOnExeat(id, action, note = '') {
  const x = exeatRepo.getById(id); if (!x) return { ok: false, reason: 'Exeat not found.' };
  const r = L.exeatAction(x, action, { note, canApprove: canDecide(x.studentId) }); if (!r.ok) return r;
  const by = currentAccount()?.name ?? 'Administrator';
  return { ok: true, exeat: exeatRepo.update(id, { ...r.patch, ...(['approve', 'reject'].includes(action) ? { decidedBy: by } : {}) }, `exeat: ${L.EXEAT_ACTIONS[action].label.toLowerCase()}`) };
}
export const exeatsSorted = () => exeatRepo.getAll().sort((a, b) => b.fromDate.localeCompare(a.fromDate));
export const overdueExeats = () => exeatRepo.getAll().filter((x) => L.isOverdue(x));

// ---- roll call ----
export function recordRoll(hostelId, { date, session, presentIds }) {
  const errors = []; const boarders = boardersIn(hostelId); const ids = boarders.map((b) => b.studentId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) errors.push('Choose the date.'); else if (date > today()) errors.push('Roll call cannot be recorded for a future date.');
  if (!['morning', 'evening'].includes(session)) errors.push('Choose morning or evening.');
  if (presentIds.some((id) => !ids.includes(id))) errors.push('Only boarders in this hostel can be marked present.');
  if (errors.length) return { ok: false, errors };
  const result = L.rollCall({ boarders: boarders.map((b) => b.student), presentIds, exeats: exeatRepo.getAll() });
  const rec = { hostelId, date, session, presentIds, missingIds: result.missing.map((s) => s.id), onExeatIds: result.onExeat.map((s) => s.id), takenBy: currentAccount()?.name ?? 'Administrator' };
  const prior = rollRepo.getAll().find((r) => r.hostelId === hostelId && r.date === date && r.session === session);
  return { ok: true, result, roll: prior ? rollRepo.update(prior.id, rec, 'updated roll call') : rollRepo.create(rec, 'recorded roll call') };
}
export const rollFor = (hostelId, date, session) => rollRepo.getAll().find((r) => r.hostelId === hostelId && r.date === date && r.session === session);
export function occupancy() {
  const hostels = hostelRepo.getAll().filter((h) => h.status !== 'archived'); const all = liveAllocs();
  return hostels.map((h) => { const rooms = roomsOf(h.id); const ids = new Set(rooms.map((r) => r.id)); const beds = rooms.reduce((t, r) => t + Number(r.capacity), 0); const taken = all.filter((a) => ids.has(a.roomId)).length; return { hostelId: h.id, name: h.name, beds, taken, free: beds - taken }; });
}
