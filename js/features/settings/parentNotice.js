// Settings → Privacy notice for parents. The school is the data controller, so it needs its own notice and consent form in its own name.
// The school answers a few questions; the notice and a printable consent form are built from them (config/legalText.js).
import { escapeHtml, on, qs } from '../../components/dom.js';
import { getSchool, saveSchool } from '../../services/schoolService.js';
import { getPlatformSettings } from '../../services/platformService.js';
import { getSettings } from '../../services/settingsService.js';
const isModuleOn = (k) => Boolean(getSettings().moduleToggles?.[k]);
import * as T from '../../config/legalText.js';
import { blocksHtml, sectionsHtml } from '../public/legalPages.js';

export function noticeAnswers(school) {
  const a = school?.privacyNotice ?? {};
  return { contactName: a.contactName ?? '', contactEmail: a.contactEmail ?? '', contactPhone: a.contactPhone ?? '', retention: a.retention ?? '', shares: a.shares ?? [], health: a.health ?? isModuleOn('health'), boarding: a.boarding ?? isModuleOn('hostels'), photos: a.photos ?? false };
}
// Everything a parent is shown: the notice and the consent items, as HTML. Used here and in the parent and learner portal.
export function parentNoticeHtml(school, answers) {
  const sections = T.parentNoticeSections(school, answers, getPlatformSettings());
  return `${sectionsHtml(sections)}`;
}

export function renderParentNotice(container) {
  const school = getSchool() ?? {}; const st = { a: noticeAnswers(school), saved: false, preview: true, errors: [] };
  const draw = () => {
    const a = st.a; const sections = T.parentNoticeSections(school, a, getPlatformSettings()); const open = JSON.stringify(sections).match(/\[to be completed[^\]]*\]/g) ?? [];
    container.innerHTML = `<section class="card card-p space-y-3"><div><h3 class="text-sm" style="font-weight:600;">Privacy notice and consent form for parents</h3>
      <p class="text-xs text-ink-500 mt-1">The Data Protection Act makes the school responsible for telling parents what it does with their children's information and for getting consent where it is needed. Answer a few questions, then print the notice and consent form, give them out at admission and keep the signed forms. This is a template: have the school's lawyer or board read it first.</p></div>
      ${st.errors.map((e) => `<p class="field-error" role="alert">${escapeHtml(e)}</p>`).join('')}
      <div class="grid grid-2 gap-3"><div><label class="label" for="pn-name">Who should parents contact about their child's information?</label><input class="input" id="pn-name" value="${escapeHtml(a.contactName)}" placeholder="Name and role, e.g. Mrs Wanjiru, Deputy Principal" /></div>
        <div><label class="label" for="pn-phone">Their phone</label><input class="input" id="pn-phone" value="${escapeHtml(a.contactPhone)}" /></div>
        <div><label class="label" for="pn-email">Their email</label><input class="input" id="pn-email" type="email" value="${escapeHtml(a.contactEmail)}" /></div></div>
      <div><label class="label" for="pn-ret">How long does the school keep a learner's records?</label><input class="input" id="pn-ret" value="${escapeHtml(a.retention)}" placeholder="e.g. While your child is enrolled and for 7 years after they leave" /></div>
      <fieldset style="border:0;padding:0;"><legend class="label">The school shares information with</legend>${T.SHARE_OPTIONS.map(([k, t]) => `<label class="text-sm" style="display:block;padding:.2rem 0;"><input type="checkbox" data-share="${k}" ${a.shares.includes(k) ? 'checked' : ''}/> ${escapeHtml(t)}</label>`).join('')}</fieldset>
      <div><label class="text-sm" style="display:block;"><input type="checkbox" id="pn-health" ${a.health ? 'checked' : ''}/> The school keeps health information (allergies, sick bay, medication)</label>
        <label class="text-sm" style="display:block;"><input type="checkbox" id="pn-boarding" ${a.boarding ? 'checked' : ''}/> The school has boarding</label>
        <label class="text-sm" style="display:block;"><input type="checkbox" id="pn-photos" ${a.photos ? 'checked' : ''}/> The school uses photographs or video of learners</label></div>
      ${open.length ? `<div class="notice" role="note"><span>${open.length} detail${open.length === 1 ? ' is' : 's are'} still to complete (marked in yellow below).</span></div>` : ''}
      <div class="flex flex-wrap gap-2 no-print"><button class="btn-primary btn-sm" id="pn-save">Save</button><button class="btn-secondary btn-sm" id="pn-print">Print notice and consent form</button>${st.saved ? '<span class="text-sm text-good" role="status">Saved. Parents will see this notice in their portal.</span>' : ''}</div></section>
      <section class="card card-p legal" id="pn-doc" style="margin-top:1rem;"><h2 style="margin-top:0;">${escapeHtml(school.name ?? 'School')}</h2>${sectionsHtml(sections)}
        <h2>Consent form</h2><p class="text-sm">Learner's name: ______________________ Class: ____________</p>
        ${T.parentConsentItems(a).map(([k, t]) => `<p class="text-sm"><span aria-hidden="true">☐ Yes &nbsp; ☐ No &nbsp;</span> ${escapeHtml(t)}</p>`).join('')}
        <p class="text-sm">You may say no to any of these, or change your mind at any time by telling the school, without any effect on your child's place at school (except that we cannot give medicine without consent).</p>
        <p class="text-sm">Parent or guardian: ______________________ Signature: ______________ Date: __________</p></section>`;
    const read = () => { st.a = { ...st.a, contactName: qs(container, '#pn-name').value.trim(), contactPhone: qs(container, '#pn-phone').value.trim(), contactEmail: qs(container, '#pn-email').value.trim(), retention: qs(container, '#pn-ret').value.trim(),
      shares: [...container.querySelectorAll('[data-share]:checked')].map((x) => x.dataset.share), health: qs(container, '#pn-health').checked, boarding: qs(container, '#pn-boarding').checked, photos: qs(container, '#pn-photos').checked }; };
    qs(container, '#pn-save').addEventListener('click', () => { read(); const bad = [['contactEmail', /^\S+@\S+\.\S+$/]].filter(([k, re]) => st.a[k] && !re.test(st.a[k])); st.errors = bad.length ? ['That email address does not look right.'] : []; if (!st.errors.length) { saveSchool({ ...school, privacyNotice: st.a }); st.saved = true; } draw(); });
    qs(container, '#pn-print').addEventListener('click', () => { read(); document.body.classList.add('cbc-printing'); const doc = qs(container, '#pn-doc'); doc.id = 'cbc-report'; try { window.print(); } finally { doc.id = 'pn-doc'; document.body.classList.remove('cbc-printing'); } });
    on(container, 'input, textarea', 'change', () => { st.saved = false; });
  };
  draw();
}
