// The text of the Privacy Notice, Terms of Service, Data Processing Terms and the school's parent notice.
// Written as plain data so it can be tested: every statement about what the system does is something it really does, and every detail
// only the owner can supply is a {{placeholder}} that shows up as a highlighted "[to be completed: …]" instead of a guess.
// THIS IS A DRAFT FOR LEGAL REVIEW, not legal advice. It follows Kenya's Data Protection Act, 2019 and the Data Protection (General)
// Regulations, 2021. A Kenyan data-protection lawyer must review it before it is relied on.
export const LEGAL_VERSION = '2026-10-draft-1';
export const TODO = (label) => `[to be completed: ${label}]`;

// What each placeholder means, so the missing-details list can say what to enter.
export const FIELD_LABELS = {
  company: 'legal name of the company', address: 'registered postal address', email: 'privacy contact email', phone: 'privacy contact phone',
  dpo: 'name of the data protection officer', odpc: 'ODPC registration number', location: 'where learner data is stored (data centre and city, in Kenya)',
  subs: 'the list of service providers that handle data', retention: 'retention period in days',
};
export const REQUIRED_FIELDS = ['company', 'address', 'email', 'dpo', 'odpc', 'location', 'subs'];

// Settings (as saved in Business settings) -> the values the texts use. Empty values stay empty, so they show as to-do markers.
export function legalFacts(settings = {}) {
  const s = settings; const t = (v) => String(v ?? '').trim();
  return {
    brand: t(s.businessName) || 'SwiftIQ EduFlow', company: t(s.legalName), address: t(s.registeredAddress), email: t(s.privacyEmail), phone: t(s.privacyPhone),
    dpo: t(s.dpoName), odpc: t(s.odpcRegistration), location: t(s.dataLocation), subs: t(s.subProcessors).split('\n').map((x) => x.trim()).filter(Boolean),
    retention: Number(s.retentionDays) > 0 ? String(Math.round(Number(s.retentionDays))) : '90', reviewedOn: t(s.legalReviewedOn),
  };
}
export const missingFields = (f) => REQUIRED_FIELDS.filter((k) => (k === 'subs' ? !f.subs.length : !f[k]));

const v = (f, k) => (k === 'subs' ? (f.subs.length ? f.subs.join('; ') : TODO(FIELD_LABELS.subs)) : f[k] || TODO(FIELD_LABELS[k]));
const contact = (f) => `${v(f, 'email')}${f.phone ? ` or ${f.phone}` : ''}`;

