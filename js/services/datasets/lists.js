import { uuid } from '../../lib/uuid.js';
import {
  norm, text, isBlank, parseDate, cleanPhone, phoneKey, cleanEmail, looksLikeEmail, cleanGender, splitName, nameKey, splitList, cleanNumber, resolveClass,
} from '../importEngine.js';
import { createMany, updateOne, runLimited, DUPLICATE_OPTION, remote } from './context.js';
import { STAFF_CATEGORIES, teacherFullName } from '../peopleService.js';
import { ADMISSION_STATUS_LABELS, STAGES, legacyStageForStatus, normalizeAdmission } from '../admissionsService.js';
import { CATEGORIES as INVENTORY_CATEGORIES, CONDITIONS } from '../inventoryService.js';

const duplicateAction = (options) => (options.duplicates === 'update' ? 'update' : 'skip');
const finish = (item, existing, options, labelWhenSkipped = 'Already in the system — skipped.') => {
  if (!existing) return { ...item, action: 'create' };
  const action = duplicateAction(options);
  const messages = action === 'skip' ? [labelWhenSkipped, ...item.messages] : item.messages;
  return { ...item, action, status: item.status === 'error' ? 'error' : action === 'skip' ? 'skip' : item.status, messages, summary: `${item.summary}${action === 'update' ? ' · will update' : ''}`, plan: { ...item.plan, existingId: existing.id } };
};
const newItem = (row) => ({ rowNumber: row.rowNumber, status: 'ok', messages: [], summary: '', plan: {} });
const flag = (item) => ({
  warn: (m) => { item.messages.push(m); if (item.status === 'ok') item.status = 'warn'; },
  fail: (m) => { item.messages.push(m); item.status = 'error'; },
});
const byLabel = (pairs) => (value) => {
  const key = norm(value);
  if (!key) return null;
  return pairs.find(([k, label]) => norm(k) === key || norm(label) === key)?.[0] ?? null;
};

async function commitSimple(collection, noun, items, ctx, { patchFor, recordFor }) {
  const importable = items.filter((i) => i.status === 'ok' || i.status === 'warn');
  const creates = importable.filter((i) => i.action === 'create').map(recordFor);
  const updates = importable.filter((i) => i.action === 'update');
  await createMany(collection, creates, `imported ${creates.length} ${noun}`);
  await runLimited(updates, remote() ? 4 : 1, (item) => updateOne(collection, item.plan.existingId, patchFor(item), `updated ${noun} from import`));
  return { created: creates.length, updated: updates.length };
}

// ---------------------------------------------------------------- Staff
const STAFF_SYNONYMS = {
  teaching: ['teacher', 'teaching', 'tutor', 'lecturer'],
  administration: ['admin', 'administration', 'administrator', 'office', 'secretary', 'principal', 'deputy', 'headteacher', 'head'],
  finance: ['finance', 'accounts', 'accountant', 'bursar', 'accounting'],
  transport: ['transport', 'driver', 'conductor'],
  support: ['support', 'cook', 'cleaner', 'security', 'watchman', 'matron', 'groundsman', 'kitchen', 'librarian'],
};
const staffCategory = (value) => {
  const key = norm(value);
  if (!key) return null;
  const direct = byLabel(STAFF_CATEGORIES)(value);
  if (direct) return direct;
  return Object.entries(STAFF_SYNONYMS).find(([, words]) => words.some((w) => key.includes(w)))?.[0] ?? null;
};

export const STAFF_FIELDS = [
  { key: 'fullName', label: 'Full Name', aliases: ['name', 'names', 'staffname', 'employeename', 'nameofstaff', 'teachername'], example: 'Peter Kamau', hint: 'Use this OR First/Last name' },
  { key: 'firstName', label: 'First Name', aliases: ['first', 'givenname', 'fname'] },
  { key: 'lastName', label: 'Last Name', aliases: ['last', 'surname', 'lname'] },
  { key: 'phone', label: 'Phone', aliases: ['phoneno', 'phonenumber', 'mobile', 'tel', 'contact', 'telephone'], example: '0722111222' },
  { key: 'email', label: 'Email', aliases: ['emailaddress', 'mail'], example: 'peter@school.ac.ke' },
  { key: 'category', label: 'Category', aliases: ['role', 'type', 'position', 'designation', 'department', 'jobtitle', 'staffcategory'], example: 'Teaching' },
  { key: 'subjects', label: 'Subjects', aliases: ['subjectsteaching', 'subjectstaught', 'teachingsubjects'], example: 'Mathematics, Science' },
];

