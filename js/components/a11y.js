// Gives every form control an accessible name, once and for all screens, including controls drawn later by a redraw.
// Screens should still write proper <label for>; this is the safety net so a missed label never leaves a screen reader user guessing.
const NAMES = { 'class-select': 'Class', 'class-filter': 'Filter by class', 'sort-key': 'Sort by', 'subject-filter': 'Filter by subject', 'status-filter': 'Filter by status', 'date-input': 'Date', 'school-search': 'Search schools', search: 'Search' };
const CONTROLS = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea';
let seq = 0;

function nameFor(el) {
  const first = el.tagName === 'SELECT' ? el.options[0]?.textContent.trim() : '';
  return NAMES[el.id] || el.getAttribute('placeholder') || el.title || first || '';
}
function enhanceControl(el) {
  if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && el.labels.length)) return;
  const prev = el.previousElementSibling; const parent = el.parentElement;
  let label = prev && prev.tagName === 'LABEL' && !prev.htmlFor ? prev : null;
  if (!label && parent) { const only = parent.querySelectorAll(':scope > label:not([for])'); if (only.length === 1 && parent.querySelectorAll(':scope > input, :scope > select, :scope > textarea').length === 1) label = only[0]; }
  if (label && !label.querySelector(CONTROLS)) { if (!el.id) el.id = `auto-${++seq}`; label.htmlFor = el.id; return; }
  const text = nameFor(el); if (text) el.setAttribute('aria-label', text);
}
function enhanceScrollers(root) {
  root.querySelectorAll('.overflow-x-auto').forEach((el) => {
    if (el.hasAttribute('tabindex') || el.querySelector('a, button, input, select, textarea')) return;
    if (el.scrollWidth > el.clientWidth + 1) { el.tabIndex = 0; el.setAttribute('role', 'region'); if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.querySelector('caption')?.textContent || 'Scrollable table'); }
  });
}
export function enhance(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches?.(CONTROLS)) enhanceControl(root);
  root.querySelectorAll?.(CONTROLS).forEach(enhanceControl);
  enhanceScrollers(root);
}
export function installA11y(target = document.body) {
  enhance(target);
  let queued = new Set();
  const flush = () => { const nodes = [...queued]; queued = new Set(); nodes.forEach((n) => { if (n.isConnected) enhance(n); }); };
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => { if (n.nodeType === 1) queued.add(n); });
    if (queued.size) requestAnimationFrame(flush);
  }).observe(target, { childList: true, subtree: true });
}