// ------------------------------------------------------------------------------------------------ Privacy Notice
export function privacySections(f) {
  const co = f.company || TODO(FIELD_LABELS.company);
  return [
    { id: 'who', title: 'Who we are', blocks: [
      { p: `${f.brand} is a school management service run by ${co}, ${v(f, 'address')}. Our data protection officer is ${v(f, 'dpo')}, reachable at ${contact(f)}. We are registered with the Office of the Data Protection Commissioner (ODPC), registration number ${v(f, 'odpc')}.` },
      { p: 'This notice explains what personal data we handle, why, who sees it, how long we keep it and what your rights are. It follows the Data Protection Act, 2019 and the Data Protection (General) Regulations, 2021 of Kenya.' }] },
    { id: 'roles', title: 'Two different roles', blocks: [
      { p: 'The data we handle falls into two groups, and our responsibility is different for each.' },
      { ul: ['Records a school keeps in the service (learners, parents and guardians, staff, marks, attendance, fees, health, boarding and so on). The school decides why and how this data is used, so the school is the data controller. We are its data processor: we store and process these records only on the school’s instructions and under a written agreement (see our Data Processing Terms).',
        `Our own records: the account details of school administrators and other people who contact us, billing and payment records, security logs and support messages. For these, ${co} is the data controller.`] },
      { p: 'If you are a parent or guardian, a learner or a member of staff, and your question is about a school’s records, please ask the school first. The school is responsible for answering you, and we will help it do so.' }] },
    { id: 'collect', title: 'What we handle', blocks: [
      { p: 'For our own records:' }, { ul: ['school and administrator details: names, email addresses, phone numbers, school name, the package chosen and the number of students declared', 'invoices, payments and payment references', 'sign-in activity, security logs and technical details needed to keep the service working', 'messages you send us'] },
      { p: 'Schools choose what to record in their own area. Depending on the modules a school uses, this can include:' },
      { ul: ['learners: name, admission number, class, gender, date of birth, photo if the school uploads one, guardians and their contact details, attendance, marks and competency ratings, homework and hand-ins, fees and receipts, discipline records, school transport, clubs and activities, boarding details', 'parents and guardians: name, phone, email, relationship to the learner, and portal sign-in', 'staff: name, role, contact details, the classes and subjects they teach', 'health information, only where the school switches the Health module on: allergies, conditions, emergency contact, sick-bay visits, medication and immunisations'] }] },
    { id: 'why', title: 'Why we use it', blocks: [{ ul: ['to provide the service the school has signed up for, including creating and securing accounts and issuing invoices', 'to keep the service secure, prevent misuse and fix faults', 'to meet our legal obligations, for example keeping financial records', 'to contact you about your account, and, only if you agree, about news and offers. You can stop these at any time and each message will tell you how'] },
      { p: 'We do not sell personal data. We do not show advertising. We do not use learners’ data for marketing or profiling, and a child’s data is never used to target messages to the child.' }] },
    { id: 'children', title: 'Children’s data', blocks: [
      { p: 'Most of what is in the service is about children. The law gives children’s data extra protection and requires a parent or guardian’s consent, or another lawful reason, before a child’s data is processed. The school, as controller, is responsible for that and for telling parents what it does with their children’s data; we give each school a notice and a consent form it can use.' },
      { p: 'We use children’s data only to provide the school’s service. Learners and parents can see only their own records, learners cannot see fees, and results reach parents and learners only after the school has approved and published them.' }] },
    { id: 'health', title: 'Health information', blocks: [{ p: 'Health data is sensitive. The Health module is off unless a school turns it on, and inside it only school administrators and the school nurse can open it. Each time a learner’s health record is opened, that is logged. Health records never appear in the parent or learner portal, on report cards or on the principal’s overview. The school is responsible for having a parent’s consent for first aid and medication; the module records whether it has been given.' }] },
    { id: 'sharing', title: 'Who sees the data', blocks: [
      { p: 'Inside a school, people see only what their role allows: for example teachers see their own classes, accountants see fees, and parents see only their own children.' },
      { p: `We use service providers to run the service. They may handle data only to provide their service to us and must protect it: ${v(f, 'subs')}.` },
      { p: 'We share personal data with a public authority only when the law requires it, and only what is required.' }] },
    { id: 'location', title: 'Where data is stored', blocks: [
      { p: `School records are stored in ${v(f, 'location')}. The Regulations require that data processed for basic education is processed in, or has at least one serving copy in, a data centre in Kenya, and we design our hosting to meet that.` },
      { p: 'If personal data is ever transferred outside Kenya, we do it only with the safeguards the law requires, we document the transfer, and we tell the school.' }] },
    { id: 'security', title: 'How we protect it', blocks: [{ ul: ['access is limited by role, and each school’s data is kept separate from every other school’s', 'passwords are required to be at least 8 characters and are stored only in scrambled (hashed) form', 'sessions end automatically after a period of inactivity', 'important actions are written to an activity log showing who did what and when', 'connections to the service are encrypted', 'data is backed up, and we test that backups can be restored', 'our staff may open a school’s records only when needed to support that school and are bound to confidentiality'] },
      { p: 'No system is perfectly secure. If a breach could put people at real risk of harm, we tell the school without delay, and in any case within 48 hours of becoming aware, so that the school can notify the ODPC within 72 hours as the law requires.' }] },
    { id: 'keep', title: 'How long we keep it', blocks: [{ ul: ['A school’s records are kept while its subscription is active. If a subscription lapses, the records are kept, with access limited to essential functions, so that nothing is lost.',
      `If a school ends its agreement, we return its data on request and then delete it within ${f.retention} days, unless the law requires us to keep something.`, 'Invoices and payment records are kept for as long as the law requires for accounting and tax.', 'Security logs are kept for a limited period and then deleted.'] }] },
    { id: 'rights', title: 'Your rights', blocks: [
      { p: 'You can ask for a copy of your personal data, for it to be corrected, for it to be deleted, to restrict or object to how it is used, and to receive it in a portable form. A parent or guardian can do this for a child. Asking is free, except that a reasonable fee covering our cost may apply to a portability request. The response times set by the Regulations are:' },
      { ul: ['access to your data: within 7 days', 'correction, deletion, restriction or objection: within 14 days (if a correction is refused, you must be told in writing within 7 days)', 'portability: within 30 days', 'you can object at any time to your data being used for direct marketing, and that is done straight away'] },
      { p: `For records a school keeps, ask the school. If you ask us, we will pass your request to the school without delay and help it respond. For our own records, contact ${contact(f)}. The ODPC’s standard request forms (DPG 1 to DPG 5) may be used. If you are not satisfied you have the right to complain to the Office of the Data Protection Commissioner (www.odpc.go.ke).` }] },
    { id: 'storage', title: 'Cookies, storage and third-party requests', blocks: [{ p: 'We use your browser’s storage only for what the service needs: keeping you signed in and remembering your settings. We use no advertising or analytics trackers. Our pages load fonts from Google Fonts, so Google receives your device’s internet address when a page loads.' }] },
    { id: 'changes', title: 'Changes to this notice', blocks: [{ p: 'If we change this notice in a way that matters, we will tell school administrators before it takes effect. The date of the current version is shown at the bottom of this page.' }] },
    { id: 'contact', title: 'Contact us', blocks: [{ p: `${co}, ${v(f, 'address')}. Email ${contact(f)}. Data protection officer: ${v(f, 'dpo')}.` }] },
  ];
}

