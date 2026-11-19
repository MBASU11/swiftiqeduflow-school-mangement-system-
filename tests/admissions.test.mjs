import assert from 'node:assert/strict';
import {
  ADMISSION_STATUS_LABELS,
  ADMISSIONS_VIEWS,
  admissionChecklist,
  admissionsAnalytics,
  buildAdmissionTransition,
  classCapacitySummary,
  findPotentialDuplicate,
  getAdmissionStatus,
  legacyStageForStatus,
  validateAdmissionTransition,
} from '../js/services/admissionsService.js';

const localStore = new Map();
globalThis.window = {
  crypto: globalThis.crypto,
  localStorage: {
    getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
    setItem: (key, value) => localStore.set(key, String(value)),
    removeItem: (key) => localStore.delete(key),
    get length() { return localStore.size; },
    key: (index) => [...localStore.keys()][index],
  },
};

const noRequiredDocuments = { admissions: { requiredDocuments: [] } };
const completeApplication = {
  id: 'application-1',
  status: 'draft',
  childName: 'Mila Wanjiku',
  guardians: [{ fullName: 'Parent Wanjiku', phone: '0700000000', primary: true }],
  classInterested: 'class-1',
  academicYearId: 'year-1',
  termId: 'term-1',
};

assert.deepEqual(ADMISSIONS_VIEWS.map(([key]) => key), ['overview', 'enquiries', 'applications', 'review', 'offers', 'admitted', 'archive']);
assert.equal(getAdmissionStatus({ stage: 'application' }), 'draft');
assert.equal(getAdmissionStatus({ stage: 'approved' }), 'approved');
assert.equal(getAdmissionStatus({ status: 'offer_accepted', stage: 'approved' }), 'offer_accepted');
assert.equal(legacyStageForStatus('offer_accepted'), 'approved');
assert.deepEqual(validateAdmissionTransition({ ...completeApplication, childName: '' }, 'submitted'), ['Complete required application information: Student name.']);
assert.deepEqual(validateAdmissionTransition({ stage: 'enquiry' }, 'contacted'), ['Record a brief note about the contact.']);
assert.deepEqual(validateAdmissionTransition({ stage: 'enquiry' }, 'follow_up_due', { followUp: { date: '2026-02-31', description: 'Call back' } }), ['Enter a valid follow-up date and action.']);

const submitted = buildAdmissionTransition(completeApplication, 'submitted', { settings: noRequiredDocuments, actor: 'Registrar' });
assert.equal(submitted.status, 'submitted');
assert.equal(submitted.stage, 'application');
assert.equal(submitted.activity.at(-1).actor, 'Registrar');
assert.deepEqual(validateAdmissionTransition({ ...completeApplication, status: 'review_complete' }, 'rejected'), ['A reason is required when rejecting an application.']);

const reviewReady = { ...completeApplication, status: 'review_complete', documents: [{ name: 'Birth certificate', status: 'verified' }] };
const documentSettings = { admissions: { requiredDocuments: ['Birth certificate'] } };
assert.equal(admissionChecklist(reviewReady, documentSettings).every((item) => item.complete), true);
assert.equal(validateAdmissionTransition(reviewReady, 'approved', { capacity: { available: 0 }, settings: { admissions: { requiredDocuments: ['Birth certificate'] } } }).length, 1);
assert.equal(validateAdmissionTransition(reviewReady, 'approved', {
  capacity: { available: 0 }, capacityOverride: true, overrideReason: 'Principal approved extra place',
  settings: { admissions: { requiredDocuments: ['Birth certificate'] } },
}).length, 0);
assert.equal(validateAdmissionTransition(reviewReady, 'approved', { settings: documentSettings }).length, 0);
assert.match(validateAdmissionTransition({ ...reviewReady, status: 'enrollment_pending' }, 'admitted')[0], /enrollment action/);
assert.equal(validateAdmissionTransition({ ...reviewReady, status: 'approved' }, 'offer_sent', { offer: { acceptanceDeadline: '2027-01-30' } }).length, 0);

const capacity = classCapacitySummary({ id: 'class-1', capacity: 5 }, [
  { id: 'student-1', classId: 'class-1', status: 'active' },
  { id: 'student-2', classId: 'class-1', status: 'active' },
], [
  { id: 'offer-1', status: 'offer_sent', classInterested: 'class-1' },
  { id: 'enrolled-1', status: 'admitted', classInterested: 'class-1', admittedStudentId: 'student-1' },
  { id: 'wait-1', status: 'waitlisted', classInterested: 'class-1' },
]);
assert.deepEqual(
  { students: capacity.students, reserved: capacity.reserved, waitlisted: capacity.waitlisted, available: capacity.available },
  { students: 2, reserved: 1, waitlisted: 1, available: 2 }
);
assert.equal(findPotentialDuplicate({ childName: 'Mila Wanjiku', dateOfBirth: '2016-01-01' }, [
  { id: 'student-1', firstName: 'Mila', lastName: 'Wanjiku', dateOfBirth: '2016-01-01' },
]).length, 1);

