// A visible, honest capacity notice shown above every page once a school is near, over or at its limit.
import { escapeHtml } from './dom.js';
import { currentCapacity, refreshCapacity } from '../services/subscriptionService.js';
import { isAdmin } from '../services/accessService.js';

export async function updateCapacityBanner(anchorEl) {
  if (!anchorEl?.parentElement) return;
  let host = anchorEl.parentElement.querySelector(':scope > #capacity-banner');
  if (!host) {
    host = document.createElement('div');
    host.id = 'capacity-banner';
    host.className = 'no-print';
    anchorEl.parentElement.insertBefore(host, anchorEl);
  }
  const cap = await refreshCapacity();
  if (cap.unlimited || cap.level === 'ok') { host.innerHTML = ''; return; }
  const tone = cap.level === 'full' ? 'var(--bad)' : 'var(--gold-500, #c8962b)';
  host.innerHTML = `<div class="notice" role="${cap.level === 'full' ? 'alert' : 'status'}" style="margin-bottom:1rem;border-left:4px solid ${tone};"><span>${escapeHtml(cap.message)}${isAdmin() ? ' <a href="#/subscription">View subscription</a>' : ''}</span></div>`;
}
