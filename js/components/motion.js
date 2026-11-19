// Small, dependency-free motion helpers. Everything here is CSS-driven
// (transforms, transitions, keyframes) — these utilities just toggle classes
// and animate numbers; the actual look lives in css/styles.css. Every helper
// checks prefers-reduced-motion and short-circuits to the end state.

export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Adds .in-view to elements with the .reveal class as they scroll into sight
// (landing-page sections, feature/plan cards). Call once per container after
// its HTML is in the DOM; safe to call repeatedly — already-visible elements
// are skipped.
export function revealOnScroll(root = document) {
  const targets = Array.from(root.querySelectorAll('.reveal:not(.in-view)'));
  if (targets.length === 0) return;
  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('in-view'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );
  targets.forEach((el) => observer.observe(el));
}

// Animates a number counting up to its target over ~700ms. `format` lets a
// caller keep prefixes/suffixes (e.g. currency) intact while the digits move.
export function animateCount(el, target, { duration = 700, format = (n) => String(n) } = {}) {
  if (!el) return;
  const value = Number(target) || 0;
  if (prefersReducedMotion()) {
    el.textContent = format(value);
    return;
  }
  const start = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
    el.textContent = format(Math.round(value * eased));
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Restarts a CSS entrance animation on an element — used once per route
// change so page content fades in on navigation without re-triggering on
// every re-render inside a page (typing in a search box, etc).
export function replayEntrance(el, className = 'route-enter') {
  if (!el || prefersReducedMotion()) return;
  el.classList.remove(className);
  // eslint-disable-next-line no-unused-expressions
  void el.offsetWidth; // force reflow so the class can be re-added and animate again
  el.classList.add(className);
}
