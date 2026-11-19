import { uuid } from '../../lib/uuid.js';
import {
  norm, text, isBlank, parseDate, cleanPhone, phoneKey, cleanEmail, looksLikeEmail, cleanGender, cleanAdmission, splitName, nameKey,
} from '../importEngine.js';
import { createMany, updateOne, runLimited, makeClassResolver, DUPLICATE_OPTION, remote } from './context.js';
import { fullName } from '../studentService.js';
import { parentFullName } from '../peopleService.js';

const today = () => new Date().toISOString().slice(0, 10);

export const STUDENT_FIELDS = [
  { key: 'admissionNumber', label: 'Admission No', aliases: ['admno', 'adm', 'admission', 'admissionnumber', 'admissionno', 'regno', 'registrationnumber', 'studentid', 'pupilid', 'upi'], example: 'A001' },
  { key: 'fullName', label: 'Full Name', aliases: ['name', 'names', 'studentname', 'pupilname', 'learnername', 'nameofstudent', 'nameofpupil'], example: 'Amani Wanjiru Otieno', hint: 'Use this OR First/Last name' },
  { key: 'firstName', label: 'First Name', aliases: ['first', 'givenname', 'forename', 'fname', 'firstnames'], example: '' },
  { key: 'middleName', label: 'Middle Name', aliases: ['middle', 'othernames', 'othername'], example: '' },
  { key: 'lastName', label: 'Last Name', aliases: ['last', 'surname', 'familyname', 'lname'], example: '' },
  { key: 'gender', label: 'Gender', aliases: ['sex', 'mf'], example: 'Female' },
  { key: 'dateOfBirth', label: 'Date of Birth', aliases: ['dob', 'birthdate', 'birthday', 'dateofbirth', 'born'], example: '2016-03-12' },
  { key: 'class', label: 'Class', aliases: ['grade', 'form', 'std', 'standard', 'level', 'classname', 'currentclass', 'gradeclass'], example: 'Grade 1' },
  { key: 'stream', label: 'Stream', aliases: ['streamname', 'section', 'house'], example: 'A' },
  { key: 'admissionDate', label: 'Admission Date', aliases: ['dateadmitted', 'dateofadmission', 'joined', 'datejoined', 'admitted'], example: '2024-01-08' },
  { key: 'boarding', label: 'Boarding Status', aliases: ['boardingstatus', 'boarding', 'dayboarding', 'dayorboarding', 'residence'], example: 'Day' },
  { key: 'parentName', label: 'Parent/Guardian Name', aliases: ['parent', 'guardian', 'guardianname', 'parentguardian', 'nameofparent', 'parentsname', 'fathername', 'mothername', 'nextofkin'], example: 'Jane Otieno' },
  { key: 'parentPhone', label: 'Parent Phone', aliases: ['phone', 'phoneno', 'phonenumber', 'contact', 'tel', 'mobile', 'parentcontact', 'guardianphone', 'parentmobile', 'parentphoneno', 'telephone'], example: '0712345678' },
  { key: 'parentEmail', label: 'Parent Email', aliases: ['email', 'parentemail', 'guardianemail', 'emailaddress'], example: 'jane@example.com' },
];

