import { escapeHtml } from './dom.js';
import { CURRENCY } from '../config/plans.js';
import { PAYMENT_METHODS } from '../services/platformService.js';

const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS);
const fmt = (n) => Number(n).toLocaleString('en-US');

// A printable package invoice. Used by the administrator and by the school
// (which sees only its own invoices).
export function invoiceDocumentHtml({ invoice, school, settings }) {
  const statusLabel = { unpaid: 'Unpaid', partial: 'Partly paid', paid: 'Paid', void: 'Void' }[invoice.status] ?? invoice.status;
  return `
    <div class="invoice-doc">
      <div class="invoice-top">
        <div>
          <p class="invoice-business">${escapeHtml(settings.businessName)}</p>
          ${settings.contactLine ? `<p class="invoice-muted">${escapeHtml(settings.contactLine)}</p>` : ''}
        </div>
        <div class="invoice-title">
          <h2>INVOICE</h2>
          <p><strong>${escapeHtml(invoice.number)}</strong></p>
          <span class="badge ${invoice.status === 'paid' ? 'badge-good' : invoice.status === 'void' ? 'badge-muted' : 'badge-gold'}">${escapeHtml(statusLabel)}</span>
        </div>
      </div>

      <div class="invoice-meta">
        <div>
          <p class="invoice-label">Billed to</p>
          <p><strong>${escapeHtml(school.schoolName)}</strong></p>
          <p class="invoice-muted">${escapeHtml(school.name)}</p>
          <p class="invoice-muted">${escapeHtml(school.email)}${school.phone ? ` · ${escapeHtml(school.phone)}` : ''}</p>
        </div>
        <div>
          <p class="invoice-label">Issued</p><p>${escapeHtml(invoice.issueDate)}</p>
          <p class="invoice-label" style="margin-top:0.5rem;">Due</p><p>${escapeHtml(invoice.dueDate ?? 'On receipt')}</p>
        </div>
      </div>

      <table class="data-table invoice-lines">
        <thead><tr><th>Description</th><th class="text-right">Amount (${CURRENCY})</th></tr></thead>
        <tbody>
          ${invoice.items.map((i) => `<tr><td>${escapeHtml(i.description)}</td><td class="text-right">${fmt(i.amount)}</td></tr>`).join('')}
          <tr class="invoice-sum"><td>Total</td><td class="text-right">${fmt(invoice.total)}</td></tr>
          <tr><td>Paid</td><td class="text-right">${fmt(invoice.paid)}</td></tr>
          <tr class="invoice-sum"><td>Balance due</td><td class="text-right">${fmt(invoice.balance)}</td></tr>
        </tbody>
      </table>

      ${
        invoice.payments?.length
          ? `<p class="invoice-label" style="margin-top:1rem;">Payments received</p>
             <ul class="invoice-payments">
               ${invoice.payments.map((p) => `<li>${escapeHtml(p.date)} · ${escapeHtml(METHOD_LABEL[p.method] ?? p.method)}${p.reference ? ` · ${escapeHtml(p.reference)}` : ''} — ${CURRENCY} ${fmt(p.amount)}</li>`).join('')}
             </ul>`
          : ''
      }
      ${invoice.note ? `<p class="invoice-muted" style="margin-top:1rem;">${escapeHtml(invoice.note)}</p>` : ''}
      ${
        settings.paymentInstructions && invoice.status !== 'paid' && invoice.status !== 'void'
          ? `<div class="invoice-pay"><p class="invoice-label">How to pay</p><p style="white-space:pre-line;">${escapeHtml(settings.paymentInstructions)}</p></div>`
          : ''
      }
    </div>
  `;
}
