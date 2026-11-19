import { studentRepo, fullName } from './studentService.js';
import { parentRepo, teacherRepo, parentFullName, teacherFullName } from './peopleService.js';

export function globalSearch(query) {
  const q = query.toLowerCase();
  const results = [];

  studentRepo
    .find((s) => fullName(s).toLowerCase().includes(q) || s.admissionNumber.toLowerCase().includes(q))
    .forEach((s) => results.push({ id: s.id, label: `${fullName(s)} · ${s.admissionNumber}`, kind: 'Student', path: `#/students/${s.id}` }));

  parentRepo
    .find((p) => parentFullName(p).toLowerCase().includes(q))
    .forEach((p) => results.push({ id: p.id, label: parentFullName(p), kind: 'Parent', path: '#/students' }));

  teacherRepo
    .find((t) => teacherFullName(t).toLowerCase().includes(q))
    .forEach((t) => results.push({ id: t.id, label: teacherFullName(t), kind: 'Teacher', path: '#/staff' }));

  return results;
}