// ------------------------------------------------------------------------------------------------ Terms of Service
export function termsSections(f) {
  const co = f.company || TODO(FIELD_LABELS.company);
  return [
    { id: 'agreement', title: 'This agreement', blocks: [{ p: `These terms are between ${co} (“we”, “us”) and the school that creates an account (“the school”, “you”). The person who creates the account confirms they have authority to bind the school. The Privacy Notice and the Data Processing Terms form part of this agreement.` }] },
    { id: 'service', title: 'The service', blocks: [{ p: `${f.brand} is an online system for running a school: learners, academics, attendance, fees, communication and related modules. The modules and student limit available to you depend on the package you choose. We may improve or change the service; if a change removes something you rely on, we will tell you beforehand.` }] },
    { id: 'accounts', title: 'Accounts and approval', blocks: [{ ul: ['a new school account is reviewed and approved by us before it is opened', 'you must give accurate information and keep your sign-in details secret', 'the school is responsible for everything done under its accounts and for choosing who gets which role', 'tell us promptly if you think an account has been misused'] }] },
    { id: 'school', title: 'The school’s responsibilities for its data', blocks: [{ p: 'The school owns its records and decides how they are used. By using the service, the school confirms that:' },
      { ul: ['it has a lawful reason to collect each kind of data it enters, and tells parents and guardians what it does with their children’s data', 'it has obtained a parent’s or guardian’s consent where the law requires it, including for any health information, first aid and medication', 'it enters only what it needs, keeps it accurate, and gives access only to people who need it', 'it responds to requests from parents, learners and staff to see, correct or delete their data'] }] },
    { id: 'use', title: 'Acceptable use', blocks: [{ p: 'You must not use the service to break the law, to look at data you are not entitled to see, to share sign-in details, to interfere with the service or other schools, to upload harmful files, or to send unsolicited marketing. We may suspend an account that is being misused, and will explain why.' }] },
    { id: 'fees', title: 'Fees, trial and renewal', blocks: [{ ul: ['fees are set by the package and billing period you choose, in Kenya shillings, and are shown on your invoice', 'when a school is approved it may start on a free trial; paying the invoice switches the package on for the full period', 'we issue a renewal invoice before your period ends; paying it continues the service without a break', 'after the end of a period there is a short grace period during which nothing changes; after that the account is limited to essential functions until an invoice is paid', 'limiting an account never deletes records: they are kept and returned as soon as the account is renewed', 'if you move to a larger package, the difference for the rest of the period is invoiced; a move to a smaller package takes effect at renewal', 'we will give at least 30 days’ notice of a price change, which applies from the next renewal', 'refunds: [owner decision: state the refund policy]'] }] },
    { id: 'exit', title: 'Ending the agreement and your data', blocks: [{ p: `You can stop using the service at any time. On request we will give you a copy of the school’s data in a common format, and we will then delete it within ${f.retention} days of the agreement ending, unless the law requires us to keep something. Schools can also download backups themselves while they use the service.` }] },
    { id: 'availability', title: 'Availability and support', blocks: [{ p: 'We work to keep the service available and to fix faults quickly, but we cannot promise it will never be interrupted. Support is by email and phone during working hours [owner decision: state hours and response times].' }] },
    { id: 'liability', title: 'Liability', blocks: [{ p: '[for the lawyer to complete: limitation of liability, indemnities and force majeure]' }] },
    { id: 'law', title: 'Governing law and disputes', blocks: [{ p: 'These terms are governed by the laws of Kenya. We will first try to settle any disagreement by talking to you. [for the lawyer to complete: dispute resolution and jurisdiction]' }] },
    { id: 'changes', title: 'Changes to these terms', blocks: [{ p: 'We may update these terms. We will give school administrators notice before a change that matters takes effect. If you keep using the service afterwards, you accept the change; if you do not, you may end the agreement.' }] },
    { id: 'contact', title: 'Contact', blocks: [{ p: `${co}, ${v(f, 'address')}. ${contact(f)}.` }] },
  ];
}