export const staff = {
  key: 'staff',
  label: 'Staff / teachers',
  description: 'Teachers and other staff with phone, email, category and the subjects they teach.',
  getFields: () => STAFF_FIELDS,
  options: [DUPLICATE_OPTION('staff member')],
  prepare(rows, ctx, options) {
    const idx = {
      email: new Map(ctx.teachers.filter((t) => t.email).map((t) => [String(t.email).toLowerCase(), t])),
      phone: new Map(ctx.teachers.filter((t) => phoneKey(t.phone)).map((t) => [phoneKey(t.phone), t])),
      name: new Map(ctx.teachers.map((t) => [nameKey(teacherFullName(t)), t])),
    };
    const seen = new Set();
    const items = rows.map((row) => {
      const v = row.values;
      const item = newItem(row);
      const { warn, fail } = flag(item);
      let firstName = text(v.firstName);
      let lastName = text(v.lastName);
      if (!isBlank(v.fullName) && (!firstName || !lastName)) {
        const s = splitName(v.fullName);
        firstName = firstName || s.firstName;
        lastName = lastName || [s.middleName, s.lastName].filter(Boolean).join(' ');
      }
      if (!firstName && !lastName) fail('Name is missing.');
      const phone = cleanPhone(v.phone);
      let email = cleanEmail(v.email);
      if (email && !looksLikeEmail(email)) { warn(`Email "${email}" looks invalid — ignored.`); email = ''; }

      let category = 'teaching';
      if (!isBlank(v.category)) {
        category = staffCategory(v.category);
        if (!category) { warn(`Category "${text(v.category)}" not recognised — set to Other.`); category = 'other'; }
      }
      const subjectIds = [];
      if (category === 'teaching' && !isBlank(v.subjects)) {
        splitList(v.subjects).forEach((name) => {
          const subject = ctx.subjects.find((s) => norm(s.name) === norm(name) || norm(s.code) === norm(name));
          if (subject) subjectIds.push(subject.id);
          else warn(`Subject "${name}" not found — skipped.`);
        });
      }
      const key = (email && `e:${email}`) || (phoneKey(phone) && `p:${phoneKey(phone)}`) || `n:${nameKey(`${firstName} ${lastName}`)}`;
      if (status(item) !== 'error') { if (seen.has(key)) fail('Repeated in this file.'); seen.add(key); }
      const existing = (email && idx.email.get(email)) || (phoneKey(phone) && idx.phone.get(phoneKey(phone))) || idx.name.get(nameKey(`${firstName} ${lastName}`));
      item.summary = `${`${firstName} ${lastName}`.trim() || '—'} · ${STAFF_CATEGORIES.find(([k]) => k === category)?.[1] ?? category}`;
      item.plan = { fields: { firstName, lastName, phone: phone || undefined, email: email || undefined, category, subjectIds, classIds: [], isActive: true }, touched: { phone: !!phone, email: !!email, category: !isBlank(v.category), subjects: subjectIds.length > 0 } };
      return finish(item, existing, options);
    });
    return { items };
  },
  commit: (items, ctx, options) => commitSimple('teachers', 'staff', items, ctx, {
    recordFor: (i) => i.plan.fields,
    patchFor: (i) => {
      const { fields, touched } = i.plan;
      const patch = { firstName: fields.firstName, lastName: fields.lastName };
      if (touched.phone) patch.phone = fields.phone;
      if (touched.email) patch.email = fields.email;
      if (touched.category) patch.category = fields.category;
      if (touched.subjects) patch.subjectIds = fields.subjectIds;
      return patch;
    },
  }),
  export(ctx) {
    const subjectById = Object.fromEntries(ctx.subjects.map((s) => [s.id, s.name]));
    const list = [...ctx.teachers].sort((a, b) => teacherFullName(a).localeCompare(teacherFullName(b)));
    return {
      sheets: [{ name: 'Staff', rows: [['First Name', 'Last Name', 'Phone', 'Email', 'Category', 'Subjects'], ...list.map((t) => [t.firstName, t.lastName, t.phone ?? '', t.email ?? '', STAFF_CATEGORIES.find(([k]) => k === t.category)?.[1] ?? t.category ?? '', (t.subjectIds ?? []).map((id) => subjectById[id]).filter(Boolean).join(', ')])] }],
      fileName: 'staff', count: list.length,
    };
  },
  template: () => ({
    sheets: [
      { name: 'Staff', rows: [['First Name', 'Last Name', 'Phone', 'Email', 'Category', 'Subjects'], ['Peter', 'Kamau', '0722111222', 'peter@school.ac.ke', 'Teaching', 'Mathematics, Science']] },
      { name: 'Instructions', rows: [['One row per staff member. Category can be Teaching, Administration, Finance, Support or Transport.'], ['Subjects must match subjects already created under Academics (only used for teachers).']] },
    ],
    fileName: 'staff-template',
  }),
};
const status = (item) => item.status;

