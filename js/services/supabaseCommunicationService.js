import { SupabaseRepository } from '../storage/SupabaseRepository.js';

export async function loadCommunicationWorkspace() {
  const collections = ['announcements', 'messages', 'classes', 'streams', 'students', 'teachers', 'parents'];
  const values = await Promise.all(collections.map((collection) => new SupabaseRepository(collection).getAll()));
  const data = Object.fromEntries(collections.map((collection, index) => [collection, values[index]]));
  data.announcements.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  data.messages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  data.classes.sort((a, b) => a.order - b.order);
  return data;
}

export async function createRemoteAnnouncement(announcement) {
  return new SupabaseRepository('announcements').create(announcement, 'created announcement');
}

export async function removeRemoteAnnouncement(id) {
  return new SupabaseRepository('announcements').remove(id, 'removed announcement');
}

export async function createRemoteMessage(message) {
  return new SupabaseRepository('messages').create(message, 'created message');
}

export function remoteRecipients(data, type) {
  if (type === 'parent') return data.parents.map((parent) => ({ id: parent.id, name: `${parent.firstName} ${parent.lastName}`.trim() }));
  if (type === 'teacher') return data.teachers.filter((teacher) => teacher.isActive).map((teacher) => ({ id: teacher.id, name: `${teacher.firstName} ${teacher.lastName}`.trim() }));
  return data.students.filter((student) => student.status === 'active').map((student) => ({
    id: student.id,
    name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' '),
  }));
}