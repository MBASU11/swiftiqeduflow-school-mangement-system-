import { LocalStorageRepository } from '../storage/Repository.js';
import { studentRepo } from './studentService.js';
import { parentRepo } from './peopleService.js';
import { classRepo } from './academicService.js';
import { uuid } from '../lib/uuid.js';

export const admissionRepo = new LocalStorageRepository('admissions', 'admission');

export const STAGES = [
  ['enquiry', 'Enquiry'],
  ['application', 'Application'],
  ['approved', 'Approved'],
  ['admitted', 'Admitted'],
  ['rejected', 'Rejected'],
];

export const ADMISSIONS_VIEWS = [
  ['overview', 'Overview'],
  ['enquiries', 'Enquiries'],
  ['applications', 'Applications'],
  ['review', 'Review & verification'],
  ['offers', 'Offers'],
  ['admitted', 'Admitted students'],
  ['archive', 'Archive'],
];

export const ADMISSION_STATUSES = [
  'enquiry',
  'contacted',
  'follow_up_due',
  'application_started',
  'draft',
  'submitted',
  'incomplete',
  'information_requested',
  'resubmitted',
  'under_review',
  'review_complete',
  'approved',
  'waitlisted',
  'rejected',
  'offer_sent',
  'offer_accepted',
  'offer_declined',
  'offer_expired',
  'enrollment_pending',
  'admitted',
  'withdrawn',
  'archived',
  'lost',
  'closed',
];

export const ADMISSION_STATUS_LABELS = {
  enquiry: 'New enquiry',
  contacted: 'Contacted',
  follow_up_due: 'Follow-up due',
  application_started: 'Application started',
  draft: 'Draft application',
  submitted: 'Submitted',
  incomplete: 'Incomplete',
  information_requested: 'Information requested',
  resubmitted: 'Resubmitted',
  under_review: 'Under review',
  review_complete: 'Review complete',
  approved: 'Approved',
  waitlisted: 'Waitlisted',
  rejected: 'Rejected',
  offer_sent: 'Offer sent',
  offer_accepted: 'Offer accepted',
  offer_declined: 'Offer declined',
  offer_expired: 'Offer expired',
  enrollment_pending: 'Enrollment pending',
  admitted: 'Admitted',
  withdrawn: 'Withdrawn',
  archived: 'Archived',
  lost: 'Lost',
  closed: 'Closed',
};

export const ENQUIRY_SOURCES = [
  ['walk_in', 'Walk-in'],
  ['phone', 'Phone call'],
  ['website', 'Website'],
  ['whatsapp', 'WhatsApp'],
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['referral', 'Referral'],
  ['school_event', 'School event'],
  ['other', 'Other'],
];

export const DEFAULT_ADMISSION_DOCUMENTS = [
  'Birth certificate',
  'Passport photo',
  'Previous school report',
  'Transfer certificate',
];

const TRANSITIONS = {
  enquiry: ['contacted', 'follow_up_due', 'application_started', 'lost', 'closed'],
  contacted: ['follow_up_due', 'application_started', 'lost', 'closed'],
  follow_up_due: ['contacted', 'application_started', 'lost', 'closed'],
  application_started: ['draft', 'submitted', 'incomplete', 'withdrawn'],
  draft: ['submitted', 'incomplete', 'withdrawn'],
  submitted: ['under_review', 'information_requested', 'incomplete', 'withdrawn'],
  incomplete: ['resubmitted', 'information_requested', 'withdrawn'],
  information_requested: ['resubmitted', 'withdrawn'],
  resubmitted: ['under_review', 'information_requested', 'withdrawn'],
  under_review: ['review_complete', 'information_requested', 'incomplete', 'withdrawn'],
  review_complete: ['approved', 'waitlisted', 'rejected', 'under_review', 'withdrawn'],
  approved: ['offer_sent', 'enrollment_pending', 'withdrawn'],
  waitlisted: ['under_review', 'review_complete', 'approved', 'rejected', 'withdrawn'],
  offer_sent: ['offer_accepted', 'offer_declined', 'offer_expired', 'withdrawn'],
  offer_accepted: ['enrollment_pending', 'withdrawn'],
  offer_declined: ['archived', 'under_review'],
  offer_expired: ['archived', 'under_review'],
  enrollment_pending: ['admitted', 'withdrawn'],
  rejected: ['archived', 'under_review'],
  lost: ['archived', 'enquiry'],
  closed: ['archived', 'enquiry'],
  withdrawn: ['archived', 'under_review'],
  admitted: ['archived'],
  archived: ['enquiry', 'under_review'],
};