// ---------------------------------------------------------------- Admissions
const ADMISSION_STAGES = STAGES.filter(([k]) => k !== 'admitted');
const WORKFLOW_STATUSES = Object.entries(ADMISSION_STATUS_LABELS);
const workflowStatusOf = byLabel(WORKFLOW_STATUSES);
const legacyStatusOf = (stage) => ({ enquiry: 'enquiry', application: 'draft', approved: 'approved', admitted: 'approved', rejected: 'rejected' }[stage] ?? 'enquiry');
export const ADMISSION_FIELDS = [
  { key: 'childName', label: 'Child Name', aliases: ['child', 'name', 'names', 'applicant', 'applicantname', 'studentname', 'pupilname', 'learnername', 'fullname'], example: 'Peter Kamau' },
  { key: 'dateOfBirth', label: 'Date of Birth', aliases: ['dob', 'birthdate', 'birthday'], example: '2019-05-02' },
  { key: 'gender', label: 'Gender', aliases: ['sex'], example: 'Male' },
  { key: 'classInterested', label: 'Class Applying For', aliases: ['class', 'grade', 'classinterested', 'applyingfor', 'classapplyingfor', 'gradeapplyingfor'], example: 'Grade 1' },
  { key: 'parentName', label: 'Parent/Guardian Name', aliases: ['parent', 'guardian', 'guardianname', 'parentguardian', 'nameofparent'], example: 'Mary Kamau' },
  { key: 'phone', label: 'Phone', aliases: ['phoneno', 'phonenumber', 'mobile', 'contact', 'tel', 'parentphone', 'telephone'], example: '0733222111' },
  { key: 'email', label: 'Email', aliases: ['emailaddress', 'parentemail'], example: '' },
  { key: 'stage', label: 'Legacy Stage', aliases: ['stage', 'admissionstage', 'legacystage'], example: 'Enquiry' },
  { key: 'status', label: 'Workflow Status', aliases: ['status', 'workflowstatus', 'admissionstatus', 'applicationstatus'], example: 'New enquiry' },
  { key: 'notes', label: 'Notes', aliases: ['comments', 'remarks', 'note'], example: '' },
];

