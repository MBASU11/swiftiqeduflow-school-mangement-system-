// Generic helpers for turning a messy school spreadsheet into clean records:
// finding the header row, matching columns to fields, and cleaning values.

export const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
export const isBlank = (value) => text(value) === '';

// ---- Header row + column mapping --------------------------------------------

// Schools often put a title ("MWANGAZA ACADEMY - GRADE 4 LIST") above the table,
// so look at the first rows and pick the one that looks most like a header.
export function detectHeaderRow(rows, fields) {
  const known = new Set(fields.flatMap((f) => [norm(f.label), norm(f.key), ...(f.aliases ?? []).map(norm)]));
  let best = { index: 0, score: -1 };
  rows.slice(0, 15).forEach((row, index) => {
    const cells = row.map(norm).filter(Boolean);
    const score = cells.filter((cell) => known.has(cell)).length;
    if (score > best.score && cells.length >= 2) best = { index, score };
  });
  return best.score > 0 ? best.index : 0;
}

// Returns { [fieldKey]: columnIndex | -1 }. Exact matches win; then "contains"
// matches for longer aliases (so "Maths Score" still finds Mathematics).
export function autoMap(headers, fields) {
  const normalized = headers.map(norm);
  const taken = new Set();
  const mapping = Object.fromEntries(fields.map((f) => [f.key, -1]));
  const names = (f) => [norm(f.label), norm(f.key.replace(/^subject:/, '')), ...(f.aliases ?? []).map(norm)].filter(Boolean);

  fields.forEach((field) => {
    const index = normalized.findIndex((header, i) => !taken.has(i) && header && names(field).includes(header));
    if (index !== -1) { mapping[field.key] = index; taken.add(index); }
  });
  fields.forEach((field) => {
    if (mapping[field.key] !== -1) return;
    const index = normalized.findIndex((header, i) => !taken.has(i) && header && names(field).some((n) => n.length >= 4 && header.includes(n)));
    if (index !== -1) { mapping[field.key] = index; taken.add(index); }
  });
  // Abbreviations: "MATHS" / "ENG" / "KISW" are prefixes of Mathematics / English / Kiswahili.
  fields.forEach((field) => {
    if (mapping[field.key] !== -1) return;
    const index = normalized.findIndex((header, i) => {
      if (taken.has(i) || header.length < 3) return false;
      const stems = [header, header.endsWith('s') ? header.slice(0, -1) : header].filter((h) => h.length >= 3);
      return names(field).some((n) => n.length > header.length && stems.some((stem) => n.startsWith(stem)));
    });
    if (index !== -1) { mapping[field.key] = index; taken.add(index); }
  });
  return mapping;
}

// Applies the mapping to the data rows. Returns [{ rowNumber, values, original }]
// where rowNumber is the 1-based row in the spreadsheet (what the user sees).
export function extractRows(rows, headerIndex, mapping) {
  const out = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const original = rows[i];
    if (original.every(isBlank)) continue;
    const values = {};
    Object.entries(mapping).forEach(([key, column]) => { values[key] = column >= 0 ? original[column] ?? '' : ''; });
    if (Object.values(values).every(isBlank)) continue;
    out.push({ rowNumber: i + 1, values, original });
  }
  return out;
}

export function unusedColumns(headers, mapping) {
  const used = new Set(Object.values(mapping));
  return headers.map((header, index) => ({ header: text(header), index })).filter(({ header, index }) => header && !used.has(index)).map(({ header }) => header);
}

// ---- Value cleaners ------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const validDate = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const fullYear = (y) => (y < 100 ? (y > 30 ? 1900 + y : 2000 + y) : y);

