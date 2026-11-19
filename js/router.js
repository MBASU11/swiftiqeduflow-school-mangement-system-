// Minimal hash router. Routes are registered as { pattern, render(container, params) }.
// Pattern segments starting with ":" become named params; query string params are merged in too.

import { replayEntrance } from './components/motion.js';
import { canAccessModule, applyAccessToContainer, roleLabel } from './services/accessService.js';
import { moduleForPath } from './config/roles.js';
import { moduleEnabled } from './services/subscriptionService.js';
import { lowestPackageWith } from './services/packageService.js';
import { MODULE_BY_KEY } from './config/features.js';
import { updateCapacityBanner } from './components/capacityBanner.js';
import { refreshClassScope } from './services/teacherService.js';

const routes = [];

export function registerRoute(pattern, render) {
  routes.push({ pattern, render });
}

function parseHash() {
  let hash = window.location.hash.slice(1) || '/';
  const [pathPart, queryPart] = hash.split('?');
  const path = pathPart || '/';
  const query = {};
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((value, key) => {
      query[key] = value;
    });
  }
  return { path, query };
}

function matchRoute(path) {
  const pathSegments = path.split('/').filter((s) => s !== '' || path === '/');
  for (const route of routes) {
    const patternSegments = route.pattern.split('/').filter((s) => s !== '' || route.pattern === '/');
    if (patternSegments.length !== pathSegments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patternSegments.length; i++) {
      const p = patternSegments[i];
      const s = pathSegments[i];
      if (p.startsWith(':')) {
        params[p.slice(1)] = decodeURIComponent(s);
      } else if (p !== s) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

let contentEl = null;
let hashListener = null;
let stopAccessWatch = () => {};

// Forgets all routes and stops listening, so the app can be started again
// after signing out and back in without duplicate routes or handlers.
export function resetRouter() {
  routes.length = 0;
  if (hashListener) window.removeEventListener('hashchange', hashListener);
  hashListener = null;
}

export function startRouter(el, onNavigate) {
  contentEl = el;
  hashListener = () => render(onNavigate);
  window.addEventListener('hashchange', hashListener);
  render(onNavigate);
}

async function render(onNavigate) {
  const { path, query } = parseHash();
  await refreshClassScope().catch(() => {});
  const matched = matchRoute(path);
  if (onNavigate) onNavigate(path);
  if (!matched) {
    contentEl.innerHTML = `<div class="card card-p"><p class="text-sm text-ink-500">Page not found.</p></div>`;
    return;
  }
  stopAccessWatch();
  stopAccessWatch = () => {};
  const moduleKey = moduleForPath(path);
  updateCapacityBanner(contentEl).catch(() => {});
  // Not in this school's package: say so plainly. Records are kept, never deleted.
  if (!moduleEnabled(moduleKey)) {
    contentEl.innerHTML = `<div class="card card-p" style="max-width:34rem;"><h1 class="text-lg" style="font-weight:600;">Not included in your package</h1><p class="text-sm text-ink-500 mt-2">${MODULE_BY_KEY[moduleKey]?.label ?? 'This area'} isn't switched on for your school's current subscription${lowestPackageWith(moduleKey) ? `. It comes with the ${lowestPackageWith(moduleKey).name} package and above` : ''}. Nothing has been deleted — your records are kept and return as soon as it is enabled.</p><p class="mt-4"><a class="btn btn-secondary" href="#/">Back to dashboard</a> <a class="btn btn-primary" href="#/subscription">View subscription</a></p></div>`;
    return;
  }
  if (!canAccessModule(moduleKey)) {
    contentEl.innerHTML = `<div class="card card-p" style="max-width:34rem;"><h1 class="text-lg" style="font-weight:600;">This page isn't part of your role</h1><p class="text-sm text-ink-500 mt-2">Your account (${roleLabel()}) doesn't include this area. If you need it, ask your school administrator to change your role.</p><p class="mt-4"><a class="btn btn-secondary" href="#/">Back to dashboard</a></p></div>`;
    return;
  }
  matched.route.render(contentEl, { ...matched.params, ...query });
  // Hide add/edit/delete controls on pages this role can only look at.
  stopAccessWatch = applyAccessToContainer(contentEl, moduleKey);
  // Once per navigation, not per in-page re-render (typing, filtering, etc),
  // which is why this lives here rather than inside each feature's render().
  replayEntrance(contentEl);
}
