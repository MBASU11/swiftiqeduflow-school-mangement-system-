import { escapeHtml, qs } from '../../components/dom.js';
import { MIN_PASSWORD_LENGTH } from '../../lib/passwords.js';
import * as localPlatformService from '../../services/platformService.js';
import { legalFacts, missingFields, FIELD_LABELS } from '../../config/legalText.js';

export function renderAdminSettings(body, admin, platformService = localPlatformService) {
  const state = { saved: false, legalSaved: false, pwMessage: null, error: '' };

  async function draw() {
    let s;
    try {
      s = await platformService.getPlatformSettings();
    } catch (error) {
      body.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span></div>`;
      return;
    }
    body.innerHTML = `
      <div class="space-y-6" style="max-width:40rem;">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <section class="card card-p space-y-4">
          <h3 class="text-sm text-ink-700" style="font-weight:600;">Business details on invoices</h3>
          <div>
            <label class="label" for="bs-name">Business name</label>
            <input class="input" id="bs-name" value="${escapeHtml(s.businessName)}" />
          </div>
          <div>
            <label class="label" for="bs-contact">Contact line (address, phone, email)</label>
            <input class="input" id="bs-contact" value="${escapeHtml(s.contactLine)}" />
          </div>
          <div>
            <label class="label" for="bs-pay">Payment instructions</label>
            <textarea class="input" id="bs-pay" rows="4" placeholder="e.g. how schools should pay you — shown on every unpaid invoice">${escapeHtml(s.paymentInstructions)}</textarea>
          </div>
          <div class="flex items-center gap-3">
            <button class="btn-primary" id="bs-save">Save</button>
            ${state.saved ? `<span class="text-sm text-good" id="bs-saved">Saved.</span>` : ''}
          </div>
        </section>

        <section class="card card-p space-y-4" id="legal-card">
          <div><h3 class="text-sm text-ink-700" style="font-weight:600;">Legal and privacy details</h3>
            <p class="text-xs text-ink-500 mt-1">These fill in the public Privacy Notice, Terms of Service and Data Processing Terms (open them from the footer of the landing page). Anything left empty shows on those pages as a yellow "to be completed" note.</p></div>
          ${(() => { const open = missingFields(legalFacts(s)); return open.length ? `<div class="notice" role="note"><span><strong>${open.length} detail${open.length === 1 ? '' : 's'} still missing:</strong> ${open.map((k) => escapeHtml(FIELD_LABELS[k])).join('; ')}.</span></div>` : '<p class="text-sm text-good">All required details are filled in.</p>'; })()}
          <div class="grid sm-grid-2 gap-4">
            <div><label class="label" for="lg-company">Legal name of the company</label><input class="input" id="lg-company" value="${escapeHtml(s.legalName)}" /></div>
            <div><label class="label" for="lg-address">Registered postal address</label><input class="input" id="lg-address" value="${escapeHtml(s.registeredAddress)}" /></div>
            <div><label class="label" for="lg-email">Privacy contact email</label><input class="input" id="lg-email" type="email" value="${escapeHtml(s.privacyEmail)}" /></div>
            <div><label class="label" for="lg-phone">Privacy contact phone</label><input class="input" id="lg-phone" value="${escapeHtml(s.privacyPhone)}" /></div>
            <div><label class="label" for="lg-dpo">Data protection officer (name)</label><input class="input" id="lg-dpo" value="${escapeHtml(s.dpoName)}" /></div>
            <div><label class="label" for="lg-odpc">ODPC registration number</label><input class="input" id="lg-odpc" value="${escapeHtml(s.odpcRegistration)}" /></div>
            <div><label class="label" for="lg-loc">Where school data is stored (data centre, city)</label><input class="input" id="lg-loc" value="${escapeHtml(s.dataLocation)}" placeholder="Must be in Kenya (see the hosting note in docs)" /></div>
            <div><label class="label" for="lg-ret">Days after an agreement ends before data is deleted</label><input class="input" id="lg-ret" inputmode="numeric" value="${escapeHtml(String(s.retentionDays ?? 90))}" /></div>
          </div>
          <div><label class="label" for="lg-subs">Service providers that handle data (one per line, with what they do)</label><textarea class="input" id="lg-subs" rows="4" placeholder="e.g. Safaricom Cloud, Nairobi: hosting&#10;Africa's Talking: SMS messages&#10;Safaricom M-Pesa: payments">${escapeHtml(s.subProcessors)}</textarea></div>
          <div><label class="label" for="lg-rev">Date a lawyer last reviewed the legal pages (leave empty until they have)</label><input class="input" id="lg-rev" type="date" value="${escapeHtml(s.legalReviewedOn)}" /><p class="text-xs text-ink-500 mt-1">While this is empty, the public pages say "Draft for legal review".</p></div>
          <div class="flex items-center gap-3"><button class="btn-primary" id="lg-save">Save legal details</button>${state.legalSaved ? '<span class="text-sm text-good" id="lg-saved">Saved.</span>' : ''}</div>
        </section>

        <section class="card card-p space-y-4">
          <h3 class="text-sm text-ink-700" style="font-weight:600;">Change your password</h3>
          <div>
            <label class="label" for="pw-current">Current password</label>
            <input class="input" id="pw-current" type="password" autocomplete="current-password" />
          </div>
          <div class="grid sm-grid-2 gap-4">
            <div>
              <label class="label" for="pw-new">New password</label>
              <input class="input" id="pw-new" type="password" autocomplete="new-password" />
            </div>
            <div>
              <label class="label" for="pw-confirm">Confirm new password</label>
              <input class="input" id="pw-confirm" type="password" autocomplete="new-password" />
            </div>
          </div>
          <p class="text-xs text-ink-500">Use at least ${MIN_PASSWORD_LENGTH} characters.</p>
          ${state.pwMessage ? `<p class="text-sm ${state.pwMessage.ok ? 'text-good' : 'text-bad'}" id="pw-message" role="alert">${escapeHtml(state.pwMessage.text)}</p>` : ''}
          <div><button class="btn-secondary" id="pw-save">Change password</button></div>
        </section>
      </div>`;

    qs(body, '#bs-save').addEventListener('click', async () => {
      try {
        await platformService.savePlatformSettings({
        businessName: qs(body, '#bs-name').value.trim() || 'SwiftIQ EduFlow',
        contactLine: qs(body, '#bs-contact').value.trim(),
        paymentInstructions: qs(body, '#bs-pay').value.trim(),
        });
        state.saved = true;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await draw();
    });
    qs(body, '#lg-save').addEventListener('click', async () => {
      try {
        const days = Number(qs(body, '#lg-ret').value);
        if (!Number.isFinite(days) || days < 1 || days > 3650) throw new Error('Enter the retention period as a number of days between 1 and 3650.');
        await platformService.savePlatformSettings({ legalName: qs(body, '#lg-company').value.trim(), registeredAddress: qs(body, '#lg-address').value.trim(), privacyEmail: qs(body, '#lg-email').value.trim(), privacyPhone: qs(body, '#lg-phone').value.trim(),
          dpoName: qs(body, '#lg-dpo').value.trim(), odpcRegistration: qs(body, '#lg-odpc').value.trim(), dataLocation: qs(body, '#lg-loc').value.trim(), subProcessors: qs(body, '#lg-subs').value.trim(), retentionDays: Math.round(days), legalReviewedOn: qs(body, '#lg-rev').value });
        state.legalSaved = true; state.error = '';
      } catch (error) { state.error = error.message; state.legalSaved = false; }
      await draw();
    });
    qs(body, '#pw-save').addEventListener('click', async () => {
      const result = await platformService.changeAdminPassword(admin.id, qs(body, '#pw-current').value, qs(body, '#pw-new').value, qs(body, '#pw-confirm').value);
      state.pwMessage = result.ok ? { ok: true, text: 'Password changed.' } : { ok: false, text: result.error };
      await draw();
    });
  }
  draw();
}
