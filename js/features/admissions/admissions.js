import { escapeHtml, on, qs } from '../../components/dom.js';
import {
  ADMISSIONS_VIEWS,
  ADMISSION_STATUS_LABELS,
  addAdmissionCommunication,
  addAdmissionFollowUp,
  admissionActivity,
  admissionChecklist,
  admissionRepo,
  admissionsAnalytics,
  classCapacitySummary,
  completeAdmissionFollowUp,
  convertToStudent,
  findPotentialDuplicate,
  normalizeAdmission,
  transitionAdmission,
} from '../../services/admissionsService.js';
import { academicYearRepo, classesSortedByOrder, termRepo } from '../../services/academicService.js';
import { getSettings } from '../../services/settingsService.js';
import { studentRepo } from '../../services/studentService.js';
import { addDocument, downloadDocument, readFileAsDataUrl, removeDocument, removeRemoteDocument, uploadRemoteDocument, downloadRemoteDocument, validateUpload } from '../../services/documentService.js';
import { createRemoteAdmission, convertRemoteAdmission, loadAdmissionsWorkspace, moveRemoteAdmission, updateRemoteAdmission } from '../../services/supabaseAdmissionsService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { uuid } from '../../lib/uuid.js';

const VIEW_FILTERS = {
  overview: () => true,
  enquiries: (status) => ['enquiry', 'contacted', 'follow_up_due', 'application_started', 'lost', 'closed'].includes(status),
  applications: (status) => ['draft', 'submitted', 'incomplete', 'information_requested', 'resubmitted'].includes(status),
  review: (status) => ['under_review', 'review_complete', 'waitlisted', 'rejected'].includes(status),
  offers: (status) => ['approved', 'offer_sent', 'offer_accepted', 'offer_declined', 'offer_expired', 'enrollment_pending'].includes(status),
  admitted: (status) => status === 'admitted',
  archive: (status) => ['archived', 'withdrawn', 'lost', 'closed', 'offer_declined', 'offer_expired'].includes(status),
};

const TRANSITION_ACTIONS = {
  enquiry: [['contacted', 'Record contact'], ['follow_up_due', 'Schedule follow-up'], ['application_started', 'Start application'], ['lost', 'Mark as lost']],
  contacted: [['follow_up_due', 'Schedule follow-up'], ['application_started', 'Start application'], ['closed', 'Close enquiry']],
  follow_up_due: [['contacted', 'Record contact'], ['application_started', 'Start application'], ['lost', 'Mark as lost']],
  application_started: [['draft', 'Continue application']],
  draft: [['submitted', 'Submit application'], ['incomplete', 'Mark incomplete']],
  submitted: [['under_review', 'Start review'], ['information_requested', 'Request information']],
  incomplete: [['information_requested', 'Request information'], ['resubmitted', 'Record resubmission']],
  information_requested: [['resubmitted', 'Record resubmission']],
  resubmitted: [['under_review', 'Continue review']],
  under_review: [['review_complete', 'Complete review'], ['information_requested', 'Request information']],
  review_complete: [['approved', 'Approve'], ['waitlisted', 'Waitlist'], ['rejected', 'Reject']],
  approved: [['offer_sent', 'Issue offer']],
  waitlisted: [['under_review', 'Reconsider'], ['approved', 'Approve'], ['rejected', 'Reject']],
  offer_sent: [['offer_accepted', 'Record acceptance'], ['offer_declined', 'Record decline'], ['offer_expired', 'Mark expired']],
  offer_accepted: [['enrollment_pending', 'Begin enrollment']],
  enrollment_pending: [['enroll', 'Enroll student']],
  rejected: [['archived', 'Archive']],
  withdrawn: [['archived', 'Archive']],
  lost: [['archived', 'Archive'], ['enquiry', 'Reopen enquiry']],
  closed: [['archived', 'Archive'], ['enquiry', 'Reopen enquiry']],
  offer_declined: [['archived', 'Archive'], ['under_review', 'Reopen review']],
  offer_expired: [['archived', 'Archive'], ['under_review', 'Reopen review']],
  archived: [['under_review', 'Reopen application']],
};

const LABEL_BY_VIEW = Object.fromEntries(ADMISSIONS_VIEWS);
const nameOf = (record) => record?.childName || [record?.firstName, record?.middleName, record?.lastName].filter(Boolean).join(' ') || 'Unnamed applicant';
const guardianSummary = (app) => app.guardians.map((guardian) => guardian.fullName).filter(Boolean).join(', ') || app.parentName || 'No guardian';
const formatDate = (date) => date ? new Date(`${date.slice(0, 10)}T00:00:00`).toLocaleDateString() : '—';

