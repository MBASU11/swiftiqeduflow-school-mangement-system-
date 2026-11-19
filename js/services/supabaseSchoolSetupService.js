import { uuid } from '../lib/uuid.js';
import { defaultModuleToggles } from './settingsService.js';
import { getSupabaseClient } from './supabaseClient.js';

function makeRecord(collection, data, id = uuid()) {
  const now = new Date().toISOString();
  const payload = { ...data, id, createdAt: now, updatedAt: now };
  return { collection, record_id: id, payload };
}

export function buildSchoolSetupRecords(state, prefill = {}) {
  state.setupRecordIds ??= { curriculum: uuid(), year: uuid(), terms: [], streams: {} };
  const ids = state.setupRecordIds;
  const curriculum = makeRecord('curricula', {
    name: state.curriculumName.trim() || 'Default curriculum',
    type: state.curriculumType,
    appliesTo: [],
  }, ids.curriculum);
  const school = makeRecord('school', {
    name: state.name.trim(),
    type: state.schoolType,
    curricula: [curriculum.record_id],
    phone: state.phone.trim() || undefined,
    email: state.email.trim() || undefined,
    address: state.address.trim() || undefined,
    logoUrl: state.logoUrl || undefined,
    letterheadUrl: state.letterheadUrl || undefined,
    countyCode: state.countyCode || undefined,
    currency: 'KES',
    timezone: 'Africa/Nairobi',
    country: 'Kenya',
    plan: prefill.plan,
    setupComplete: true,
  }, 'the-school');
  const year = makeRecord('academicYears', {
    label: state.yearLabel.trim() || String(new Date().getFullYear()),
    startDate: state.yearStart,
    endDate: state.yearEnd,
    isCurrent: true,
  }, ids.year);
  const records = [curriculum, school, year];
  state.termNames.filter((name) => name.trim()).forEach((name, index) => {
    ids.terms[index] ??= uuid();
    records.push(makeRecord('terms', {
      academicYearId: year.record_id,
      name: name.trim(),
      startDate: '',
      endDate: '',
      isCurrent: index === 0,
    }, ids.terms[index]));
  });

  const createdClasses = [];
  state.classes.filter((item) => item.name.trim()).forEach((item, index) => {
    const createdClass = makeRecord('classes', {
      name: item.name.trim(),
      order: index + 1,
      curriculumId: curriculum.record_id,
    }, item.tempId);
    createdClasses.push(createdClass);
    records.push(createdClass);
    ids.streams[item.tempId] ??= [];
    item.streams.forEach((name, streamIndex) => {
      if (!name.trim()) return;
      ids.streams[item.tempId][streamIndex] ??= uuid();
      records.push(makeRecord('streams', { classId: createdClass.record_id, name: name.trim() }, ids.streams[item.tempId][streamIndex]));
    });
  });

  state.subjects.filter((item) => item.name.trim()).forEach((item) => {
    records.push(makeRecord('subjects', {
      name: item.name.trim(),
      code: item.code.trim() || item.name.trim().slice(0, 3).toUpperCase(),
      curriculumId: curriculum.record_id,
      classIds: createdClasses.map((record) => record.record_id),
      teacherIds: [],
    }, item.tempId));
  });
  records.push(makeRecord('settings', { moduleToggles: { ...defaultModuleToggles } }, 'the-settings'));
  return records;
}

export async function completeSchoolSetup(state, prefill = {}) {
  const records = buildSchoolSetupRecords(state, prefill);
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('complete_school_setup', { records });
  if (error) throw error;
  return { savedRecords: data };
}