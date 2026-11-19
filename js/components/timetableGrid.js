import { escapeHtml } from './dom.js';
import { DAYS, isBreak } from '../services/timetableService.js';

export const TIMETABLE_CSS = `
.tt-grid{width:100%;border-collapse:collapse;table-layout:fixed;font-size:0.82rem}
.tt-grid th,.tt-grid td{border:1px solid #cfd6df;padding:0.4rem 0.45rem;vertical-align:top;text-align:left}
.tt-grid thead th{background:#1f3a5f;color:#fff;font-weight:600;text-align:center}
.tt-grid .tt-time{width:6.2rem;background:#f1f4f8;font-weight:600;white-space:nowrap;text-align:center;vertical-align:middle}
.tt-grid thead th.tt-time{background:#1f3a5f;color:#fff}
.tt-grid .tt-subject{font-weight:600}
.tt-grid .tt-meta{color:#5b6777;font-size:0.74rem;margin-top:0.1rem}
.tt-grid .tt-break td.tt-break-cell,.tt-grid td.tt-break-cell{background:#fdf3d8;color:#7a5a00;text-align:center;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;font-size:0.74rem;vertical-align:middle}
.tt-grid .tt-empty{color:#b3bcc8;text-align:center}
.tt-grid .tt-editable{cursor:pointer}
.tt-grid .tt-editable:hover{background:#eaf1fb}
.tt-grid td.tt-break-cell.tt-editable:hover{background:#fbe9b5}
@media (max-width:640px){.tt-grid{font-size:0.72rem}.tt-grid .tt-time{width:4.6rem}}
`;

const timeText = (e) => `${e.startTime}–${e.endTime}`;

// entries: timetable entries for ONE view (a class, a teacher or a student's class).
// describe(entry) -> { title, meta } for lesson cells. Breaks use entry.label.
export function timetableGridHtml(entries, { describe, editable = false } = {}) {
  const hasSaturday = entries.some((e) => e.day === 'SA');
  const days = DAYS.filter(([code]) => code !== 'SA' || hasSaturday);
  const slotKey = (e) => `${e.startTime}|${e.endTime}`;
  const slots = [...new Set(entries.map(slotKey))].sort();
  const byCell = new Map();
  entries.forEach((e) => {
    const key = `${e.day}|${slotKey(e)}`;
    byCell.set(key, [...(byCell.get(key) ?? []), e]);
  });

  const editAttr = (e) => (editable ? ` data-tt-edit="${e.id}"` : '');
  const editClass = editable ? ' tt-editable' : '';

  const rows = slots.map((slot) => {
    const [start, end] = slot.split('|');
    const cells = days.map(([code]) => byCell.get(`${code}|${slot}`) ?? []);
    const present = cells.filter((list) => list.length);
    const allBreaks = present.length > 0 && present.every((list) => list.every(isBreak));
    const timeCell = `<td class="tt-time">${escapeHtml(start)}<br>${escapeHtml(end)}</td>`;

    // Same break on every day: one full-width band, like a printed school timetable.
    if (allBreaks && present.length === days.length) {
      const labels = [...new Set(present.flat().map((e) => e.label || 'Break'))];
      const first = present[0][0];
      return `<tr class="tt-break">${timeCell}<td class="tt-break-cell${editClass}" colspan="${days.length}"${editAttr(first)}>${escapeHtml(labels.join(' / '))}</td></tr>`;
    }

    const tds = cells.map((list, index) => {
      if (!list.length) {
        const add = editable ? ` data-tt-add="${days[index][0]}|${start}|${end}" class="tt-empty tt-editable"` : ' class="tt-empty"';
        return `<td${add}>${editable ? '+' : ''}</td>`;
      }
      if (list.every(isBreak)) {
        return `<td class="tt-break-cell${editClass}"${editAttr(list[0])}>${escapeHtml(list[0].label || 'Break')}</td>`;
      }
      return `<td class="${editClass.trim()}"${editAttr(list[0])}>${list
        .map((e) => {
          const d = describe ? describe(e) : { title: '—', meta: '' };
          return `<div class="tt-subject">${escapeHtml(d.title)}</div>${d.meta ? `<div class="tt-meta">${escapeHtml(d.meta)}</div>` : ''}`;
        })
        .join('')}</td>`;
    });
    return `<tr>${timeCell}${tds.join('')}</tr>`;
  });

  return `<table class="tt-grid"><thead><tr><th class="tt-time">Time</th>${days.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

let stylesInjected = false;
export function ensureTimetableStyles() {
  if (stylesInjected || document.getElementById('tt-grid-styles')) return;
  const style = document.createElement('style');
  style.id = 'tt-grid-styles';
  style.textContent = TIMETABLE_CSS;
  document.head.appendChild(style);
  stylesInjected = true;
}

export function printableTimetable({ school, heading, subheading, gridHtml }) {
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `
    <header style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1f3a5f;padding-bottom:8px;margin-bottom:12px">
      <div>
        <h1 style="font-size:18pt;color:#1f3a5f">${escapeHtml(school?.name ?? 'School')}</h1>
        <div style="font-size:9pt;color:#5b6777">${escapeHtml([school?.address, school?.phone].filter(Boolean).join(' · '))}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:14pt;font-weight:700">${escapeHtml(heading)}</div>
        <div style="font-size:9pt;color:#5b6777">${escapeHtml(subheading ?? '')}</div>
      </div>
    </header>
    ${gridHtml}
    <footer style="margin-top:10px;font-size:8pt;color:#7b8794;display:flex;justify-content:space-between">
      <span>Printed ${escapeHtml(today)}</span><span>SwiftIQ EduFlow</span>
    </footer>`;
}
