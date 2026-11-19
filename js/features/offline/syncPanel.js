// Shows exactly what is waiting to sync and what needs attention. Wording is deliberately plain:
// "Synchronized" appears only after the system of record accepted the change.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { getEngine, subscribe, syncNow, offlineAvailable } from '../../offline/offlineService.js';
import { STATUS, statusLabel } from '../../offline/outbox.js';

export const TONE = { pending: 'gold', syncing: 'gold', synced: 'good', failed: 'bad', conflict: 'bad' };
export const stateBadge = (status) => `<span class="badge badge-${TONE[status] ?? 'muted'}" title="${escapeHtml(statusLabel(status))}">${escapeHtml(statusLabel(status))}</span>`;

// describe(op) → short human text such as "Amy K — Absent". Supplied by the screen that knows the names.
export function mountSyncPanel(el, describe) {
  let off;
  const online = () => globalThis.navigator?.onLine !== false;
  async function draw() {
    const engine = getEngine();
    const ops = await engine.list();
    const unsynced = ops.filter((o) => o.status !== STATUS.synced);
    const synced = ops.filter((o) => o.status === STATUS.synced).length;
    const c = (s) => ops.filter((o) => o.status === s).length;
    el.innerHTML = `<div class="card card-p space-y-2" role="region" aria-label="Sync status">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="badge badge-${online() ? 'good' : 'bad'}">${online() ? 'Online' : 'Offline — changes are saved on this phone'}</span>
        <span class="text-sm text-ink-600">${c('pending') + c('syncing')} waiting · ${synced} synchronized · ${c('failed')} failed · ${c('conflict')} conflicts</span>
        <button class="btn-secondary btn-sm" id="sp-sync" ${online() ? '' : 'disabled'}>Sync now</button>
      </div>
      ${offlineAvailable() ? '<p class="text-xs text-ink-500">Demo mode: changes sync into this browser\'s own school data. Syncing to a school\'s cloud server is not connected yet.</p>' : ''}
      ${unsynced.slice(0, 40).map((o) => `<div class="flex flex-wrap items-center justify-between gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding-top:.4rem;">
          <span>${escapeHtml(describe(o))}${o.lastError ? `<span class="text-xs text-ink-500" style="display:block;">${escapeHtml(o.lastError)}</span>` : ''}${o.status === STATUS.conflict ? `<span class="text-xs" style="display:block;">Server has: ${escapeHtml(JSON.stringify(o.conflict?.value ?? {}))} (by ${escapeHtml(o.conflict?.by ?? 'another device')})</span>` : ''}</span>
          <span class="flex gap-1 items-center">${stateBadge(o.status)}
            ${o.status === STATUS.conflict ? `<button class="btn-ghost btn-sm" data-keep="${o.opId}">Keep mine</button><button class="btn-ghost btn-sm" data-server="${o.opId}">Use server's</button>` : ''}
            ${o.status === STATUS.failed ? `${o.permanent ? '' : `<button class="btn-ghost btn-sm" data-retry="${o.opId}">Retry</button>`}<button class="btn-ghost btn-sm" data-discard="${o.opId}">Discard</button>` : ''}</span></div>`).join('')}
    </div>`;
    qs(el, '#sp-sync')?.addEventListener('click', () => syncNow());
    on(el, '[data-keep]', 'click', (e) => getEngine().keepMine(e.currentTarget.dataset.keep).then(syncNow));
    on(el, '[data-server]', 'click', (e) => { if (confirm('Throw away your change and keep what the server has?')) getEngine().useServer(e.currentTarget.dataset.server); });
    on(el, '[data-retry]', 'click', (e) => getEngine().retry(e.currentTarget.dataset.retry).then(syncNow));
    on(el, '[data-discard]', 'click', (e) => { if (confirm('Discard this change? It will not be saved.')) getEngine().discard(e.currentTarget.dataset.discard); });
  }
  // Listeners remove themselves once this panel has been replaced on screen.
  const alive = () => { if (el.isConnected) return true; off?.(); window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet); return false; };
  const onNet = () => { if (alive()) draw(); };
  off = subscribe(() => { if (alive()) draw(); });
  window.addEventListener('online', onNet); window.addEventListener('offline', onNet);
  draw();
  return draw;
}