export const admissions = {
  key: 'admissions',
  label: 'Admissions / applicants',
  description: 'Enquiries and applications from your admissions register, with their stage in the pipeline.',
  getFields: () => ADMISSION_FIELDS,
  options: [
    { key: 'defaultStage', type: 'select', label: 'Stage for rows without a stage', choices: ADMISSION_STAGES.map(([k, l]) => [k, l]), default: 'enquiry' },
    DUPLICATE_OPTION('applicant'),
  ],
  prepare(rows, ctx, options) {
    const keyOf = (name, dob) => `${nameKey(name)}|${dob ?? ''}`;
    const existing = new Map(ctx.admissions.map((a) => [keyOf(a.childName, a.dateOfBirth), a]));
    const stageOf = byLabel(STAGES);
    const seen = new Set();
    const items = rows.map((row) => {
      const v = row.values;
      const item = newItem(row);
      const { warn, fail } = flag(item);
      const childName = text(v.childName);
      if (!childName) fail('Child name is missing.');
      const dateOfBirth = isBlank(v.dateOfBirth) ? undefined : parseDate(v.dateOfBirth) ?? undefined;
      if (!isBlank(v.dateOfBirth) && !dateOfBirth) warn(`Date of birth "${text(v.dateOfBirth)}" not understood — left blank.`);
      const gender = cleanGender(v.gender);
      if (gender === null) warn(`Gender "${text(v.gender)}" not recognised — left blank.`);
      let classInterested;
      if (!isBlank(v.classInterested)) {
        const found = resolveClass(v.classInterested, ctx.classes);
        if (found) classInterested = found.class.id; else warn(`Class "${text(v.classInterested)}" not found — left blank.`);
      }
      let stage = options.defaultStage || 'enquiry';
      let workflowStatus = legacyStatusOf(stage);
      if (!isBlank(v.stage)) {
        const parsedStage = stageOf(v.stage);
        if (!parsedStage) warn(`Legacy stage "${text(v.stage)}" not recognised — using ${stage}.`);
        else if (parsedStage === 'admitted') { stage = 'approved'; workflowStatus = 'approved'; warn('"Admitted" children belong in Students — imported as Approved.'); }
        else { stage = parsedStage; workflowStatus = legacyStatusOf(parsedStage); }
      }
      if (!isBlank(v.status)) {
        const parsedStatus = workflowStatusOf(v.status);
        if (!parsedStatus) warn(`Workflow status "${text(v.status)}" not recognised — using ${ADMISSION_STATUS_LABELS[workflowStatus]}.`);
        else if (parsedStatus === 'admitted') { workflowStatus = 'approved'; stage = 'approved'; warn('"Admitted" children belong in Students — imported as Approved.'); }
        else { workflowStatus = parsedStatus; stage = legacyStageForStatus(parsedStatus); }
      }
      let email = cleanEmail(v.email);
      if (email && !looksLikeEmail(email)) { warn(`Email "${email}" looks invalid — ignored.`); email = ''; }
      const key = keyOf(childName, dateOfBirth);
      if (item.status !== 'error') { if (seen.has(key)) fail('Repeated in this file.'); seen.add(key); }
      item.summary = `${childName || '—'} · ${ADMISSION_STATUS_LABELS[workflowStatus]}${classInterested ? ` · ${ctx.classes.find((c) => c.id === classInterested)?.name}` : ''}`;
      item.plan = { fields: { childName, dateOfBirth, gender: gender || undefined, classInterested, parentName: text(v.parentName) || undefined, phone: cleanPhone(v.phone) || undefined, email: email || undefined, notes: text(v.notes) || undefined, documents: [], status: workflowStatus, stage } };
      return finish(item, existing.get(key), options);
    });
    return { items };
  },
  commit: (items, ctx, options) => commitSimple('admissions', 'applicants', items, ctx, {
    recordFor: (i) => i.plan.fields,
    patchFor: (i) => Object.fromEntries(Object.entries(i.plan.fields).filter(([k, val]) => val !== undefined && k !== 'documents')),
  }),
  export(ctx) {
    const classById = Object.fromEntries(ctx.classes.map((c) => [c.id, c.name]));
    const list = [...ctx.admissions].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return {
      sheets: [{ name: 'Admissions', rows: [ADMISSION_FIELDS.map((f) => f.label), ...list.map((record) => {
        const admission = normalizeAdmission(record);
        return [admission.childName, admission.dateOfBirth ?? '', admission.gender ? (admission.gender === 'male' ? 'Male' : admission.gender === 'female' ? 'Female' : admission.gender) : '', classById[admission.classInterested] ?? '', admission.parentName ?? '', admission.phone ?? '', admission.email ?? '', STAGES.find(([key]) => key === admission.stage)?.[1] ?? admission.stage ?? '', ADMISSION_STATUS_LABELS[admission.status] ?? admission.status, admission.notes ?? ''];
      })] }],
      fileName: 'admissions', count: list.length,
    };
  },
  template: () => ({
    sheets: [
      { name: 'Admissions', rows: [ADMISSION_FIELDS.map((f) => f.label), ADMISSION_FIELDS.map((f) => f.example ?? '')] },
      { name: 'Instructions', rows: [['One row per applicant. Workflow Status accepts statuses such as New enquiry, Draft application, Submitted, Under review, Approved, Offer sent, or Offer accepted. Legacy Stage remains supported.'], ['Children already admitted should be imported under Students instead; admitted imports are safely downgraded to Approved.']] },
    ],
    fileName: 'admissions-template',
  }),
};