const LEGACY_STATUS = {
  enquiry: 'enquiry',
  application: 'draft',
  approved: 'approved',
  admitted: 'admitted',
  rejected: 'rejected',
};

const LEGACY_STAGE = {
  enquiry: 'enquiry',
  contacted: 'enquiry',
  follow_up_due: 'enquiry',
  lost: 'rejected',
  closed: 'rejected',
  draft: 'application',
  application_started: 'application',
  submitted: 'application',
  incomplete: 'application',
  information_requested: 'application',
  resubmitted: 'application',
  under_review: 'application',
  review_complete: 'application',
  approved: 'approved',
  waitlisted: 'approved',
  offer_sent: 'approved',
  offer_accepted: 'approved',
  offer_declined: 'rejected',
  offer_expired: 'rejected',
  enrollment_pending: 'approved',
  admitted: 'admitted',
  rejected: 'rejected',
  withdrawn: 'rejected',
  archived: 'rejected',
};

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function getAdmissionStatus(admission) {
  if (ADMISSION_STATUS_LABELS[admission?.status]) return admission.status;
  return LEGACY_STATUS[admission?.stage] ?? 'enquiry';
}

export function legacyStageForStatus(status) {
  return LEGACY_STAGE[status] ?? 'application';
}

export function getAdmissionView(status) {
  if (['enquiry', 'contacted', 'follow_up_due', 'application_started', 'lost', 'closed'].includes(status)) return 'enquiries';
  if (['draft', 'submitted', 'incomplete', 'information_requested', 'resubmitted'].includes(status)) return 'applications';
  if (['under_review', 'review_complete', 'waitlisted', 'rejected'].includes(status)) return 'review';
  if (['approved', 'offer_sent', 'offer_accepted', 'offer_declined', 'offer_expired', 'enrollment_pending'].includes(status)) return 'offers';
  if (status === 'admitted') return 'admitted';
  return 'archive';
}

