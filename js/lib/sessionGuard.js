// Browser side of the session policy: records activity, signs the person out when the session
// has expired, and (in demo mode only) shows an unmistakable banner so browser-local demo data
// can never be mistaken for a real, server-protected school database.
import { isSupabaseConfigured } from '../config/supabase.js';
import { SESSION_LIMITS } from './sessionPolicy.js';

let timer = null;
let lastTouch = 0;

// touch(): records activity (throttled to once a minute). check(): returns true while the session is valid.
export function startSessionGuard({ touch, check, onExpire }) {
  stopSessionGuard();
  const onActivity = () => {
    const now = Date.now();
    if (now - lastTouch < 60_000) return;
    lastTouch = now;
    touch();
  };
  ['click', 'keydown', 'touchstart', 'scroll'].forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
  timer = setInterval(() => { if (!check()) { stopSessionGuard(); onExpire(); } }, 30_000);
  startSessionGuard.cleanup = () => ['click', 'keydown', 'touchstart', 'scroll'].forEach((e) => window.removeEventListener(e, onActivity));
}

export function stopSessionGuard() {
  if (timer) clearInterval(timer);
  timer = null;
  startSessionGuard.cleanup?.();
}

export const idleMinutes = (kind) => Math.round(SESSION_LIMITS[kind].idleMs / 60000);

export function mountDemoBanner() {
  if (isSupabaseConfigured() || document.getElementById('demo-mode-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'demo-mode-banner';
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:sticky;top:0;z-index:9999;background:#7a4b00;color:#fff;padding:.35rem .75rem;font-size:.8rem;text-align:center;';
  bar.textContent = 'DEMO MODE — data is saved only in this browser and is not protected like a real server. Do not enter real learner or payment records.';
  document.body.prepend(bar);
}
