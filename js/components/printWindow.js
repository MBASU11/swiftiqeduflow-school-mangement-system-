// Prints a standalone HTML fragment (timetable, report cards...) from a hidden
// iframe so the app chrome never leaks into the page and we control paper size,
// margins and page breaks. Works for "Save as PDF" in the browser print dialog too.

const BASE_CSS = `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:Inter,"Segoe UI",Roboto,Arial,sans-serif;color:#1b2430;font-size:11pt;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  h1,h2,h3{font-family:Georgia,"Times New Roman",serif;margin:0}
  table{border-collapse:collapse;width:100%}
`;

export function printHtml(title, bodyHtml, { css = '', orientation = 'portrait', margin = '12mm' } = {}) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win.document;
  doc.open();
  doc.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeTitle(title)}</title>
    <style>@page{size:A4 ${orientation};margin:${margin}}${BASE_CSS}${css}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();

  const cleanup = () => setTimeout(() => iframe.remove(), 1000);
  const run = () => {
    try {
      win.focus();
      win.addEventListener('afterprint', cleanup, { once: true });
      win.print();
    } catch {
      cleanup();
    }
  };
  // Give images (school logo) a moment to decode before printing.
  const images = Array.from(doc.images);
  Promise.all(images.map((img) => (img.complete ? null : new Promise((resolve) => { img.onload = img.onerror = resolve; }))))
    .then(() => setTimeout(run, 150));
}

function escapeTitle(value) {
  return String(value ?? '').replace(/[<>&]/g, '');
}