export function getByStage(stage) {
  return admissionRepo.find((admission) => admission.stage === stage).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getRequiredDocuments(settings = {}) {
  const configured = settings.admissions?.requiredDocuments;
  return Array.isArray(configured) ? configured.map((item) => String(item).trim()).filter(Boolean) : DEFAULT_ADMISSION_DOCUMENTS;
}

export function normalizeAdmission(admission) {
  const status = getAdmissionStatus(admission);
  const guardians = Array.isArray(admission.guardians)
    ? admission.guardians
    : admission.parentName || admission.phone || admission.email
      ? [{ fullName: admission.parentName ?? '', relationship: '', phone: admission.phone ?? '', email: admission.email ?? '', primary: true }]
      : [];
  const documents = (admission.documents ?? []).map((document, index) => typeof document === 'string'
    ? { id: `legacy-${index}`, name: document, status: 'uploaded', legacy: true }
    : document);
  return {
    ...admission,
    status,
    stage: admission.stage ?? legacyStageForStatus(status),
    guardians,
    documents,
    followUps: Array.isArray(admission.followUps) ? admission.followUps : [],
    communications: Array.isArray(admission.communications) ? admission.communications : [],
    activity: Array.isArray(admission.activity) ? admission.activity : [],
  };
}

export function admissionChecklist(admission, settings = {}) {
  const app = normalizeAdmission(admission);
  const checks = [
    { key: 'student', label: 'Student name', complete: Boolean(app.childName?.trim() || (app.firstName?.trim() && app.lastName?.trim())) },
    { key: 'guardian', label: 'Guardian contact', complete: app.guardians.some((guardian) => guardian.fullName?.trim() && (guardian.phone?.trim() || guardian.email?.trim())) },
    { key: 'class', label: 'Class applied for', complete: Boolean(app.classInterested || app.classId) },
    { key: 'year', label: 'Academic year', complete: Boolean(app.academicYearId) },
    { key: 'term', label: 'Term', complete: Boolean(app.termId) },
  ];
  const verifiedDocuments = new Set(app.documents.filter((document) => document.status === 'verified').map((document) => document.name));
  getRequiredDocuments(settings).forEach((name) => {
    checks.push({ key: `document:${name}`, label: name, complete: verifiedDocuments.has(name) });
  });
  return checks;
}

export function applicationMissingFields(admission) {
  const app = normalizeAdmission(admission);
  const missing = [];
  if (!(app.childName?.trim() || (app.firstName?.trim() && app.lastName?.trim()))) missing.push('Student name');
  if (!app.guardians.some((guardian) => guardian.fullName?.trim() && (guardian.phone?.trim() || guardian.email?.trim()))) missing.push('Guardian name and phone or email');
  if (!(app.classInterested || app.classId)) missing.push('Class applied for');
  if (!app.academicYearId) missing.push('Academic year');
  if (!app.termId) missing.push('Term');
  return missing;
}

export function validateAdmissionTransition(admission, targetStatus, options = {}) {
  const app = normalizeAdmission(admission);
  const errors = [];
  if (!ADMISSION_STATUS_LABELS[targetStatus]) return ['Select a valid admission status.'];
  if (!(TRANSITIONS[app.status] ?? []).includes(targetStatus)) {
    return [`Cannot move an application from ${ADMISSION_STATUS_LABELS[app.status]} to ${ADMISSION_STATUS_LABELS[targetStatus]}.`];
  }
  if (['submitted', 'resubmitted'].includes(targetStatus)) {
    const missing = applicationMissingFields(app);
    if (missing.length) errors.push(`Complete required application information: ${missing.join(', ')}.`);
  }
  if (['review_complete', 'approved'].includes(targetStatus)) {
    const missing = admissionChecklist(app, options.settings).filter((item) => !item.complete).map((item) => item.label);
    if (missing.length) errors.push(`Complete or verify these requirements first: ${missing.join(', ')}.`);
  }
  if (['approved', 'offer_sent'].includes(targetStatus) && Number.isFinite(options.capacity?.available) && options.capacity.available <= 0) {
    if (!(options.capacityOverride && options.overrideReason?.trim())) errors.push('The selected class has no available places. Waitlist the applicant or record an authorized capacity override with a reason.');
  }
  if (targetStatus === 'follow_up_due' && (!validDate(options.followUp?.date) || !options.followUp?.description?.trim())) errors.push('Enter a valid follow-up date and action.');
  if (targetStatus === 'contacted' && !options.communication?.message?.trim()) errors.push('Record a brief note about the contact.');
  if (targetStatus === 'rejected' && !options.reason?.trim()) errors.push('A reason is required when rejecting an application.');
  if (targetStatus === 'offer_sent' && !validDate(options.offer?.acceptanceDeadline)) errors.push('Set a valid offer acceptance deadline before issuing the offer.');
  if (targetStatus === 'offer_accepted' && !options.acceptanceMethod?.trim()) errors.push('Record how the offer was accepted.');
  if (targetStatus === 'admitted') errors.push('Use the enrollment action to create and link the official student record.');
  if (options.capacityOverride && !options.overrideReason?.trim()) errors.push('A reason is required for a capacity override.');
  return errors;
}

export function admissionActivity(admission, action, details = {}, actor = 'School team') {
  const app = normalizeAdmission(admission);
  return [...app.activity, {
    id: uuid(),
    action,
    details,
    actor,
    at: new Date().toISOString(),
  }];
}

export function buildAdmissionTransition(admission, targetStatus, options = {}) {
  const app = normalizeAdmission(admission);
  const errors = validateAdmissionTransition(app, targetStatus, options);
  if (errors.length) throw new Error(errors.join(' '));
  const now = new Date().toISOString();
  const patch = {
    status: targetStatus,
    stage: legacyStageForStatus(targetStatus),
    activity: admissionActivity(app, `Status changed to ${ADMISSION_STATUS_LABELS[targetStatus]}`, {
      from: app.status,
      to: targetStatus,
      reason: options.reason?.trim() || undefined,
      capacityOverrideReason: options.capacityOverride ? options.overrideReason.trim() : undefined,
    }, options.actor),
    updatedAt: now,
  };
  if (['approved', 'waitlisted', 'rejected'].includes(targetStatus)) {
    patch.decision = {
      outcome: targetStatus,
      decidedAt: now,
      decidedBy: options.actor ?? 'School team',
      notes: options.reason?.trim() || '',
      waitlistPosition: targetStatus === 'waitlisted' ? options.waitlistPosition : undefined,
      capacityOverrideReason: options.capacityOverride ? options.overrideReason.trim() : undefined,
    };
  }
  if (targetStatus === 'offer_sent') patch.offer = { ...options.offer, status: 'sent', sentAt: now, sentBy: options.actor ?? 'School team' };
  if (targetStatus === 'offer_accepted') {
    patch.offer = { ...(app.offer ?? {}), status: 'accepted', acceptedAt: now, acceptanceMethod: options.acceptanceMethod.trim(), acceptanceNotes: options.acceptanceNotes?.trim() || '' };
  }
  if (targetStatus === 'information_requested') {
    patch.informationRequest = { items: options.requestedItems ?? [], message: options.message?.trim() || '', requestedAt: now, requestedBy: options.actor ?? 'School team' };
  }
  if (options.followUp) {
    patch.followUps = [...app.followUps, {
      id: uuid(),
      date: options.followUp.date,
      description: options.followUp.description.trim(),
      assignedTo: options.followUp.assignedTo?.trim() || '',
      createdAt: now,
      createdBy: options.actor ?? 'School team',
    }];
  }
  if (options.communication) {
    patch.communications = [...app.communications, {
      id: uuid(),
      channel: options.communication.channel || 'phone',
      direction: 'inbound',
      message: options.communication.message.trim(),
      at: now,
      actor: options.actor ?? 'School team',
    }];
  }
  return patch;
}

export function transitionAdmission(id, targetStatus, options = {}) {
  const admission = admissionRepo.getById(id);
  if (!admission) throw new Error('This admission record no longer exists.');
  const patch = buildAdmissionTransition(admission, targetStatus, options);
  const saved = admissionRepo.update(id, patch, `moved admission to ${targetStatus}`);
  if (!saved) throw new Error('This admission record could not be updated.');
  return saved;
}

export function addAdmissionFollowUp(id, followUp, actor = 'School team') {
  const admission = admissionRepo.getById(id);
  if (!admission) throw new Error('This admission record no longer exists.');
  if (!followUp?.date || !followUp?.description?.trim()) throw new Error('Enter a follow-up date and description.');
  const app = normalizeAdmission(admission);
  const item = { id: uuid(), date: followUp.date, description: followUp.description.trim(), assignedTo: followUp.assignedTo?.trim() || '', createdAt: new Date().toISOString(), createdBy: actor };
  const saved = admissionRepo.update(id, {
    followUps: [...app.followUps, item],
    activity: admissionActivity(app, 'Follow-up scheduled', { date: item.date, description: item.description }, actor),
  }, 'scheduled admission follow-up');
  if (!saved) throw new Error('The follow-up could not be saved.');
  return saved;
}

export function completeAdmissionFollowUp(id, followUpId, actor = 'School team') {
  const admission = admissionRepo.getById(id);
  if (!admission) throw new Error('This admission record no longer exists.');
  const app = normalizeAdmission(admission);
  const followUp = app.followUps.find((item) => item.id === followUpId);
  if (!followUp) throw new Error('This follow-up no longer exists.');
  if (followUp.completedAt) return admission;
  const now = new Date().toISOString();
  const saved = admissionRepo.update(id, {
    followUps: app.followUps.map((item) => item.id === followUpId ? { ...item, completedAt: now, completedBy: actor } : item),
    activity: admissionActivity(app, 'Follow-up completed', { followUpId }, actor),
  }, 'completed admission follow-up');
  if (!saved) throw new Error('The follow-up could not be updated.');
  return saved;
}

export function addAdmissionCommunication(id, communication, actor = 'School team') {
  const admission = admissionRepo.getById(id);
  if (!admission) throw new Error('This admission record no longer exists.');
  if (!communication?.message?.trim()) throw new Error('Enter a communication note.');
  const app = normalizeAdmission(admission);
  const item = {
    id: uuid(),
    channel: communication.channel || 'internal',
    direction: communication.direction || 'outbound',
    message: communication.message.trim(),
    contact: communication.contact?.trim() || '',
    at: new Date().toISOString(),
    actor,
  };
  const saved = admissionRepo.update(id, {
    communications: [...app.communications, item],
    activity: admissionActivity(app, 'Communication recorded', { channel: item.channel, direction: item.direction }, actor),
  }, 'recorded admission communication');
  if (!saved) throw new Error('The communication could not be saved.');
  return saved;
}

export function nextAdmissionAction(admission) {
  const status = getAdmissionStatus(admission);
  const actions = {
    enquiry: ['Start application', 'application_started'],
    contacted: ['Start application', 'application_started'],
    follow_up_due: ['Record contact', 'contacted'],
    application_started: ['Complete application', 'draft'],
    draft: ['Submit application', 'submitted'],
    submitted: ['Start review', 'under_review'],
    incomplete: ['Request missing information', 'information_requested'],
    information_requested: ['Record resubmission', 'resubmitted'],
    resubmitted: ['Continue review', 'under_review'],
    under_review: ['Complete review', 'review_complete'],
    review_complete: ['Make admission decision', 'approved'],
    approved: ['Prepare admission offer', 'offer_sent'],
    waitlisted: ['Reconsider application', 'under_review'],
    offer_sent: ['Record offer response', 'offer_accepted'],
    offer_accepted: ['Complete enrollment', 'enrollment_pending'],
    enrollment_pending: ['Admit student', 'admitted'],
    rejected: ['Archive application', 'archived'],
    withdrawn: ['Archive application', 'archived'],
    admitted: ['View student record', null],
    archived: ['Reopen application', 'under_review'],
  };
  return actions[status] ?? ['Review application', 'under_review'];
}

export function admissionsAnalytics(admissions, students = []) {
  const normalized = admissions.map(normalizeAdmission);
  const count = (statuses) => normalized.filter((item) => statuses.includes(item.status)).length;
  const enquiries = count(['enquiry', 'contacted', 'follow_up_due', 'application_started', 'lost', 'closed']);
  const applications = normalized.filter((item) => !['enquiry', 'contacted', 'follow_up_due', 'lost', 'closed'].includes(item.status)).length;
  const offers = count(['offer_sent', 'offer_accepted', 'offer_declined', 'offer_expired']);
  const decided = count(['approved', 'waitlisted', 'rejected', 'offer_sent', 'offer_accepted', 'offer_declined', 'offer_expired', 'enrollment_pending', 'admitted']);
  const followUps = normalized.flatMap((item) => item.followUps.map((followUp) => ({ ...followUp, admission: item })));
  const today = new Date().toISOString().slice(0, 10);
  const due = followUps.filter((followUp) => !followUp.completedAt && followUp.date === today).length;
  const overdue = followUps.filter((followUp) => !followUp.completedAt && followUp.date && followUp.date < today).length;
  const byClass = new Map();
  normalized.forEach((item) => {
    const key = item.classInterested || item.classId || 'unspecified';
    const countForClass = byClass.get(key) ?? { total: 0, admitted: 0, waitlisted: 0, offers: 0 };
    countForClass.total += 1;
    if (item.status === 'admitted') countForClass.admitted += 1;
    if (item.status === 'waitlisted') countForClass.waitlisted += 1;
    if (['offer_sent', 'offer_accepted'].includes(item.status)) countForClass.offers += 1;
    byClass.set(key, countForClass);
  });
  return {
    totalEnquiries: enquiries,
    newEnquiries: count(['enquiry']),
    awaitingFollowUp: count(['follow_up_due']),
    totalApplications: applications,
    drafts: count(['draft', 'application_started']),
    submitted: count(['submitted', 'resubmitted']),
    underReview: count(['under_review', 'review_complete']),
    approved: count(['approved']),
    waitlisted: count(['waitlisted']),
    offersSent: count(['offer_sent']),
    offersAwaitingResponse: count(['offer_sent']),
    confirmedAdmissions: count(['offer_accepted', 'enrollment_pending', 'admitted']),
    enrolled: count(['admitted']),
    rejected: count(['rejected']),
    withdrawn: count(['withdrawn']),
    conversionRate: enquiries ? Math.round((applications / enquiries) * 100) : 0,
    offerAcceptanceRate: offers ? Math.round((count(['offer_accepted']) / offers) * 100) : 0,
    admissionCompletionRate: applications ? Math.round((count(['admitted']) / applications) * 100) : 0,
    followUpsDueToday: due,
    overdueFollowUps: overdue,
    activeStudents: students.filter((student) => !['archived', 'graduated', 'withdrawn', 'transferred'].includes(student.status ?? 'active')).length,
    byClass: [...byClass.entries()].map(([key, value]) => ({ key, ...value })),
    recentActivity: normalized.flatMap((item) => item.activity.map((activity) => ({ ...activity, admissionId: item.id, childName: item.childName })))
      .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8),
    pendingTasks: normalized.filter((item) => ['incomplete', 'information_requested', 'under_review', 'enrollment_pending'].includes(item.status)),
  };
}