// ------------------------------------------------------------------------------------------------ Data Processing Terms
// Contents follow regulation 24(2) of the Data Protection (General) Regulations, 2021.
export function processingSections(f) {
  const co = f.company || TODO(FIELD_LABELS.company);
  return [
    { id: 'parties', title: 'Parties and purpose', blocks: [{ p: `These terms are between the school (the data controller) and ${co} (the data processor). They apply to all personal data the school stores in ${f.brand}. They are required by the Data Protection Act, 2019 and regulation 24 of the Data Protection (General) Regulations, 2021.` }] },
    { id: 'details', title: 'What is processed', blocks: [{ ul: ['Subject matter: providing the school management service the school has subscribed to.', 'Duration: for as long as the school uses the service, plus the return and deletion period below.', 'Nature and purpose: storing, organising, displaying, calculating on, printing, exporting and securing the school’s records so the school can run its academic, administrative and financial work.', 'Types of data: identity and contact details, admission and class details, attendance, assessment and competency records, fee and payment records, discipline, transport, activity and boarding records, staff records, and, if the school enables it, health information.', 'Categories of data subjects: learners, parents and guardians, school staff and other users the school authorises.'] }] },
    { id: 'instructions', title: 'Instructions and responsibilities', blocks: [{ ul: ['We process the school’s data only on its documented instructions, which are these terms and the school’s use of the service. We tell the school if we think an instruction breaks the law.', 'The school is responsible for having a lawful basis for the data it enters and for telling data subjects what it does, including parental consent for children’s data.', 'We will not use the school’s data for our own purposes, to build advertising profiles, or to market to learners.'] }] },
    { id: 'confidentiality', title: 'Confidentiality', blocks: [{ p: 'Everyone we allow to process the school’s data is bound by a duty of confidentiality, and may access it only as needed to provide and support the service.' }] },
    { id: 'security', title: 'Security measures', blocks: [{ ul: ['role-based access and separation between schools', 'hashed passwords, automatic sign-out after inactivity, and an activity log of important actions', 'encrypted connections, backups, and restore testing', 'extra restriction and logging for sensitive records such as health information', 'regular review and testing of the software for weaknesses'] }] },
    { id: 'subprocessors', title: 'Sub-processors', blocks: [{ p: 'We engage another processor only with the school’s prior authorisation and under a written contract with the same obligations, and we remain responsible to the school for it. The school authorises the following at the start of this agreement; we will give notice before adding or replacing one, and the school may object.' }, { p: v(f, 'subs') }] },
    { id: 'location', title: 'Location and transfers', blocks: [{ p: `The school’s data is stored in ${v(f, 'location')}. Data processed for basic education is kept in, or has at least one serving copy in, a data centre in Kenya. We will not transfer personal data outside Kenya except as the Act and Regulations allow, with the safeguards required, documented, and with the school’s knowledge.` }] },
    { id: 'rights', title: 'Helping with data subject rights', blocks: [{ p: 'If someone asks us for access, correction, deletion, restriction, objection or portability of the school’s data, we pass the request to the school within 2 working days and give the school the tools and help it needs to answer within the legal time limits (access in 7 days; correction, deletion, restriction and objection in 14 days; portability in 30 days).' }] },
    { id: 'breach', title: 'Personal data breaches', blocks: [{ p: 'We tell the school without delay, and within 48 hours, of becoming aware of a breach affecting its data, with what we know about what happened, the data and people affected, and what we are doing. The school, as controller, decides whether to notify the ODPC (within 72 hours) and the people affected, and we help it do so, including with a data protection impact assessment where one is needed.' }] },
    { id: 'end', title: 'Return and deletion', blocks: [{ p: `When the agreement ends we return the school’s data, or delete it, as the school chooses, and delete the remaining copies within ${f.retention} days, unless the law requires us to keep something. Backups are deleted on their normal cycle.` }] },
    { id: 'audit', title: 'Audit and inspection', blocks: [{ p: 'The school may, on reasonable notice, check that we are keeping to these terms, by asking for information, or for an independent report, or by inspection. We will give reasonable help.' }] },
  ];
}

