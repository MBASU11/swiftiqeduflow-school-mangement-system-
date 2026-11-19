const wrap = (inner, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const icons = {
  grid: (s) => wrap('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', s),
  users: (s) => wrap('<circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6"/><circle cx="17" cy="8" r="2.5"/><path d="M17 12.2c2.6.5 4.5 2.6 4.5 5.3"/>', s),
  clipboard: (s) => wrap('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 011-1h4a1 1 0 011 1v1"/><path d="M9 11h6M9 15h6"/>', s),
  book: (s) => wrap('<path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 014 18.5v-13z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 001.5-1.5v-13z"/>', s),
  calendarCheck: (s) => wrap('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M9 15l2 2 4-4"/>', s),
  table: (s) => wrap('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>', s),
  award: (s) => wrap('<circle cx="12" cy="8" r="5"/><path d="M8.5 12.5L7 21l5-2.5L17 21l-1.5-8.5"/>', s),
  wallet: (s) => wrap('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1"/>', s),
  megaphone: (s) => wrap('<path d="M3 10v4a1 1 0 001 1h2l7 4V5L6 9H4a1 1 0 00-1 1z"/><path d="M17 9a4 4 0 010 6"/>', s),
  barChart: (s) => wrap('<path d="M4 20V10M12 20V4M20 20v-7"/><path d="M2 20h20"/>', s),
  bus: (s) => wrap('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M3 12h18"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="16.5" cy="19" r="1.5"/>', s),
  library: (s) => wrap('<path d="M4 4v16M8 4v16M4 4h4M4 20h4"/><path d="M13 5l6 1.2v14l-6-1.2z"/>', s),
  box: (s) => wrap('<path d="M3.5 7.5L12 3l8.5 4.5V16.5L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>', s),
  shield: (s) => wrap('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>', s),
  activity: (s) => wrap('<path d="M3 12h4l2-7 4 14 2-7h6"/>', s),
  briefcase: (s) => wrap('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5.5A1.5 1.5 0 019.5 4h5A1.5 1.5 0 0116 5.5V7"/>', s),
  transfer: (s) => wrap('<path d="M7 4v13M3.5 13.5L7 17l3.5-3.5"/><path d="M17 20V7M13.5 10.5L17 7l3.5 3.5"/>', s),
  folder: (s) => wrap('<path d="M3 6.5A1.5 1.5 0 014.5 5h4l2 2h9a1.5 1.5 0 011.5 1.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z"/>', s),
  settings: (s) => wrap('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.2-1.6l2-1.5-2-3.4-2.3.9a7 7 0 00-2.8-1.6L13.3 2h-2.6l-.4 2.8a7 7 0 00-2.8 1.6l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .5.05 1 .2 1.6l-2 1.5 2 3.4 2.3-.9a7 7 0 002.8 1.6l.4 2.8h2.6l.4-2.8a7 7 0 002.8-1.6l2.3.9 2-3.4-2-1.5c.15-.6.2-1.1.2-1.6z"/>', s),
  search: (s) => wrap('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', s),
  bell: (s) => wrap('<path d="M6 9a6 6 0 1112 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z"/><path d="M10 19a2 2 0 004 0"/>', s),
  menu: (s) => wrap('<path d="M4 7h16M4 12h16M4 17h16"/>', s),
  chevronDown: (s) => wrap('<path d="M6 9l6 6 6-6"/>', s),
  wifiOff: (s) => wrap('<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 017 0"/><path d="M5 13a10 10 0 013.5-2.3M19 13a10 10 0 00-2.7-2M12 20h.01"/>', s),
};