export const students = {
  key: 'students',
  label: 'Students',
  description: 'Learners with their class, parent contacts and details. Import a whole school or just one class.',
  getFields: () => STUDENT_FIELDS,
  options: [
    { key: 'classId', type: 'class', label: 'Put every student in this class (optional)', optional: true, help: 'Handy when the file is for one class and has no Class column.' },
    { key: 'createMissing', type: 'checkbox', label: 'Create classes and streams that don’t exist yet', default: true },
    DUPLICATE_OPTION('student'),
    { key: 'autoAdm', type: 'checkbox', label: 'Generate admission numbers when a row has none', default: false },
  ],

  prepare(rows, ctx, options) {
    const resolver = makeClassResolver(ctx, { createMissing: options.createMissing });
    const chosenClass = options.classId ? ctx.classes.find((c) => c.id === options.classId) : null;
    const existing = new Map(ctx.students.map((s) => [norm(s.admissionNumber), s]));
    const seen = new Map();

    const existingParents = {
      byPhone: new Map(ctx.parents.filter((p) => phoneKey(p.phone)).map((p) => [phoneKey(p.phone), p])),
      byEmail: new Map(ctx.parents.filter((p) => p.email).map((p) => [String(p.email).toLowerCase(), p])),
      byName: new Map(ctx.parents.map((p) => [nameKey(parentFullName(p)), p])),
    };

    const numeric = [...ctx.students.map((s) => s.admissionNumber), ...rows.map((r) => cleanAdmission(r.values.admissionNumber))]
      .map((a) => Number((String(a).match(/(\d+)\s*$/) ?? [])[1])).filter(Number.isFinite);
    let nextAdm = Math.max(0, ...numeric) + 1;

    const items = rows.map((row) => {
      const v = row.values;
      const messages = [];
      let status = 'ok';
      const warn = (m) => { messages.push(m); if (status === 'ok') status = 'warn'; };
      const fail = (m) => { messages.push(m); status = 'error'; };

      // Name
      let { firstName, middleName, lastName } = { firstName: text(v.firstName), middleName: text(v.middleName), lastName: text(v.lastName) };
      if (!isBlank(v.fullName) && (!firstName || !lastName)) {
        const split = splitName(v.fullName);
        firstName = firstName || split.firstName;
        middleName = middleName || split.middleName;
        lastName = lastName || split.lastName;
      }
      if (!firstName && !lastName) fail('Name is missing.');
      else if (!lastName) warn('Only one name found — last name left blank.');

      // Admission number
      let admissionNumber = cleanAdmission(v.admissionNumber);
      if (!admissionNumber) {
        if (options.autoAdm) { admissionNumber = String(nextAdm); nextAdm += 1; warn(`Admission number ${admissionNumber} generated.`); }
        else fail('Admission number is missing.');
      }
      const key = norm(admissionNumber);
      if (key) {
        if (seen.has(key)) fail(`Admission number ${admissionNumber} is repeated in this file (row ${seen.get(key)}).`);
        else seen.set(key, row.rowNumber);
      }
      const current = key ? existing.get(key) : undefined;

      // Gender / DOB / dates
      const gender = cleanGender(v.gender);
      if (gender === null) warn(`Gender "${text(v.gender)}" not recognised — left blank.`);
      let dateOfBirth;
      if (!isBlank(v.dateOfBirth)) {
        dateOfBirth = parseDate(v.dateOfBirth) ?? undefined;
        if (!dateOfBirth) warn(`Date of birth "${text(v.dateOfBirth)}" not understood — left blank.`);
      }
      let admissionDate = parseDate(v.admissionDate);
      if (!isBlank(v.admissionDate) && !admissionDate) warn(`Admission date "${text(v.admissionDate)}" not understood — using today.`);
      admissionDate ||= today();

      // Class + stream
      let target = null;
      const classText = chosenClass ? chosenClass.name : text(v.class);
      if (!classText) {
        if (!current) fail('Class is missing — add a Class column or choose a class above.');
      } else {
        target = resolver.resolve(chosenClass ? chosenClass.name : v.class, v.stream);
        if (!target) fail(`Class "${classText}" not found.`);
        else {
          if (target.created) warn(`Class "${target.class.name}" will be created.`);
          if (target.streamCreated) warn(`Stream "${target.stream.name}" will be created.`);
          if (target.streamMissing) warn(`Stream "${target.streamMissing}" not found — left blank.`);
        }
      }

      // Parent
      let parentRef = null;
      const parentName = text(v.parentName);
      const phone = cleanPhone(v.parentPhone);
      let email = cleanEmail(v.parentEmail);
      if (email && !looksLikeEmail(email)) { warn(`Email "${email}" looks invalid — ignored.`); email = ''; }
      if (parentName || phone || email) {
        const found = (phoneKey(phone) && existingParents.byPhone.get(phoneKey(phone)))
          || (email && existingParents.byEmail.get(email))
          || (!phone && !email && existingParents.byName.get(nameKey(parentName)));
        if (found) parentRef = { existingId: found.id };
        else {
          const split = splitName(parentName || `Parent of ${firstName} ${lastName}`.trim());
          parentRef = {
            newKey: phoneKey(phone) || email || nameKey(parentName),
            data: { firstName: split.firstName, lastName: [split.middleName, split.lastName].filter(Boolean).join(' '), phone: phone || undefined, email: email || undefined },
          };
        }
      }

      const boardingText = norm(v.boarding);
      const boardingStatus = boardingText ? (boardingText.includes('board') && !boardingText.startsWith('day') ? 'boarding' : 'day') : undefined;

      const display = [firstName, middleName, lastName].filter(Boolean).join(' ');
      const place = target ? [target.class.name, target.stream?.name].filter(Boolean).join(' ') : current ? '(class unchanged)' : '';
      let action = 'create';
      if (current) {
        if (options.duplicates === 'update') action = 'update';
        else { action = 'skip'; if (status !== 'error') status = 'skip'; messages.unshift('Already in the system — skipped.'); }
      }

      return {
        rowNumber: row.rowNumber,
        status,
        messages,
        action,
        summary: `${display || '—'} · ${admissionNumber || 'no adm no'}${place ? ` · ${place}` : ''}${action === 'update' ? ' · will update' : ''}`,
        plan: {
          existingId: current?.id,
          parentRef,
          fields: { admissionNumber, firstName, middleName: middleName || undefined, lastName, gender: gender || undefined, dateOfBirth, boardingStatus, house: undefined, admissionDate },
          classId: target?.class.id,
          streamId: target?.stream?.id,
          hasClassInput: Boolean(classText),
          hasStreamInput: Boolean(text(v.stream) || target?.stream),
          touched: { gender: !isBlank(v.gender), dateOfBirth: !isBlank(v.dateOfBirth), admissionDate: !isBlank(v.admissionDate), boarding: !isBlank(v.boarding) },
        },
      };
    });
    return { items, resolver };
  },

  async commit(items, ctx, options, progress, extra) {
    const { resolver } = extra;
    const importable = items.filter((i) => (i.status === 'ok' || i.status === 'warn') && i.action !== 'skip');
    const creates = importable.filter((i) => i.action === 'create');
    const updates = importable.filter((i) => i.action === 'update');
    const result = { created: 0, updated: 0, classes: 0, streams: 0, parents: 0 };

    progress?.(0, importable.length, 'Preparing classes…');
    const usedClasses = new Set(importable.map((i) => i.plan.classId).filter(Boolean));
    const usedStreams = new Set(importable.map((i) => i.plan.streamId).filter(Boolean));
    Object.assign(result, await resolver.commit(usedClasses, usedStreams));

    // Parents: one record per phone/email/name, shared by siblings.
    const newParents = new Map();
    const parentIdFor = (item, studentId) => {
      const ref = item.plan.parentRef;
      if (!ref) return null;
      if (ref.existingId) return ref.existingId;
      if (!newParents.has(ref.newKey)) newParents.set(ref.newKey, { id: uuid(), ...ref.data, studentIds: [] });
      newParents.get(ref.newKey).studentIds.push(studentId);
      return newParents.get(ref.newKey).id;
    };
    const linkExisting = new Map();

    const studentRecords = creates.map((item) => {
      const id = uuid();
      const parentId = parentIdFor(item, id);
      if (parentId && item.plan.parentRef.existingId) linkExisting.set(parentId, [...(linkExisting.get(parentId) ?? []), id]);
      const { fields } = item.plan;
      return {
        id, ...fields, classId: item.plan.classId, streamId: item.plan.streamId,
        boardingStatus: fields.boardingStatus ?? 'day', usesTransport: false,
        parentIds: parentId ? [parentId] : [], status: 'active',
      };
    });

    // Plan updates to existing students first, so any new parents they need are known
    // before parents are saved.
    const currentById = new Map(ctx.students.map((s) => [s.id, s]));
    const updatePlans = updates.map((item) => {
      const { fields, touched } = item.plan;
      const patch = {};
      ['firstName', 'lastName', 'middleName'].forEach((k) => { if (fields[k]) patch[k] = fields[k]; });
      if (touched.gender && fields.gender) patch.gender = fields.gender;
      if (touched.dateOfBirth && fields.dateOfBirth) patch.dateOfBirth = fields.dateOfBirth;
      if (touched.admissionDate) patch.admissionDate = fields.admissionDate;
      if (touched.boarding && fields.boardingStatus) patch.boardingStatus = fields.boardingStatus;
      if (item.plan.hasClassInput && item.plan.classId) {
        patch.classId = item.plan.classId;
        if (item.plan.hasStreamInput) patch.streamId = item.plan.streamId;
      }
      const parentId = parentIdFor(item, item.plan.existingId);
      if (parentId) {
        patch.parentIds = [...new Set([...(currentById.get(item.plan.existingId)?.parentIds ?? []), parentId])];
        if (item.plan.parentRef.existingId) linkExisting.set(parentId, [...(linkExisting.get(parentId) ?? []), item.plan.existingId]);
      }
      return { id: item.plan.existingId, patch };
    });

    progress?.(0, importable.length, 'Saving students…');
    await createMany('students', studentRecords, `imported ${studentRecords.length} students`);
    result.created = studentRecords.length;

    await createMany('parents', [...newParents.values()], `imported ${newParents.size} parents`);
    result.parents = newParents.size;

    const existingParents = new Map(ctx.parents.map((p) => [p.id, p]));
    await runLimited([...linkExisting], 4, async ([parentId, studentIds]) => {
      const parent = existingParents.get(parentId);
      await updateOne('parents', parentId, { studentIds: [...new Set([...(parent?.studentIds ?? []), ...studentIds])] }, 'linked students to parent');
    });

    let done = studentRecords.length;
    await runLimited(updatePlans, remote() ? 4 : 1, async ({ id, patch }) => {
      await updateOne('students', id, patch, 'updated student from import');
      done += 1;
      progress?.(done, importable.length, 'Updating students…');
    });
    result.updated = updatePlans.length;
    return result;
  },

  export(ctx, options = {}) {
    const classById = Object.fromEntries(ctx.classes.map((c) => [c.id, c]));
    const streamById = Object.fromEntries(ctx.streams.map((s) => [s.id, s]));
    const parentById = Object.fromEntries(ctx.parents.map((p) => [p.id, p]));
    const list = ctx.students
      .filter((s) => s.status !== 'archived' && (!options.classId || s.classId === options.classId))
      .sort((a, b) => (classById[a.classId]?.order ?? 0) - (classById[b.classId]?.order ?? 0) || fullName(a).localeCompare(fullName(b)));
    const header = STUDENT_FIELDS.filter((f) => f.key !== 'fullName').map((f) => f.label);
    const rows = list.map((s) => {
      const parent = parentById[(s.parentIds ?? [])[0]];
      return [
        s.admissionNumber, s.firstName, s.middleName ?? '', s.lastName, s.gender ? (s.gender === 'male' ? 'Male' : s.gender === 'female' ? 'Female' : s.gender) : '',
        s.dateOfBirth ?? '', classById[s.classId]?.name ?? '', streamById[s.streamId]?.name ?? '', s.admissionDate ?? '',
        s.boardingStatus === 'boarding' ? 'Boarding' : 'Day', parent ? parentFullName(parent) : '', parent?.phone ?? '', parent?.email ?? '',
      ];
    });
    const cls = options.classId ? classById[options.classId]?.name : '';
    return { sheets: [{ name: 'Students', rows: [header, ...rows] }], fileName: `students${cls ? `-${cls}` : ''}`, count: rows.length };
  },

  template(ctx, options = {}) {
    const header = STUDENT_FIELDS.filter((f) => f.key !== 'fullName').map((f) => f.label);
    const cls = options.classId ? ctx.classes.find((c) => c.id === options.classId)?.name : 'Grade 1';
    return {
      sheets: [
        { name: 'Students', rows: [header, ['A001', 'Amani', 'Wanjiru', 'Otieno', 'Female', '2016-03-12', cls, 'A', '2024-01-08', 'Day', 'Jane Otieno', '0712345678', 'jane@example.com']] },
        { name: 'Instructions', rows: [
          ['How to fill this sheet'],
          ['• One row per student. Delete the example row before importing.'],
          ['• Required: Admission No, a name (First + Last, or a single Full Name column) and a Class.'],
          ['• Class can be written as "Grade 1" or "Grade 1 A" (A becomes the stream).'],
          ['• Dates can be 2016-03-12 or 12/03/2016 (day first).'],
          ['• Brothers and sisters can share the same parent phone number — they will be linked to one parent.'],
          ['• Your own column headings are fine too: you can match them when you upload.'],
        ] },
      ],
      fileName: 'students-template',
    };
  },
};