export function classCapacitySummary(schoolClass, students, admissions, configuredLimit) {
  const limit = Number(configuredLimit ?? schoolClass?.admissionCapacity ?? schoolClass?.capacity);
  const classStudents = students.filter((student) => student.classId === schoolClass?.id && !['archived', 'graduated', 'withdrawn', 'transferred'].includes(student.status ?? 'active'));
  const studentIds = new Set(classStudents.map((student) => student.id));
  const reservations = admissions.map(normalizeAdmission).filter((item) =>
    (item.classInterested === schoolClass?.id || item.classId === schoolClass?.id)
    && ['offer_sent', 'offer_accepted', 'enrollment_pending'].includes(item.status)
    && !studentIds.has(item.admittedStudentId)
  );
  const reserved = new Set(reservations.map((item) => item.id)).size;
  const assigned = classStudents.length + reserved;
  return {
    classId: schoolClass?.id,
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
    students: classStudents.length,
    reserved,
    waitlisted: admissions.map(normalizeAdmission).filter((item) => item.classInterested === schoolClass?.id && item.status === 'waitlisted').length,
    assigned,
    available: Number.isFinite(limit) && limit > 0 ? Math.max(0, limit - assigned) : null,
    utilization: Number.isFinite(limit) && limit > 0 ? Math.min(100, Math.round((assigned / limit) * 100)) : null,
  };
}