// ---------------------------------------------------------------- Subjects
export const SUBJECT_FIELDS = [
  { key: 'name', label: 'Subject', aliases: ['subjectname', 'name', 'subjects'], example: 'Mathematics' },
  { key: 'code', label: 'Code', aliases: ['subjectcode', 'abbr', 'abbreviation', 'short'], example: 'MAT' },
  { key: 'grades', label: 'Grades', aliases: ['classes', 'class', 'grade', 'taughtin', 'levels', 'forms', 'gradesclasses'], example: 'Grade 1, Grade 2', hint: 'Which grades take this subject. "All" = every grade.' },
];

export const subjects = {
  key: 'subjects',
  label: 'Subjects',
  description: 'Your subject list and which grades take each subject (so report cards only show a grade’s own subjects).',
  getFields: () => SUBJECT_FIELDS,
  options: [{ key: 'duplicates', type: 'select', label: 'If a subject already exists', choices: [['update', 'Add the grades from the file to it'], ['skip', 'Skip it']], default: 'update' }],
  prepare(rows, ctx, options) {
    const existing = new Map();
    ctx.subjects.forEach((s) => { existing.set(norm(s.name), s); if (s.code) existing.set(`c:${norm(s.code)}`, s); });
    const seen = new Set();
    const items = rows.map((row) => {
      const v = row.values;
      const item = newItem(row);
      const { warn, fail } = flag(item);
      const name = text(v.name);
      if (!name) fail('Subject name is missing.');
      const code = (text(v.code) || name.slice(0, 3)).toUpperCase();
      const classIds = [];
      splitList(v.grades).forEach((g) => {
        if (['all', 'allgrades', 'allclasses', 'everyone'].includes(norm(g))) ctx.classes.forEach((c) => classIds.push(c.id));
        else {
          const found = resolveClass(g, ctx.classes);
          if (found) classIds.push(found.class.id); else warn(`Grade "${g}" not found — skipped.`);
        }
      });
      const key = norm(name);
      if (item.status !== 'error') { if (seen.has(key)) fail('Repeated in this file.'); seen.add(key); }
      const found = existing.get(key) ?? existing.get(`c:${norm(code)}`);
      item.summary = `${name || '—'} (${code}) · ${classIds.length ? classIds.map((id) => ctx.classes.find((c) => c.id === id)?.name).join(', ') : 'no grades'}`;
      item.plan = { fields: { name, code, classIds: [...new Set(classIds)], teacherIds: [] }, existingClassIds: found?.classIds ?? [] };
      return finish(item, found, options, 'Subject already exists — skipped.');
    });
    return { items };
  },
  commit: (items, ctx, options) => commitSimple('subjects', 'subjects', items, ctx, {
    recordFor: (i) => i.plan.fields,
    patchFor: (i) => ({ classIds: [...new Set([...i.plan.existingClassIds, ...i.plan.fields.classIds])] }),
  }),
  export(ctx) {
    const classById = Object.fromEntries(ctx.classes.map((c) => [c.id, c]));
    const list = [...ctx.subjects].sort((a, b) => a.name.localeCompare(b.name));
    return {
      sheets: [{ name: 'Subjects', rows: [['Subject', 'Code', 'Grades'], ...list.map((s) => [s.name, s.code ?? '', (s.classIds ?? []).map((id) => classById[id]).filter(Boolean).sort((a, b) => a.order - b.order).map((c) => c.name).join(', ')])] }],
      fileName: 'subjects', count: list.length,
    };
  },
  template: () => ({
    sheets: [
      { name: 'Subjects', rows: [['Subject', 'Code', 'Grades'], ['Mathematics', 'MAT', 'Grade 1, Grade 2, Grade 3'], ['Science', 'SCI', 'All']] },
      { name: 'Instructions', rows: [['List each subject once. Grades is a comma-separated list of the grades that take it, or "All".'], ['Grade names must match your classes (e.g. Grade 1).']] },
    ],
    fileName: 'subjects-template',
  }),
};