// ------------------------------------------------------------------------------------------------ the school's own notice to parents
// answers: what the school has told us about itself. The school is the controller, so this is the school's notice, in its name.
export const SHARE_OPTIONS = [['ministry', 'the Ministry of Education, county education office and KNEC, where the law or an exam requires it'], ['sms', 'our SMS provider, to send you messages about fees, results and notices'], ['mpesa', 'Safaricom M-Pesa, when you pay fees by M-Pesa'], ['auditors', 'our auditors and, where the law requires, the authorities'], ['sponsors', 'a learner’s sponsor, for fees they pay']];
export function parentNoticeSections(school = {}, a = {}, platform = {}) {
  const name = school.name || TODO('school name'); const fi = legalFacts(platform);
  const shares = SHARE_OPTIONS.filter(([k]) => (a.shares ?? []).includes(k)).map(([, t]) => t);
  const contactLine = [a.contactName, a.contactEmail, a.contactPhone].filter(Boolean).join(', ') || TODO('who parents should contact, with phone or email');
  return [
    { id: 'who', title: `How ${name} looks after your child’s information`, blocks: [{ p: `${name} keeps records about your child and your family so that we can teach, look after and communicate with you. We are the data controller under Kenya’s Data Protection Act, 2019. Contact for any question about your child’s information: ${contactLine}.` }] },
    { id: 'what', title: 'What we keep', blocks: [{ ul: ['your child’s name, admission number, class, date of birth and gender', 'your name and contact details, and those of any other guardian or emergency contact', 'attendance, marks, competency ratings, homework and report cards', 'fees invoiced and paid', 'discipline and welfare notes, school transport, clubs and activities' + (a.boarding ? ', and boarding details' : ''), ...(a.health ? ['health information that helps us keep your child safe: allergies, conditions, emergency contact, sick-bay visits, medication and immunisations. This is sensitive; only school administrators and the school nurse can see it'] : [])] }] },
    { id: 'why', title: 'Why we need it', blocks: [{ p: 'To run the school: teaching and assessing your child, keeping them safe, keeping in touch with you, and managing fees. We do not sell your information and we do not use it to advertise.' }] },
    { id: 'who2', title: 'Who sees it', blocks: [{ p: 'Staff see only what they need for their work. You can see your own children’s information through the parent portal. We keep our records on the SwiftIQ EduFlow service, which stores and processes them for us under a written agreement.' }, ...(shares.length ? [{ p: 'We also share some information with:' }, { ul: shares }] : [{ p: 'We do not share your child’s information with anyone else unless the law requires it.' }])] },
    { id: 'keep', title: 'How long we keep it', blocks: [{ p: a.retention ? `${a.retention}` : TODO('how long the school keeps learner records, for example "while your child is enrolled and for 7 years after they leave"') }] },
    { id: 'rights', title: 'Your rights', blocks: [{ p: 'You can ask to see the information we hold about your child and about you, to have mistakes corrected, to have information deleted where the law allows, and to object to or restrict how it is used. You may also withdraw any consent you have given. We will respond to a request to see information within 7 days, and to the other requests within 14 days. There is no charge. If you are not satisfied you may complain to the Office of the Data Protection Commissioner (www.odpc.go.ke).' }] },
    ...(a.photos ? [{ id: 'photos', title: 'Photographs', blocks: [{ p: 'With your consent we may use photographs or video of your child in school publications, on notice boards or on the school’s website. You may say no, and change your mind later, without any effect on your child’s place or treatment at school.' }] }] : []),
  ];
}
// The consent form that goes with the notice. Each consent is separate and optional, as the Regulations require (regulation 4).
export function parentConsentItems(a = {}) {
  return [
    ...(a.health ? [['firstaid', 'First aid and basic medicine: I agree that the school may give my child first aid and, where my child needs it, basic medicine such as pain relief, and may contact me or the emergency contact if my child is unwell.'], ['health', 'Health information: I have told the school about any allergies and conditions my child has, and agree that the school nurse and administrators may keep this to keep my child safe.']] : []),
    ...(a.photos ? [['photos', 'Photographs: I agree that the school may use photographs or video of my child in school publications and on notice boards. (Optional)']] : []),
    ['sms', 'Messages: I agree that the school may send me SMS, WhatsApp or email messages about my child’s fees, results and school notices.'],
  ];
}
