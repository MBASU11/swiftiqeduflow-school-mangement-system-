// Parent-facing page: opens one shared report card from its private link (?t=token).
import { fetchSharedReportCard } from './services/reportCardService.js';
import { reportCardPageHtml, REPORT_CARD_CSS } from './components/reportCardDocument.js';
import { printHtml } from './components/printWindow.js';
import { isSupabaseConfigured } from './config/supabase.js';

const app = document.getElementById('app');
const printBtn = document.getElementById('print-btn');
const message = (text) => { app.innerHTML = `<p class="msg"></p>`; app.firstChild.textContent = text; };

(async () => {
  const token = new URLSearchParams(window.location.search).get('t');
  if (!token) return message('This link is incomplete. Please use the link the school sent you.');
  if (!isSupabaseConfigured()) return message('This school portal is not connected yet.');
  try {
    const model = await fetchSharedReportCard(token);
    if (!model) return message('This report card is no longer available. Please contact the school.');
    const style = document.createElement('style');
    style.textContent = REPORT_CARD_CSS;
    document.head.appendChild(style);
    document.title = `${model.student.name} – report card`;
    app.innerHTML = reportCardPageHtml(model);
    printBtn.hidden = false;
    printBtn.addEventListener('click', () => printHtml(document.title, reportCardPageHtml(model), { css: REPORT_CARD_CSS, margin: '10mm' }));
  } catch {
    message('We could not load this report card. Please check your connection and try again.');
  }
})();