// ---------------------------------------------------------------- Classes
export const CLASS_FIELDS = [
  { key: 'name', label: 'Class', aliases: ['classname', 'grade', 'form', 'name', 'level'], example: 'Grade 1' },
  { key: 'streams', label: 'Streams', aliases: ['stream', 'streamnames', 'sections'], example: 'A, B' },
];
export const classes = {
  key: 'classes',
  label: 'Classes & streams',
  description: 'Set up your grades/classes and their streams in one go.',
  getFields: () => CLASS_FIELDS,
  options: [],
  prepare(rows, ctx) {
    const existing = new Map(ctx.classes.map((c) => [norm(c.name), c]));
    const seen = new Set();
    let order = Math.max(0, ...ctx.classes.map((c) => c.order ?? 0));
    const items = rows.map((row) => {
      const v = row.values;
      const item = newItem(row);
      const { fail } = flag(item);
      const name = text(v.name);
      if (!name) fail('Class name is missing.');
      const streams = [...new Set(splitList(v.streams))];
      const key = norm(name);
      if (item.status !== 'error') { if (seen.has(key)) fail('Repeated in this file.'); seen.add(key); }
      const found = existing.get(key);
      let action = 'create';
      let newStreams = streams;
      if (found) {
        newStreams = streams.filter((s) => !ctx.streams.some((st) => st.classId === found.id && norm(st.name) === norm(s)));
        action = newStreams.length ? 'update' : 'skip';
      } else order += 1;
      if (action === 'skip' && item.status !== 'error') { item.status = 'skip'; item.messages.push('Already in the system — nothing new to add.'); }
      item.summary = `${name || '—'}${newStreams.length ? ` · streams: ${newStreams.join(', ')}` : ''}${action === 'update' ? ' · adds streams' : ''}`;
      item.plan = { name, order: found?.order ?? order, streams: newStreams, existingId: found?.id };
      item.action = action;
      return item;
    });
    return { items };
  },
  async commit(items) {
    const importable = items.filter((i) => (i.status === 'ok' || i.status === 'warn') && i.action !== 'skip');
    const newClasses = importable.filter((i) => i.action === 'create').map((i) => ({ id: uuid(), name: i.plan.name, order: i.plan.order }));
    const classIdFor = (item) => item.plan.existingId ?? newClasses.find((c) => c.name === item.plan.name)?.id;
    const streams = importable.flatMap((i) => i.plan.streams.map((name) => ({ classId: classIdFor(i), name })));
    await createMany('classes', newClasses, 'imported classes');
    await createMany('streams', streams, 'imported streams');
    return { created: newClasses.length, updated: importable.filter((i) => i.action === 'update').length, streams: streams.length };
  },
  export(ctx) {
    const list = [...ctx.classes].sort((a, b) => a.order - b.order);
    return {
      sheets: [{ name: 'Classes', rows: [['Class', 'Streams', 'Students'], ...list.map((c) => [c.name, ctx.streams.filter((s) => s.classId === c.id).map((s) => s.name).join(', '), ctx.students.filter((s) => s.classId === c.id && s.status === 'active').length])] }],
      fileName: 'classes', count: list.length,
    };
  },
  template: () => ({
    sheets: [{ name: 'Classes', rows: [['Class', 'Streams'], ['Grade 1', 'A, B'], ['Grade 2', 'A, B'], ['Grade 3', '']] }, { name: 'Instructions', rows: [['One row per class. Streams is a comma-separated list (leave blank if the class has no streams).']] }],
    fileName: 'classes-template',
  }),
};