const metrics = admissionsAnalytics([
  { id: 'enquiry-1', stage: 'enquiry', createdAt: '2026-01-01', followUps: [], activity: [] },
  { id: 'enquiry-2', status: 'offer_accepted', childName: 'Mila', followUps: [], activity: [] },
  { id: 'enquiry-3', status: 'admitted', childName: 'Tala', followUps: [], activity: [] },
], [{ id: 'student-1', status: 'active' }]);
assert.equal(metrics.totalEnquiries, 1);
assert.equal(metrics.confirmedAdmissions, 2);
assert.equal(metrics.enrolled, 1);
assert.equal(metrics.activeStudents, 1);

const { StorageManager } = await import('../js/storage/StorageManager.js');
const { setCurrentRole } = await import('../js/services/accessService.js');
const { classRepo } = await import('../js/services/academicService.js');
const { parentRepo } = await import('../js/services/peopleService.js');
const { studentRepo } = await import('../js/services/studentService.js');
const { convertToStudent, admissionRepo } = await import('../js/services/admissionsService.js');
StorageManager.setTenant('admissions-workflow-tests');
setCurrentRole(null);

const enrollmentClass = classRepo.create({ name: 'Reception', capacity: 2, order: 1 });
const acceptedAdmission = admissionRepo.create({
  status: 'offer_accepted',
  stage: 'approved',
  childName: 'Kato Njoroge',
  dateOfBirth: '2018-03-04',
  classInterested: enrollmentClass.id,
  guardians: [{ fullName: 'Miriam Njoroge', email: 'miriam@example.test', phone: '0700000000', primary: true }],
});
const enrolledStudent = convertToStudent(acceptedAdmission.id, {
  admissionNumber: 'ADM-001',
  classId: enrollmentClass.id,
  admissionDate: '2026-01-10',
});
assert.equal(admissionRepo.getById(acceptedAdmission.id).admittedStudentId, enrolledStudent.id);
assert.deepEqual(enrolledStudent.parentIds, [parentRepo.getAll()[0].id]);
assert.deepEqual(parentRepo.getById(enrolledStudent.parentIds[0]).studentIds, [enrolledStudent.id]);
const duplicateAdmission = admissionRepo.create({
  status: 'offer_accepted',
  stage: 'approved',
  childName: 'Kato Njoroge',
  dateOfBirth: '2018-03-04',
  classInterested: enrollmentClass.id,
});
assert.throws(() => convertToStudent(duplicateAdmission.id, {
  admissionNumber: 'ADM-001',
  classId: enrollmentClass.id,
  admissionDate: '2026-01-10',
}), /already exists/);

const fullClass = classRepo.create({ name: 'Year 1', capacity: 1, order: 2 });
studentRepo.create({ admissionNumber: 'ADM-002', firstName: 'Asha', lastName: 'Muli', classId: fullClass.id, status: 'active' });
const fullClassAdmission = admissionRepo.create({
  status: 'enrollment_pending',
  stage: 'approved',
  childName: 'Lulu Muli',
  classInterested: fullClass.id,
});
assert.throws(() => convertToStudent(fullClassAdmission.id, {
  admissionNumber: 'ADM-003',
  classId: fullClass.id,
  admissionDate: '2026-01-10',
}), /no available places/);
const overriddenStudent = convertToStudent(fullClassAdmission.id, {
  admissionNumber: 'ADM-003',
  classId: fullClass.id,
  admissionDate: '2026-01-10',
  capacityOverride: true,
  overrideReason: 'Principal approved additional placement',
});
assert.equal(overriddenStudent.classId, fullClass.id);

const { admissions: admissionsDataset } = await import('../js/services/datasets/lists.js');
const importContext = { admissions: [], classes: [] };
const acceptedImport = admissionsDataset.prepare([
  { rowNumber: 2, values: { childName: 'Nia Kamau', status: 'Offer accepted' } },
], importContext, { defaultStage: 'enquiry', duplicates: 'skip' });
assert.equal(acceptedImport.items[0].plan.fields.status, 'offer_accepted');
assert.equal(acceptedImport.items[0].plan.fields.stage, 'approved');
const legacyImport = admissionsDataset.prepare([
  { rowNumber: 2, values: { childName: 'Ari Wekesa', stage: 'Application' } },
], importContext, { defaultStage: 'enquiry', duplicates: 'skip' });
assert.equal(legacyImport.items[0].plan.fields.status, 'draft');
const exported = admissionsDataset.export({
  classes: [],
  admissions: [{ childName: 'Nia Kamau', status: 'offer_accepted', stage: 'approved' }],
});
assert.equal(exported.sheets[0].rows[0][8], 'Workflow Status');
assert.equal(exported.sheets[0].rows[1][8], ADMISSION_STATUS_LABELS.offer_accepted);

console.log('All passed');
