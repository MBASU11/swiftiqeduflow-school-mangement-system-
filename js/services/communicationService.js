import { LocalStorageRepository } from '../storage/Repository.js';

export const announcementRepo = new LocalStorageRepository('announcements', 'announcement');
export const messageRepo = new LocalStorageRepository('messages', 'message');

export const AUDIENCES = [
  ['school', 'Whole school'],
  ['class', 'A class'],
  ['stream', 'A stream'],
  ['teachers', 'Teachers'],
  ['parents', 'Parents'],
  ['students', 'Students'],
];

export function getAnnouncements() {
  return announcementRepo.getAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getMessages() {
  return messageRepo.getAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const RECIPIENT_TYPES = [
  ['parent', 'Parent'],
  ['teacher', 'Teacher / Staff'],
  ['student', 'Student'],
];