// ---------------------------------------------------------------- Library
export const BOOK_FIELDS = [
  { key: 'title', label: 'Title', aliases: ['booktitle', 'name', 'book'], example: 'Oliver Twist' },
  { key: 'author', label: 'Author', aliases: ['writer', 'authorname'], example: 'Charles Dickens' },
  { key: 'category', label: 'Category', aliases: ['subject', 'genre', 'type'], example: 'Fiction' },
  { key: 'isbn', label: 'ISBN', aliases: ['isbnno', 'isbnnumber', 'bookno', 'accessionno'], example: '9780141439747' },
  { key: 'totalCopies', label: 'Copies', aliases: ['totalcopies', 'quantity', 'qty', 'number', 'noofcopies', 'count'], example: '3' },
];
export const library = {
  key: 'library',
  label: 'Library books',
  description: 'Your book catalogue with authors, ISBNs and number of copies.',
  getFields: () => BOOK_FIELDS,
  options: [DUPLICATE_OPTION('book')],
  prepare(rows, ctx, options) {
    const keyOf = (b) => (norm(b.isbn) ? `i:${norm(b.isbn)}` : `t:${norm(b.title)}|${norm(b.author)}`);
    const existing = new Map(ctx.libraryBooks.map((b) => [keyOf(b), b]));
    const seen = new Set();
    const items = rows.map((row) => {
      const v = row.values;
      const item = newItem(row);
      const { warn, fail } = flag(item);
      const title = text(v.title);
      if (!title) fail('Title is missing.');
      let author = text(v.author);
      if (!author) { author = 'Unknown'; if (title) warn('No author — set to "Unknown".'); }
      let copies = 1;
      if (!isBlank(v.totalCopies)) {
        const n = cleanNumber(v.totalCopies);
        if (n === null || n < 1 || !Number.isInteger(n)) warn(`Copies "${text(v.totalCopies)}" is not a whole number — using 1.`);
        else copies = n;
      }
      const isbn = typeof v.isbn === 'number' ? String(Math.round(v.isbn)) : text(v.isbn);
      const fields = { title, author, category: text(v.category) || undefined, isbn: isbn || undefined, totalCopies: copies };
      const key = keyOf(fields);
      if (item.status !== 'error') { if (seen.has(key)) fail('Repeated in this file.'); seen.add(key); }
      item.summary = `${title || '—'} — ${author} · ${copies} cop${copies === 1 ? 'y' : 'ies'}`;
      item.plan = { fields };
      return finish(item, existing.get(key), options);
    });
    return { items };
  },
  commit: (items, ctx, options) => commitSimple('libraryBooks', 'books', items, ctx, {
    recordFor: (i) => i.plan.fields,
    patchFor: (i) => ({ totalCopies: i.plan.fields.totalCopies, category: i.plan.fields.category, author: i.plan.fields.author }),
  }),
  export(ctx) {
    const list = [...ctx.libraryBooks].sort((a, b) => a.title.localeCompare(b.title));
    return { sheets: [{ name: 'Books', rows: [BOOK_FIELDS.map((f) => f.label), ...list.map((b) => [b.title, b.author, b.category ?? '', b.isbn ?? '', b.totalCopies])] }], fileName: 'library-books', count: list.length };
  },
  template: () => ({ sheets: [{ name: 'Books', rows: [BOOK_FIELDS.map((f) => f.label), BOOK_FIELDS.map((f) => f.example)] }, { name: 'Instructions', rows: [['One row per book title. Copies = how many physical copies the library holds.']] }], fileName: 'library-template' }),
};