export function renderAdmissions(container, { schoolId } = {}) {
  const remote = isSupabaseConfigured();
  const state = {
    view: 'overview',
    query: '',
    statusFilter: '',
    classFilter: '',
    formOpen: false,
    editId: '',
    profileId: '',
    enrollId: '',
    error: '',
    saving: false,
    fileBusy: false,
  };
  let classes = [];
  let students = [];
  let admissions = [];
  let settings = {};
  let academicYears = [];
  let terms = [];

  async function loadData() {
    if (remote) {
      const data = await loadAdmissionsWorkspace();
      ({ admissions, classes, students, settings, academicYears, terms } = data);
    } else {
      admissions = admissionRepo.getAll();
      classes = classesSortedByOrder();
      students = studentRepo.getAll();
      settings = getSettings();
      academicYears = academicYearRepo.getAll();
      terms = termRepo.getAll();
    }
    admissions = admissions.map(normalizeAdmission).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  }

  async function render() {
    try {
      await loadData();
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="admissions-retry">Retry</button></div>`;
      qs(container, '#admissions-retry').addEventListener('click', render);
      return;
    }
    const classById = Object.fromEntries(classes.map((item) => [item.id, item]));
    const profile = admissions.find((item) => item.id === state.profileId);
    const filtered = admissions.filter((item) => {
      if (!VIEW_FILTERS[state.view](item.status)) return false;
      if (state.statusFilter && item.status !== state.statusFilter) return false;
      if (state.classFilter && (item.classInterested || item.classId) !== state.classFilter) return false;
      if (state.query.trim()) {
        const query = state.query.trim().toLowerCase();
        const searchable = [
          nameOf(item), item.id, item.parentName, item.phone, item.email, item.notes,
          ...item.guardians.flatMap((guardian) => [guardian.fullName, guardian.phone, guardian.email]),
        ].join(' ').toLowerCase();
        if (!searchable.includes(query)) return false;
      }
      return true;
    });
    const metrics = admissionsAnalytics(admissions, students);

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 class="text-xl" style="font-weight:600;">Admissions &amp; Enrollment</h1>
            <p class="text-sm text-ink-500 mt-1">Track enquiries through review, offers and confirmed enrollment.</p>
          </div>
          <button class="btn-primary" id="new-admission">+ New enquiry</button>
        </div>
        ${state.view === 'overview' ? overviewHtml(metrics) : ''}
        <div class="pill-group" style="flex-wrap:wrap;">
          ${ADMISSIONS_VIEWS.map(([key, label]) => {
            const count = admissions.filter((item) => VIEW_FILTERS[key](item.status)).length;
            return `<button class="pill ${state.view === key ? 'active' : ''}" data-view="${key}">${escapeHtml(label)} (${count})</button>`;
          }).join('')}
        </div>
        <div class="flex flex-wrap gap-3">
          <input class="input" style="max-width:20rem" id="admission-search" placeholder="Search applicants, guardians, contact" value="${escapeHtml(state.query)}" />
          <select class="input" style="max-width:15rem" id="admission-status-filter">
            <option value="">All statuses</option>
            ${Object.entries(ADMISSION_STATUS_LABELS).map(([key, label]) => `<option value="${key}" ${state.statusFilter === key ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
          <select class="input" style="max-width:15rem" id="admission-class-filter">
            <option value="">All classes</option>
            ${classes.map((item) => `<option value="${escapeHtml(item.id)}" ${state.classFilter === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
          </select>
        </div>
        ${state.formOpen ? admissionFormHtml() : ''}
        ${state.enrollId ? enrollmentFormHtml(state.enrollId) : ''}
        ${profile ? profileHtml(profile, classById) : ''}
        ${filtered.length
          ? `<div class="card" style="overflow:hidden;">${filtered.map((item) => recordHtml(item, classById)).join('')}</div>`
          : `<div class="card">${emptyState({
              iconHtml: icons.clipboard(40),
              title: state.query || state.statusFilter || state.classFilter ? 'No applicants match these filters' : `No records in ${LABEL_BY_VIEW[state.view]}`,
              body: state.view === 'enquiries' || state.view === 'overview' ? 'Create an enquiry to start an application.' : undefined,
              actionsHtml: state.view === 'enquiries' || state.view === 'overview' ? '<button class="btn-primary" id="empty-new-admission">+ New enquiry</button>' : '',
            })}</div>`
        }
      </div>
    `;

    on(container, '[data-view]', 'click', (event) => {
      state.view = event.currentTarget.dataset.view;
      state.statusFilter = '';
      state.profileId = '';
      state.formOpen = false;
      state.enrollId = '';
      render();
    });
    on(container, '#admission-search', 'input', (event) => { state.query = event.target.value; });
    on(container, '#admission-search', 'change', render);
    on(container, '#admission-status-filter', 'change', (event) => { state.statusFilter = event.target.value; render(); });
    on(container, '#admission-class-filter', 'change', (event) => { state.classFilter = event.target.value; render(); });
    on(container, '#new-admission, #empty-new-admission', 'click', () => {
      state.profileId = '';
      state.editId = '';
      state.formOpen = true;
      render();
    });
    on(container, '[data-open-profile]', 'click', (event) => {
      state.profileId = event.currentTarget.dataset.openProfile;
      state.formOpen = false;
      render();
    });
    on(container, '[data-edit-admission]', 'click', (event) => {
      state.editId = event.currentTarget.dataset.editAdmission;
      state.formOpen = true;
      state.profileId = '';
      render();
    });
    on(container, '[data-close-profile]', 'click', () => { state.profileId = ''; render(); });
    if (state.formOpen) wireAdmissionForm();
    if (profile) wireProfile(profile);
    if (state.enrollId) wireEnrollmentForm();
    on(container, '[data-transition]', 'click', handleTransition);
    on(container, '[data-open-enrollment]', 'click', (event) => {
      state.enrollId = event.currentTarget.dataset.openEnrollment;
      state.profileId = '';
      render();
    });
    on(container, '[data-complete-followup]', 'click', async (event) => {
      const id = profile?.id;
      if (!id) return;
      try {
        if (remote) await updateRemoteAdmission(id, followUpPatch(profile, event.currentTarget.dataset.completeFollowup));
        else completeAdmissionFollowUp(id, event.currentTarget.dataset.completeFollowup);
        state.error = '';
      } catch (error) { state.error = error.message; }
      render();
    });
    on(container, '[data-verify-document]', 'click', async (event) => {
      if (!profile) return;
      const documentId = event.currentTarget.dataset.verifyDocument;
      const documents = profile.documents.map((item) => item.id === documentId
        ? { ...item, status: 'verified', verifiedAt: new Date().toISOString(), verifiedBy: 'School team' }
        : item);
      try {
        await saveAdmission(profile.id, { documents });
        state.error = '';
      } catch (error) { state.error = error.message; }
      render();
    });
    on(container, '[data-download-document]', 'click', async (event) => {
      const doc = profile?.documents.find((item) => item.id === event.currentTarget.dataset.downloadDocument);
      if (!doc) return;
      try {
        if (remote) await downloadRemoteDocument(doc);
        else if (!downloadDocument(doc.documentId ?? doc.id)) throw new Error('The saved file could not be found.');
        state.error = '';
      } catch (error) { state.error = error.message; render(); }
    });
    on(container, '[data-remove-document]', 'click', async (event) => {
      if (!profile) return;
      const id = event.currentTarget.dataset.removeDocument;
      const document = profile.documents.find((item) => item.id === id);
      let unlinked = false;
      try {
        const documents = profile.documents.filter((item) => item.id !== id);
        await saveAdmission(profile.id, { documents }, 'Removed an admission document');
        unlinked = true;
        if (document?.documentId || document?.storagePath) {
          if (remote) await removeRemoteDocument({ id: document.documentId || document.id, storagePath: document.storagePath });
          else removeDocument(document.documentId || document.id);
        }
        state.error = '';
      } catch (error) { state.error = unlinked ? `The document was unlinked, but its stored file could not be removed: ${error.message}` : error.message; }
      render();
    });
    on(container, '#admission-file', 'change', (event) => uploadAdmissionFile(profile, event.target.files?.[0]));
    on(container, '[data-delete-admission]', 'click', async (event) => {
      const item = admissions.find((record) => record.id === event.currentTarget.dataset.deleteAdmission);
      if (!item || item.status === 'admitted' || !confirm('Permanently delete this admission record? This cannot be undone.')) return;
      try {
        if (remote) throw new Error('Admission records should be archived rather than deleted from the cloud.');
        admissionRepo.remove(item.id, 'deleted admission');
        state.error = '';
      } catch (error) { state.error = error.message; }
      render();
    });
  }

  function overviewHtml(metrics) {
    const cards = [
      ['Enquiries', metrics.totalEnquiries],
      ['Applications', metrics.totalApplications],
      ['Under review', metrics.underReview],
      ['Offers awaiting response', metrics.offersAwaitingResponse],
      ['Confirmed admissions', metrics.confirmedAdmissions],
      ['Enrolled', metrics.enrolled],
      ['Follow-ups due today', metrics.followUpsDueToday],
      ['Overdue follow-ups', metrics.overdueFollowUps],
    ];
    const capacityRows = classes.map((item) => {
      const summary = classCapacitySummary(item, students, admissions);
      return `<tr><td>${escapeHtml(item.name)}</td><td>${summary.students}</td><td>${summary.reserved}</td><td>${summary.waitlisted}</td><td>${summary.available ?? 'Not set'}</td></tr>`;
    }).join('');
    const activity = metrics.recentActivity.map((item) => `<li class="text-sm text-ink-600">${escapeHtml(item.childName || 'Applicant')}: ${escapeHtml(item.action)} <span class="text-xs text-ink-400">${escapeHtml(formatDate(item.at))}</span></li>`).join('');
    const pending = metrics.pendingTasks.slice(0, 6).map((item) => `<li><button class="text-brand-700 text-sm" data-open-profile="${escapeHtml(item.id)}">${escapeHtml(nameOf(item))}</button> <span class="text-xs text-ink-500">${escapeHtml(ADMISSION_STATUS_LABELS[item.status])}</span></li>`).join('');
    return `
      <section class="grid lg-grid-4 gap-3">
        ${cards.map(([label, value]) => `<div class="card card-p"><p class="text-xs text-ink-500">${escapeHtml(label)}</p><p class="text-xl mt-1" style="font-weight:600;">${value}</p></div>`).join('')}
      </section>
      <section class="grid sm-grid-2 gap-4">
        <div class="card card-p space-y-3">
          <h2 class="text-sm" style="font-weight:600;">Class capacity</h2>
          ${classes.length ? `<div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Class</th><th>Enrolled</th><th>Reserved</th><th>Waitlist</th><th>Places left</th></tr></thead><tbody>${capacityRows}</tbody></table></div>` : '<p class="text-sm text-ink-500">Add classes to track capacity.</p>'}
        </div>
        <div class="card card-p space-y-3">
          <h2 class="text-sm" style="font-weight:600;">Admissions activity</h2>
          ${activity ? `<ul class="space-y-2">${activity}</ul>` : '<p class="text-sm text-ink-500">No recent activity has been recorded.</p>'}
          ${pending ? `<h3 class="text-sm mt-4" style="font-weight:600;">Needs attention</h3><ul class="space-y-2">${pending}</ul>` : ''}
          <p class="text-xs text-ink-500">Application conversion ${metrics.conversionRate}% · Offer acceptance ${metrics.offerAcceptanceRate}% · Enrollment completion ${metrics.admissionCompletionRate}%</p>
        </div>
      </section>
    `;
  }

  function recordHtml(app, classById) {
    const classId = app.classInterested || app.classId;
    const capacity = classCapacitySummary(classById[classId], students, admissions);
    const actions = TRANSITION_ACTIONS[app.status] ?? [];
    return `
      <article style="padding:0.9rem 1rem;border-bottom:1px solid var(--ink-50);">
        <div class="flex justify-between items-start gap-3 flex-wrap">
          <div style="min-width:16rem;flex:1;">
            <button class="text-sm text-brand-700" style="font-weight:600;background:none;border:0;padding:0;cursor:pointer;" data-open-profile="${escapeHtml(app.id)}">${escapeHtml(nameOf(app))}</button>
            <p class="text-xs text-ink-500 mt-1">${escapeHtml(classById[classId]?.name || 'Class not selected')} · ${escapeHtml(guardianSummary(app))} · ${escapeHtml(app.phone || app.guardians[0]?.phone || app.email || app.guardians[0]?.email || 'No contact')}</p>
            <p class="text-xs text-ink-400 mt-1">Created ${escapeHtml(formatDate(app.createdAt))}${app.followUps.some((item) => !item.completedAt && item.date <= new Date().toISOString().slice(0, 10)) ? ' · Follow-up due' : ''}</p>
          </div>
          <div class="flex items-center flex-wrap gap-2">
            <span class="badge ${['admitted', 'offer_accepted'].includes(app.status) ? 'badge-good' : app.status === 'rejected' ? 'badge-bad' : ''}">${escapeHtml(ADMISSION_STATUS_LABELS[app.status] ?? app.status)}</span>
            ${app.status === 'approved' && capacity.available !== null ? `<span class="text-xs text-ink-500">${capacity.available} places left</span>` : ''}
            ${actions.map(([target, label]) => target === 'enroll'
              ? `<button class="btn-primary btn-sm" data-open-enrollment="${escapeHtml(app.id)}">${escapeHtml(label)}</button>`
              : `<button class="${['approved', 'offer_sent', 'enrollment_pending'].includes(target) ? 'btn-primary' : 'btn-secondary'} btn-sm" data-transition="${target}" data-admission="${escapeHtml(app.id)}">${escapeHtml(label)}</button>`).join('')}
            <button class="btn-ghost btn-sm" data-edit-admission="${escapeHtml(app.id)}">Edit</button>
            ${!remote && app.status !== 'admitted' ? `<button class="btn-ghost btn-sm" data-delete-admission="${escapeHtml(app.id)}" aria-label="Delete admission">Delete</button>` : ''}
          </div>
        </div>
      </article>
    `;
  }

  function admissionFormHtml() {
    const current = admissions.find((item) => item.id === state.editId);
    const app = current ? normalizeAdmission(current) : { guardians: [] };
    const guardians = [...app.guardians];
    while (guardians.length < 2) guardians.push({});
    const yearOptions = academicYears.map((year) => `<option value="${escapeHtml(year.id)}" ${app.academicYearId === year.id ? 'selected' : ''}>${escapeHtml(year.label || year.name || 'Academic year')}</option>`).join('');
    const termOptions = terms.filter((term) => !app.academicYearId || term.academicYearId === app.academicYearId)
      .map((term) => `<option value="${escapeHtml(term.id)}" ${app.termId === term.id ? 'selected' : ''}>${escapeHtml(term.name || term.label || 'Term')}</option>`).join('');
    return `
      <form class="card card-p space-y-4" id="admission-form">
        <h2 class="text-sm" style="font-weight:600;">${current ? 'Edit applicant' : 'New enquiry'}</h2>
        <div class="grid sm-grid-3 gap-4">
          <div><label class="label" for="adm-name">Student full name</label><input class="input" id="adm-name" name="childName" required value="${escapeHtml(nameOf(app) === 'Unnamed applicant' ? '' : nameOf(app))}" /></div>
          <div><label class="label" for="adm-dob">Date of birth</label><input class="input" type="date" id="adm-dob" name="dateOfBirth" value="${escapeHtml(app.dateOfBirth || '')}" /></div>
          <div><label class="label" for="adm-gender">Gender</label><select class="input" id="adm-gender" name="gender"><option value="">Not specified</option><option value="female" ${app.gender === 'female' ? 'selected' : ''}>Female</option><option value="male" ${app.gender === 'male' ? 'selected' : ''}>Male</option><option value="other" ${app.gender === 'other' ? 'selected' : ''}>Other</option></select></div>
        </div>
        <div class="grid sm-grid-3 gap-4">
          <div><label class="label" for="adm-class">Class applying for</label><select class="input" id="adm-class" name="classInterested"><option value="">Not selected</option>${classes.map((item) => `<option value="${escapeHtml(item.id)}" ${app.classInterested === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></div>
          <div><label class="label" for="adm-year">Academic year</label><select class="input" id="adm-year" name="academicYearId"><option value="">Select year</option>${yearOptions}</select></div>
          <div><label class="label" for="adm-term">Term</label><select class="input" id="adm-term" name="termId"><option value="">Select term</option>${termOptions}</select></div>
        </div>
        <div class="grid sm-grid-2 gap-4">
          ${guardians.map((guardian, index) => `<fieldset class="space-y-2" style="border:1px solid var(--ink-100);border-radius:.5rem;padding:.75rem;"><legend class="text-xs text-ink-600">Guardian ${index + 1}${index === 0 ? ' (primary)' : ' (optional)'}</legend>
            <label class="label" for="guardian-name-${index}">Full name</label><input class="input" id="guardian-name-${index}" name="guardianName${index}" value="${escapeHtml(guardian.fullName || '')}" />
            <div class="grid sm-grid-2 gap-2"><div><label class="label" for="guardian-phone-${index}">Phone</label><input class="input" id="guardian-phone-${index}" name="guardianPhone${index}" value="${escapeHtml(guardian.phone || '')}" /></div><div><label class="label" for="guardian-email-${index}">Email</label><input class="input" id="guardian-email-${index}" name="guardianEmail${index}" type="email" value="${escapeHtml(guardian.email || '')}" /></div></div>
            <label class="label" for="guardian-relationship-${index}">Relationship</label><input class="input" id="guardian-relationship-${index}" name="guardianRelationship${index}" value="${escapeHtml(guardian.relationship || '')}" />
          </fieldset>`).join('')}
        </div>
        <div class="grid sm-grid-2 gap-4">
          <div><label class="label" for="adm-source">Enquiry source</label><select class="input" id="adm-source" name="source"><option value="">Select source</option>${[['walk_in','Walk-in'],['phone','Phone'],['website','Website'],['whatsapp','WhatsApp'],['referral','Referral'],['school_event','School event'],['other','Other']].map(([value,label]) => `<option value="${value}" ${app.source === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
          <div><label class="label" for="adm-notes">Notes</label><input class="input" id="adm-notes" name="notes" value="${escapeHtml(app.notes || '')}" /></div>
        </div>
        <div class="flex justify-end gap-3"><button class="btn-secondary" type="button" id="cancel-admission-form">Cancel</button><button class="btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'Saving…' : current ? 'Save changes' : 'Save enquiry'}</button></div>
      </form>
    `;
  }

  function profileHtml(app, classById) {
    const checks = admissionChecklist(app, settings);
    const docs = app.documents.map((document) => `<li class="flex justify-between items-center flex-wrap gap-2" style="border-bottom:1px solid var(--ink-50);padding:.55rem 0;">
      <span class="text-sm">${escapeHtml(document.name)} <span class="text-xs text-ink-500">(${escapeHtml(document.status || 'uploaded')})</span></span>
      <span class="flex gap-2">
        ${document.documentId || document.storagePath ? `<button class="btn-ghost btn-sm" data-download-document="${escapeHtml(document.id)}">Download</button>` : ''}
        ${document.status !== 'verified' ? `<button class="btn-secondary btn-sm" data-verify-document="${escapeHtml(document.id)}">Verify</button>` : ''}
        <button class="btn-ghost btn-sm" data-remove-document="${escapeHtml(document.id)}">Remove</button>
      </span>
    </li>`).join('');
    const followUps = app.followUps.map((item) => `<li class="flex justify-between items-center gap-2" style="border-bottom:1px solid var(--ink-50);padding:.55rem 0;">
      <span class="text-sm">${escapeHtml(formatDate(item.date))} · ${escapeHtml(item.description)}${item.assignedTo ? ` · ${escapeHtml(item.assignedTo)}` : ''}${item.completedAt ? ' · Completed' : ''}</span>
      ${item.completedAt ? '' : `<button class="btn-secondary btn-sm" data-complete-followup="${escapeHtml(item.id)}">Complete</button>`}
    </li>`).join('');
    const activity = [...app.activity].sort((a, b) => String(b.at).localeCompare(String(a.at))).map((item) => `<li class="text-xs text-ink-600">${escapeHtml(formatDate(item.at))} · ${escapeHtml(item.actor || 'School team')} — ${escapeHtml(item.action)}</li>`).join('');
    const communications = [...app.communications].reverse().map((item) => `<li class="text-sm text-ink-600">${escapeHtml(formatDate(item.at))} · ${escapeHtml(item.channel)} · ${escapeHtml(item.message)}</li>`).join('');
    const classId = app.classInterested || app.classId;
    const capacity = classCapacitySummary(classById[classId], students, admissions);
    return `
      <section class="card card-p space-y-4">
        <div class="flex justify-between items-start gap-3 flex-wrap">
          <div><p class="text-lg" style="font-weight:600;">${escapeHtml(nameOf(app))}</p><p class="text-sm text-ink-500">${escapeHtml(ADMISSION_STATUS_LABELS[app.status])} · ${escapeHtml(classById[classId]?.name || 'Class not selected')}</p></div>
          <div class="flex gap-2"><button class="btn-secondary btn-sm" data-edit-admission="${escapeHtml(app.id)}">Edit profile</button><button class="btn-ghost btn-sm" data-close-profile>Close</button></div>
        </div>
        <div class="grid sm-grid-3 gap-3">
          <p class="text-sm"><span class="text-ink-500">Date of birth</span><br>${escapeHtml(formatDate(app.dateOfBirth))}</p>
          <p class="text-sm"><span class="text-ink-500">Guardian(s)</span><br>${escapeHtml(guardianSummary(app))}</p>
          <p class="text-sm"><span class="text-ink-500">Contact</span><br>${escapeHtml(app.phone || app.guardians[0]?.phone || '—')} ${escapeHtml(app.email || app.guardians[0]?.email || '')}</p>
          <p class="text-sm"><span class="text-ink-500">Source</span><br>${escapeHtml(app.source || '—')}</p>
          <p class="text-sm"><span class="text-ink-500">Academic year / term</span><br>${escapeHtml(app.academicYearId || '—')} / ${escapeHtml(app.termId || '—')}</p>
          <p class="text-sm"><span class="text-ink-500">Class capacity</span><br>${capacity.available === null ? 'Not configured' : `${capacity.available} places available`}</p>
        </div>
        ${app.notes ? `<p class="text-sm text-ink-600">${escapeHtml(app.notes)}</p>` : ''}
        <div class="grid sm-grid-2 gap-4">
          <div class="space-y-2"><h3 class="text-sm" style="font-weight:600;">Application checklist</h3><ul class="space-y-1">${checks.map((item) => `<li class="text-sm">${item.complete ? '✓' : '○'} ${escapeHtml(item.label)}</li>`).join('')}</ul></div>
          <div class="space-y-2"><h3 class="text-sm" style="font-weight:600;">Documents</h3><label class="label" for="admission-file">Upload a supporting document</label><input class="input" type="file" id="admission-file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" ${state.fileBusy ? 'disabled' : ''} />${state.fileBusy ? '<p class="text-xs text-ink-500">Uploading…</p>' : ''}<ul>${docs || '<li class="text-sm text-ink-500">No files uploaded yet.</li>'}</ul></div>
        </div>
        <div class="grid sm-grid-2 gap-4">
          <div class="space-y-2"><h3 class="text-sm" style="font-weight:600;">Follow-ups</h3><ul>${followUps || '<li class="text-sm text-ink-500">No follow-ups scheduled.</li>'}</ul>
            <form id="follow-up-form" class="grid sm-grid-3 gap-2"><input class="input" type="date" name="date" required aria-label="Follow-up date" /><input class="input" name="description" placeholder="Next action" required /><input class="input" name="assignedTo" placeholder="Assigned to (optional)" /><button class="btn-secondary btn-sm" type="submit">Add follow-up</button></form>
          </div>
          <div class="space-y-2"><h3 class="text-sm" style="font-weight:600;">Communication log</h3><ul class="space-y-2">${communications || '<li class="text-sm text-ink-500">No communication recorded.</li>'}</ul>
            <form id="communication-form" class="space-y-2"><select class="input" name="channel"><option value="phone">Phone</option><option value="email">Email</option><option value="in_person">In person</option><option value="whatsapp">WhatsApp</option><option value="internal">Internal note</option></select><textarea class="input" name="message" rows="2" placeholder="Record the conversation or note" required></textarea><button class="btn-secondary btn-sm" type="submit">Add note</button></form>
          </div>
        </div>
        <div><h3 class="text-sm mb-2" style="font-weight:600;">Activity history</h3><ul class="space-y-1">${activity || '<li class="text-xs text-ink-500">No activity yet.</li>'}</ul></div>
        ${app.status === 'enrollment_pending' ? '<button class="btn-primary" data-open-enrollment="' + escapeHtml(app.id) + '">Complete enrollment</button>' : ''}
      </section>
    `;
  }

  function enrollmentFormHtml(id) {
    const app = admissions.find((item) => item.id === id);
    const preferredClass = app?.classInterested || app?.classId || classes[0]?.id || '';
    const duplicates = findPotentialDuplicate(app ?? {}, students);
    return `
      <form class="card card-p space-y-4" id="enrollment-form">
        <h2 class="text-sm" style="font-weight:600;">Enroll ${escapeHtml(nameOf(app))}</h2>
        ${duplicates.length ? `<div class="notice" role="alert">A possible matching student exists: ${escapeHtml(duplicates.map((item) => [item.firstName, item.lastName].filter(Boolean).join(' ')).join(', '))}. Check the student record before continuing.</div>` : ''}
        <div class="grid sm-grid-3 gap-4">
          <div><label class="label" for="enroll-number">Admission number</label><input class="input" id="enroll-number" name="admissionNumber" required /></div>
          <div><label class="label" for="enroll-class">Class</label><select class="input" id="enroll-class" name="classId" required>${classes.map((item) => `<option value="${escapeHtml(item.id)}" ${preferredClass === item.id ? 'selected' : ''}>${escapeHtml(item.name)}${classCapacitySummary(item, students, admissions).available === 0 ? ' (full)' : ''}</option>`).join('')}</select></div>
          <div><label class="label" for="enroll-date">Enrollment date</label><input class="input" type="date" id="enroll-date" name="admissionDate" value="${new Date().toISOString().slice(0, 10)}" required /></div>
        </div>
        <div class="flex justify-end gap-3"><button type="button" class="btn-secondary" id="cancel-enrollment">Cancel</button><button type="submit" class="btn-primary">Create student record</button></div>
      </form>
    `;
  }

  function wireAdmissionForm() {
    qs(container, '#cancel-admission-form').addEventListener('click', () => { state.formOpen = false; state.editId = ''; render(); });
    qs(container, '#admission-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const guardians = [0, 1].map((index) => ({
        fullName: String(data.get(`guardianName${index}`) || '').trim(),
        phone: String(data.get(`guardianPhone${index}`) || '').trim(),
        email: String(data.get(`guardianEmail${index}`) || '').trim(),
        relationship: String(data.get(`guardianRelationship${index}`) || '').trim(),
        primary: index === 0,
      })).filter((guardian) => guardian.fullName || guardian.phone || guardian.email);
      const details = {
        childName: String(data.get('childName') || '').trim(),
        dateOfBirth: data.get('dateOfBirth') || undefined,
        gender: data.get('gender') || undefined,
        classInterested: data.get('classInterested') || undefined,
        academicYearId: data.get('academicYearId') || undefined,
        termId: data.get('termId') || undefined,
        guardians,
        parentName: guardians[0]?.fullName || undefined,
        phone: guardians[0]?.phone || undefined,
        email: guardians[0]?.email || undefined,
        source: data.get('source') || undefined,
        notes: String(data.get('notes') || '').trim() || undefined,
      };
      if (!details.childName) { state.error = 'Enter the student’s full name.'; render(); return; }
      state.saving = true;
      try {
        if (state.editId) await saveAdmission(state.editId, details);
        else if (remote) await createRemoteAdmission(details);
        else admissionRepo.create({ ...details, status: 'enquiry', stage: 'enquiry' }, 'created admission enquiry');
        state.error = '';
        state.formOpen = false;
        state.editId = '';
      } catch (error) { state.error = error.message; }
      state.saving = false;
      await render();
    });
    qs(container, '#adm-year').addEventListener('change', (event) => {
      const selectedYear = event.target.value;
      const select = qs(container, '#adm-term');
      select.innerHTML = `<option value="">Select term</option>${terms.filter((term) => !selectedYear || term.academicYearId === selectedYear).map((term) => `<option value="${escapeHtml(term.id)}">${escapeHtml(term.name || term.label || 'Term')}</option>`).join('')}`;
    });
  }

  function wireProfile(app) {
    qs(container, '#follow-up-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      try {
        const followUp = { date: data.get('date'), description: data.get('description'), assignedTo: data.get('assignedTo') };
        if (remote) {
          const item = { ...followUp, id: uuid(), createdAt: new Date().toISOString(), createdBy: 'School team' };
          await updateRemoteAdmission(app.id, {
            followUps: [...app.followUps, item],
            activity: admissionActivity(app, 'Follow-up scheduled', { date: item.date, description: item.description }),
          });
        } else addAdmissionFollowUp(app.id, followUp);
        state.error = '';
      } catch (error) { state.error = error.message; }
      render();
    });
    qs(container, '#communication-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      try {
        const item = { id: uuid(), channel: data.get('channel'), message: String(data.get('message') || '').trim(), at: new Date().toISOString(), actor: 'School team' };
        if (remote) await updateRemoteAdmission(app.id, {
          communications: [...app.communications, item],
          activity: admissionActivity(app, 'Communication recorded', { channel: item.channel }),
        });
        else addAdmissionCommunication(app.id, item);
        state.error = '';
      } catch (error) { state.error = error.message; }
      render();
    });
  }

  function wireEnrollmentForm() {
    qs(container, '#cancel-enrollment').addEventListener('click', () => { state.enrollId = ''; render(); });
    qs(container, '#enrollment-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const application = admissions.find((item) => item.id === state.enrollId);
      const selectedClass = classes.find((item) => item.id === data.get('classId'));
      const capacity = classCapacitySummary(selectedClass, students, admissions.filter((item) => item.id !== state.enrollId));
      const options = {
        admissionNumber: data.get('admissionNumber'),
        classId: data.get('classId'),
        admissionDate: data.get('admissionDate'),
      };
      if (capacity.available !== null && capacity.available <= 0) {
        const reason = prompt('This class is at capacity. Enter an authorized override reason to continue, or cancel:');
        if (!reason?.trim()) return;
        options.capacityOverride = true;
        options.overrideReason = reason.trim();
      }
      try {
        if (remote) await convertRemoteAdmission(application, options);
        else convertToStudent(state.enrollId, options);
        state.enrollId = '';
        state.view = 'admitted';
        state.error = '';
      } catch (error) { state.error = error.message; }
      render();
    });
  }

  async function handleTransition(event) {
    const id = event.currentTarget.dataset.admission;
    const target = event.currentTarget.dataset.transition;
    const admission = admissions.find((item) => item.id === id);
    if (!admission) return;
    const options = { settings };
    const classId = admission.classInterested || admission.classId;
    const capacity = classCapacitySummary(classes.find((item) => item.id === classId), students, admissions.filter((item) => item.id !== id));
    if (['approved', 'offer_sent'].includes(target)) {
      options.capacity = capacity;
      if (capacity.available !== null && capacity.available <= 0) {
        const reason = prompt('The selected class is at capacity. Enter an authorized override reason or cancel:');
        if (!reason?.trim()) return;
        options.capacityOverride = true;
        options.overrideReason = reason.trim();
      }
    }
    if (target === 'rejected') {
      options.reason = prompt('Enter the reason for rejecting this application:')?.trim();
      if (!options.reason) return;
    }
    if (target === 'waitlisted') {
      options.reason = prompt('Optional waitlist notes:')?.trim() || '';
      options.waitlistPosition = Number(prompt('Waitlist position (optional):') || '') || undefined;
    }
    if (target === 'offer_sent') {
      const date = new Date();
      date.setDate(date.getDate() + 14);
      options.offer = {
        acceptanceDeadline: prompt('Offer acceptance deadline (YYYY-MM-DD):', date.toISOString().slice(0, 10))?.trim(),
        classId,
        notes: '',
      };
    }
    if (target === 'offer_accepted') {
      options.acceptanceMethod = prompt('How was the offer accepted? (phone, email, in person):')?.trim();
      if (!options.acceptanceMethod) return;
      options.acceptanceNotes = '';
    }
    if (target === 'contacted') {
      const message = prompt('Record a brief note about the contact:')?.trim();
      if (!message) return;
      options.communication = { message, channel: 'phone' };
    }
    if (target === 'follow_up_due') {
      const date = prompt('Follow-up date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10))?.trim();
      const description = prompt('What needs to be followed up?')?.trim();
      if (!date || !description) return;
      options.followUp = { date, description };
    }
    if (target === 'information_requested') {
      options.requestedItems = (prompt('List the missing information or documents (separate with commas):') || '').split(',').map((item) => item.trim()).filter(Boolean);
      if (!options.requestedItems.length) return;
    }
    if (['lost', 'closed', 'withdrawn'].includes(target)) options.reason = prompt('Optional reason:')?.trim() || '';
    try {
      if (remote) await moveRemoteAdmission(id, target, options);
      else transitionAdmission(id, target, options);
      state.error = '';
    } catch (error) { state.error = error.message; }
    render();
  }

  async function saveAdmission(id, patch, action = 'Updated applicant profile') {
    const app = admissions.find((item) => item.id === id);
    const nextPatch = app && !patch.activity
      ? { ...patch, activity: admissionActivity(app, action) }
      : patch;
    if (remote) return updateRemoteAdmission(id, nextPatch);
    const saved = admissionRepo.update(id, nextPatch, action.toLowerCase());
    if (!saved) throw new Error('This admission record no longer exists.');
    return saved;
  }

  function followUpPatch(app, followUpId) {
    const now = new Date().toISOString();
    return {
      followUps: app.followUps.map((item) => item.id === followUpId ? { ...item, completedAt: now, completedBy: 'School team' } : item),
      activity: [...app.activity, { id: uuid(), action: 'Follow-up completed', actor: 'School team', at: now, details: { followUpId } }],
    };
  }

  async function uploadAdmissionFile(app, file) {
    if (!file || !app) return;
    const invalid = remote
      ? file.size > 20 * 1024 * 1024 ? 'Files up to 20 MB are supported in cloud storage.' : null
      : validateUpload(file);
    if (invalid) { state.error = invalid; render(); return; }
    state.fileBusy = true;
    render();
    const id = uuid();
    const metadata = {
      id,
      name: file.name,
      fileName: file.name,
      category: 'admissions',
      description: `Admission document for ${nameOf(app)}`,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      relatedAdmissionId: app.id,
    };
    try {
      let document;
      if (remote) {
        if (!schoolId) throw new Error('The school storage location is unavailable. Refresh and try again.');
        document = await uploadRemoteDocument({ schoolId, file, metadata });
      } else {
        document = addDocument(metadata, await readFileAsDataUrl(file));
      }
      const item = {
        id: document.id,
        documentId: document.id,
        name: document.name,
        fileName: document.fileName,
        storagePath: document.storagePath,
        status: 'uploaded',
        uploadedAt: new Date().toISOString(),
      };
      await saveAdmission(app.id, { documents: [...app.documents, item] });
      state.error = '';
    } catch (error) { state.error = error.message; }
    state.fileBusy = false;
    render();
  }

  render();
}
