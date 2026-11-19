// The public legal pages: Privacy Notice, Terms of Service, Data Processing Terms. The text comes from config/legalText.js and the
// owner's details from Business settings, so nothing here is hard-coded. Anything still missing is highlighted, never invented.
import { escapeHtml } from '../../components/dom.js';
import { headerHtml, legalLinksHtml } from './chrome.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { getPlatformSettings } from '../../services/platformService.js';
import * as T from '../../config/legalText.js';

const PAGES = {
  privacy: { title: 'Privacy Notice', build: T.privacySections, lead: 'How we handle personal data, and your rights. Plain language, in line with Kenya’s Data Protection Act, 2019.' },
  terms: { title: 'Terms of Service', build: T.termsSections, lead: 'The agreement between a school and the service.' },
  processing: { title: 'Data Processing Terms', build: T.processingSections, lead: 'What the school (data controller) and the service (data processor) agree about the school’s records.' },
};

const TODO_RE = /\[(?:to be completed|owner decision|for the lawyer to complete)[^\]]*\]/g;
const inline = (text) => escapeHtml(text).replace(TODO_RE, (m) => `<mark class="legal-todo">${m}</mark>`);
export const blocksHtml = (blocks) => blocks.map((b) => (b.p ? `<p>${inline(b.p)}</p>` : `<ul>${b.ul.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`)).join('');
export const sectionsHtml = (sections) => sections.map((s) => `<section id="${escapeHtml(s.id)}" class="legal-sec"><h2>${escapeHtml(s.title)}</h2>${blocksHtml(s.blocks)}</section>`).join('');

export function renderLegalPage(rootEl, kind) {
  const page = PAGES[kind]; const settings = isSupabaseConfigured() ? {} : getPlatformSettings(); const f = T.legalFacts(settings); const sections = page.build(f); const open = T.missingFields(f);
  rootEl.innerHTML = `<div class="pub">${headerHtml(false)}
    <main class="pub-container legal"><nav class="legal-tabs" aria-label="Legal pages">${Object.entries(PAGES).map(([k, p]) => `<a href="#/${k}" ${k === kind ? 'aria-current="page" class="active"' : ''}>${escapeHtml(p.title)}</a>`).join('')}</nav>
      <h1>${escapeHtml(page.title)}</h1><p class="legal-lead">${escapeHtml(page.lead)}</p>
      ${f.reviewedOn ? `<p class="text-sm text-ink-500">Last reviewed by our legal adviser on ${escapeHtml(f.reviewedOn)}.</p>` : `<div class="notice" role="note"><span><strong>Draft for legal review.</strong> This page has not yet been reviewed by a lawyer. ${open.length ? `${open.length} detail${open.length === 1 ? '' : 's'} still to be completed are marked in yellow.` : 'It will be updated once reviewed.'}</span></div>`}
      <nav class="legal-toc" aria-label="On this page"><strong>On this page</strong><ul>${sections.map((s) => `<li><a href="#/${kind}" data-jump="${escapeHtml(s.id)}">${escapeHtml(s.title)}</a></li>`).join('')}</ul></nav>
      ${sectionsHtml(sections)}
      <p class="legal-version text-xs text-ink-500">Version ${escapeHtml(T.LEGAL_VERSION)}. <button class="btn-ghost btn-sm" id="legal-print">Print this page</button></p>
      <p class="pub-footnote">${legalLinksHtml()}</p></main></div>`;
  rootEl.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); rootEl.querySelector(`#${CSS.escape(a.dataset.jump)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  rootEl.querySelector('#legal-print')?.addEventListener('click', () => window.print());
}