// Returns 'YYYY-MM-DD' or null. Handles Excel serial numbers, ISO, day-first
// dates (12/03/2015, 12-3-15, 12.03.2015) and "12 March 2015".
export function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    if (value < 1000 || value > 80000) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (!raw) return null;
  let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
  m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let day = +m[1];
    let month = +m[2];
    if (month > 12 && day <= 12) [day, month] = [month, day]; // clearly month-first
    const year = fullYear(+m[3]);
    return validDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
  }
  m = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-,.]+([A-Za-z]{3,9})[\s\-,.]+(\d{2,4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const year = fullYear(+m[3]);
    return month && validDate(year, month, +m[1]) ? `${year}-${pad(month)}-${pad(m[1])}` : null;
  }
  return null;
}

// Excel drops the leading 0 of phone numbers stored as numbers (712345678).
export function cleanPhone(value) {
  if (typeof value === 'number') {
    const digits = String(Math.round(value));
    return digits.length === 9 ? `0${digits}` : digits;
  }
  const raw = text(value);
  if (!raw) return '';
  const first = raw.split(/[\/;,]| or | and /i)[0].trim(); // "0712.. / 0733.." -> first number
  const digits = first.replace(/[^\d+]/g, '');
  if (/^[17]\d{8}$/.test(digits)) return `0${digits}`;
  return digits || first;
}

export const phoneKey = (value) => {
  const digits = cleanPhone(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  return digits;
};

export const cleanEmail = (value) => {
  const raw = text(value).toLowerCase();
  return raw;
};
export const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function cleanGender(value) {
  const g = norm(value);
  if (!g) return '';
  if (['m', 'male', 'boy', 'man', 'b'].includes(g)) return 'male';
  if (['f', 'female', 'girl', 'woman', 'g'].includes(g)) return 'female';
  return null; // unrecognised
}

export function cleanAdmission(value) {
  if (typeof value === 'number') return String(Math.round(value));
  return text(value);
}

export function splitName(full) {
  const parts = text(full).split(' ').filter(Boolean);
  if (parts.length === 0) return { firstName: '', middleName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], middleName: '', lastName: '' };
  if (parts.length === 2) return { firstName: parts[0], middleName: '', lastName: parts[1] };
  return { firstName: parts[0], middleName: parts.slice(1, -1).join(' '), lastName: parts[parts.length - 1] };
}

// "Otieno Amani" vs "Amani Otieno": compare names as a sorted set of words.
export const nameKey = (value) => text(value).toLowerCase().split(/[\s,]+/).filter(Boolean).sort().join(' ');

export function cleanNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = text(value).replace(/,/g, '').replace(/%$/, '');
  if (raw === '' || !/^-?\d*\.?\d+$/.test(raw)) return null;
  return Number(raw);
}

// Splits "Maths, English; Science / CRE" style cells.
export const splitList = (value) => text(value).split(/[,;\/&\n]+| and /i).map(text).filter(Boolean);

// ---- Class / stream matching -------------------------------------------------

// Finds a class for "Grade 1", "grade1", "GRADE 1 A" (-> Grade 1 + stream A) or "1".
export function resolveClass(value, classes) {
  const key = norm(value);
  if (!key) return null;
  const exact = classes.find((c) => norm(c.name) === key);
  if (exact) return { class: exact, rest: '' };
  const prefixed = [...classes]
    .sort((a, b) => norm(b.name).length - norm(a.name).length)
    .find((c) => key.startsWith(norm(c.name)) && key.length > norm(c.name).length);
  if (prefixed) {
    const rest = text(value).replace(new RegExp(`^\\s*${text(prefixed.name).split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*')}[\\s\\-_/]*`, 'i'), '').trim();
    return { class: prefixed, rest: rest || key.slice(norm(prefixed.name).length).toUpperCase() };
  }
  if (/^\d+$/.test(key)) {
    const matches = classes.filter((c) => new RegExp(`(^|[^0-9])${key}$`).test(text(c.name)));
    if (matches.length === 1) return { class: matches[0], rest: '' };
  }
  return null;
}

// ---- Export naming -------------------------------------------------------------

export const fileStamp = () => new Date().toISOString().slice(0, 10);
export const safeFileName = (value) => text(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'export';