export function findPotentialDuplicate(admission, students) {
  const app = normalizeAdmission(admission);
  const name = String(app.childName ?? [app.firstName, app.lastName].filter(Boolean).join(' ')).trim().toLowerCase().replace(/\s+/g, ' ');
  const dob = app.dateOfBirth ?? '';
  if (!name) return [];
  return students.filter((student) => {
    const studentName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ').trim().toLowerCase().replace(/\s+/g, ' ');
    return studentName === name && (!dob || !student.dateOfBirth || student.dateOfBirth === dob);
  });
}

function splitName(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) throw new Error('Enter the student’s first and last name before enrollment.');
  return { firstName: parts[0], middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : undefined, lastName: parts.at(-1) };
}

export function buildEnrollmentPayload(admission, { admissionNumber, classId, streamId, admissionDate, actor } = {}) {
  const app = normalizeAdmission(admission);
  const { firstName, middleName, lastName } = splitName(app.childName ?? [app.firstName, app.middleName, app.lastName].filter(Boolean).join(' '));
  if (!admissionNumber?.trim()) throw new Error('Enter an admission number before completing enrollment.');
  if (!classId) throw new Error('Select a class before completing enrollment.');
  if (!admissionDate) throw new Error('Enter the enrollment date before completing enrollment.');
  const parentIds = app.guardians.map((guardian) => guardian.id).filter(Boolean);
  const student = {
    admissionNumber: admissionNumber.trim(),
    firstName,
    middleName,
    lastName,
    dateOfBirth: app.dateOfBirth || undefined,
    gender: app.gender || undefined,
    classId,
    streamId: streamId || undefined,
    academicYearId: app.academicYearId || undefined,
    admissionDate,
    boardingStatus: app.boardingStatus === 'boarding' ? 'boarding' : 'day',
    usesTransport: false,
    parentIds,
    status: 'active',
    sourceAdmissionId: app.id,
    enrollmentDate: admissionDate,
    enrolledBy: actor ?? 'School team',
  };
  return { student, guardians: app.guardians };
}