// ---------------------------------------------------------------- Inventory
export const ITEM_FIELDS = [
  { key: 'name', label: 'Item', aliases: ['itemname', 'name', 'description', 'asset', 'item'], example: 'Plastic chairs' },
  { key: 'category', label: 'Category', aliases: ['type', 'group'], example: 'Furniture' },
  { key: 'quantity', label: 'Quantity', aliases: ['qty', 'number', 'count', 'quantityinstock', 'stock'], example: '120' },
  { key: 'location', label: 'Location', aliases: ['room', 'store', 'place', 'kept'], example: 'Store room' },
  { key: 'condition', label: 'Condition', aliases: ['state', 'status'], example: 'Good' },
];
export const inventory = {
  key: 'inventory',
  label: 'Inventory / assets',
  description: 'Furniture, equipment and supplies with quantities and where they are kept.',
  getFields: () => ITEM_FIELDS,
  options: [DUPLICATE_OPTION('item')],
  prepare(rows, ctx, options) {
    const keyOf = (i) => `${norm(i.name)}|${norm(i.location)}`;
    const existing = new Map(ctx.inventory.map((i) => [keyOf(i), i]));
    const category = byLabel(INVENTORY_CATEGORIES);
    const condition = byLabel(CONDITIONS);
    const seen = new Set();
    const items = rows.map((row) => {
      const v = row.values;
      const item = newItem(row);
      const { warn, fail } = flag(item);
      const name = text(v.name);
      if (!name) fail('Item name is missing.');
      let quantity = 1;
      if (!isBlank(v.quantity)) {
        const n = cleanNumber(v.quantity);
        if (n === null || n < 0 || !Number.isInteger(n)) fail(`Quantity "${text(v.quantity)}" is not a whole number.`);
        else quantity = n;
      }
      let cat = 'other';
      if (!isBlank(v.category)) { cat = category(v.category); if (!cat) { warn(`Category "${text(v.category)}" not recognised — set to Other.`); cat = 'other'; } }
      let cond = 'good';
      if (!isBlank(v.condition)) { cond = condition(v.condition); if (!cond) { warn(`Condition "${text(v.condition)}" not recognised — set to Good.`); cond = 'good'; } }
      const fields = { name, category: cat, quantity, location: text(v.location) || undefined, condition: cond };
      const key = keyOf(fields);
      if (item.status !== 'error') { if (seen.has(key)) fail('Repeated in this file (same item and location).'); seen.add(key); }
      item.summary = `${name || '—'} × ${quantity}${fields.location ? ` · ${fields.location}` : ''}`;
      item.plan = { fields };
      return finish(item, existing.get(key), options);
    });
    return { items };
  },
  commit: (items, ctx, options) => commitSimple('inventory', 'items', items, ctx, {
    recordFor: (i) => i.plan.fields,
    patchFor: (i) => ({ quantity: i.plan.fields.quantity, category: i.plan.fields.category, condition: i.plan.fields.condition }),
  }),
  export(ctx) {
    const list = [...ctx.inventory].sort((a, b) => a.name.localeCompare(b.name));
    return { sheets: [{ name: 'Inventory', rows: [ITEM_FIELDS.map((f) => f.label), ...list.map((i) => [i.name, INVENTORY_CATEGORIES.find(([k]) => k === i.category)?.[1] ?? i.category ?? '', i.quantity, i.location ?? '', CONDITIONS.find(([k]) => k === i.condition)?.[1] ?? i.condition ?? ''])] }], fileName: 'inventory', count: list.length };
  },
  template: () => ({ sheets: [{ name: 'Inventory', rows: [ITEM_FIELDS.map((f) => f.label), ITEM_FIELDS.map((f) => f.example)] }, { name: 'Instructions', rows: [['Category: Furniture, Electronics, Books & stationery, Sports equipment, Lab equipment, Kitchen & catering or Other.'], ['Condition: New, Good, Fair, Poor or Damaged.']] }], fileName: 'inventory-template' }),
};
