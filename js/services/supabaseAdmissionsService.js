import { uuid } from '../lib/uuid.js';
import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { buildAdmissionTransition, buildEnrollmentPayload, normalizeAdmission } from './admissionsService.js';
import { getSupabaseClient } from './supabaseClient.js';

const admissionsRepo = new SupabaseRepository('admissions');
const classesRepo = new SupabaseRepository('classes');
const studentsRepo = new SupabaseRepository('students');
const parentsRepo = new SupabaseRepository('parents');
const settingsRepo = new SupabaseRepository('settings');
const academicYearsRepo = new SupabaseRepository('academicYears');
const termsRepo = new SupabaseRepository('terms');

export async function loadAdmissionsWorkspace() {
  const [admissions, classes, students, parents, settings, academicYears, terms] = await Promise.all([
    admissionsRepo.getAll(),
    classesRepo.getAll(),
    studentsRepo.getAll(),
    parentsRepo.getAll(),
    settingsRepo.getById('the-settings'),
    academicYearsRepo.getAll(),
    termsRepo.getAll(),
  ]);
  admissions.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  classes.sort((a, b) => a.order - b.order);
  return { admissions, classes, students, parents, settings: settings ?? {}, academicYears, terms };
}

export async function createRemoteAdmission(details) {
  const now = new Date().toISOString();
  return admissionsRepo.create({
    ...details,
    status: 'enquiry',
    stage: 'enquiry',
    followUps: [],
    communications: [],
    activity: [{ id: uuid(), action: 'Enquiry created', actor: 'School team', at: now }],
  });
}

export async function updateRemoteAdmission(id, patch) {
  const saved = await admissionsRepo.update(id, patch);
  if (!saved) throw new Error('This admission record no longer exists.');
  return saved;
}

export async function moveRemoteAdmission(id, status, options = {}) {
  const admission = await admissionsRepo.getById(id);
  if (!admission) throw new Error('This admission record no longer exists.');
  return updateRemoteAdmission(id, buildAdmissionTransition(admission, status, options));
}

export async function convertRemoteAdmission(application, options) {
  if (!application) throw new Error('This application no longer exists.');
  const { student, guardians } = buildEnrollmentPayload(application, options);
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('convert_admission_to_student_v2', {
    target_admission_id: application.id,
    student_payload: { ...student, id: uuid() },
    guardians_payload: guardians,
    capacity_override_reason: options.capacityOverride ? options.overrideReason.trim() : null,
  });
  if (error) throw error;
  return data;
}

export function normalizedRemoteAdmission(admission) {
  return normalizeAdmission(admission);
}