function admissionHistory(app, action, actor, options = {}) {
  return admissionActivity(app, action, {
    capacityOverrideReason: options.capacityOverride ? options.overrideReason.trim() : undefined,
  }, actor);
}

export function convertToStudent(applicationId, options) {
  const application = admissionRepo.getById(applicationId);
  if (!application) throw new Error('This application no longer exists.');
  const app = normalizeAdmission(application);
  if (app.admittedStudentId) {
    const existing = studentRepo.getById(app.admittedStudentId);
    if (existing) return existing;
  }
  const legacyApproved = !application.status && application.stage === 'approved';
  if (!['offer_accepted', 'enrollment_pending'].includes(app.status) && !legacyApproved) {
    throw new Error('Approve the application and record offer acceptance before enrolling this student.');
  }
  const { student: draft, guardians } = buildEnrollmentPayload(app, options);
  const targetClass = classRepo.getById(draft.classId);
  if (!targetClass) throw new Error('The selected class no longer exists.');
  const capacity = classCapacitySummary(targetClass, studentRepo.getAll(), admissionRepo.getAll().filter((item) => item.id !== applicationId));
  if (capacity.available !== null && capacity.available <= 0 && !(options.capacityOverride && options.overrideReason?.trim())) {
    throw new Error('The selected class has no available places. Choose another class or record an authorized capacity override with a reason.');
  }
  const duplicate = studentRepo.find((student) =>
    student.admissionNumber?.trim().toLowerCase() === draft.admissionNumber.trim().toLowerCase()
    || ([student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ').toLowerCase() === [draft.firstName, draft.middleName, draft.lastName].filter(Boolean).join(' ').toLowerCase()
      && student.dateOfBirth && draft.dateOfBirth && student.dateOfBirth === draft.dateOfBirth)
  )[0];
  if (duplicate) {
    if (duplicate.sourceAdmissionId === applicationId) {
      admissionRepo.update(applicationId, { status: 'admitted', stage: 'admitted', admittedStudentId: duplicate.id }, 'reconciled admission enrollment');
      return duplicate;
    }
    throw new Error('A student with a matching admission number or name and date of birth already exists. Review the existing student before enrolling.');
  }

  const madeParents = [];
  const updatedParents = [];
  let student;
  try {
    const parentRecords = guardians.map((guardian) => {
      const { fullName = '', ...details } = guardian;
      const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
      return {
        id: guardian.id ?? uuid(),
        firstName: parts[0] ?? '',
        lastName: parts.slice(1).join(' '),
        phone: details.phone || undefined,
        email: details.email || undefined,
        relationship: details.relationship || undefined,
        address: details.address || undefined,
        primary: Boolean(details.primary),
        studentIds: [],
        sourceAdmissionId: applicationId,
      };
    });
    const existingParents = parentRepo.getAll();
    for (const parent of parentRecords) {
      const existing = existingParents.find((item) => item.email && parent.email && item.email.toLowerCase() === parent.email.toLowerCase());
      if (existing) {
        parent.id = existing.id;
        if (!(existing.studentIds ?? []).includes(application.admittedStudentId)) updatedParents.push(existing);
      } else {
        const savedParent = parentRepo.create(parent, `added guardian from admission ${applicationId}`);
        parent.id = savedParent.id;
        madeParents.push(savedParent);
      }
    }
    draft.parentIds = [...new Set(parentRecords.map((parent) => parent.id))];
    student = studentRepo.create(draft, `admitted student ${draft.firstName} ${draft.lastName} from admissions`);
    parentRecords.forEach((parent) => {
      const saved = madeParents.find((item) => item.id === parent.id) ?? parentRepo.getById(parent.id);
      if (saved && !(saved.studentIds ?? []).includes(student.id)) parentRepo.update(saved.id, { studentIds: [...(saved.studentIds ?? []), student.id] }, 'linked guardian to admitted student');
    });
    const updatedAdmission = admissionRepo.update(applicationId, {
      status: 'admitted',
      stage: 'admitted',
      admittedStudentId: student.id,
      enrollmentDate: options.admissionDate,
      enrolledBy: options.actor ?? 'School team',
      activity: admissionHistory(app, `Enrolled ${draft.firstName} ${draft.lastName}`, options.actor, options),
    }, 'admitted applicant');
    if (!updatedAdmission) throw new Error('The application could not be linked to the new student record.');
    return student;
  } catch (error) {
    if (student) studentRepo.remove(student.id, 'rolled back incomplete admission enrollment');
    updatedParents.forEach((parent) => parentRepo.update(parent.id, { studentIds: parent.studentIds ?? [] }, 'rolled back incomplete admission guardian link'));
    madeParents.filter((item) => !item.update).forEach((parent) => parentRepo.remove(parent.id, 'rolled back incomplete admission guardian'));
    throw error;
  }
}

export function moveStage(id, stage) {
  const admission = admissionRepo.getById(id);
  if (!admission) throw new Error('This admission record no longer exists.');
  const status = stage === 'application' ? 'draft' : stage === 'approved' ? 'approved' : stage === 'admitted' ? 'admitted' : stage === 'rejected' ? 'rejected' : 'enquiry';
  const patch = buildAdmissionTransition(admission, status, { reason: status === 'rejected' ? 'Closed from the legacy admissions workflow.' : undefined });
  return admissionRepo.update(id, patch, `moved admission to ${status}`);
}
