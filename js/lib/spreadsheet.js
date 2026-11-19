// Reads and writes Excel (.xlsx/.xls) and CSV files in the browser using SheetJS,
// loaded on demand so the rest of the app keeps its no-build, no-install setup.
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
let xlsxPromise;

export function loadXlsx() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX); // tests / pre-loaded
  xlsxPromise ??= import(XLSX_URL).then((module) => module.default ?? module);
  return xlsxPromise;
}

// Returns every non-empty sheet as an array of rows (arrays of cell values).
// Dates are NOT converted here: Excel stores them as serial numbers, and the
// import logic converts them only for columns that are known to hold dates.
export async function readSpreadsheet(fileOrBuffer) {
  const X = await loadXlsx();
  const buffer = fileOrBuffer.arrayBuffer ? await fileOrBuffer.arrayBuffer() : fileOrBuffer;
  let workbook;
  try {
    workbook = X.read(buffer, { type: 'array', cellDates: false });
  } catch {
    throw new Error('That file could not be read. Please upload an Excel (.xlsx, .xls) or CSV file.');
  }
  const sheets = workbook.SheetNames
    .map((name) => ({
      name,
      rows: X.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false }),
    }))
    .filter((sheet) => sheet.rows.some((row) => row.some((cell) => String(cell).trim() !== '')));
  if (!sheets.length) throw new Error('That file is empty.');
  return sheets;
}

// sheets: [{ name, rows: any[][], widths?: number[] }]
export async function downloadWorkbook(sheets, fileName, { csv = false } = {}) {
  const X = await loadXlsx();
  const workbook = X.utils.book_new();
  (csv ? sheets.slice(0, 1) : sheets).forEach((sheet) => {
    const worksheet = X.utils.aoa_to_sheet(sheet.rows);
    const columnCount = Math.max(0, ...sheet.rows.map((row) => row.length));
    worksheet['!cols'] = Array.from({ length: columnCount }, (_, index) => ({
      wch: sheet.widths?.[index] ?? Math.min(40, Math.max(10, ...sheet.rows.slice(0, 60).map((row) => String(row[index] ?? '').length + 2))),
    }));
    X.utils.book_append_sheet(workbook, worksheet, sheet.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  });
  const name = `${fileName}.${csv ? 'csv' : 'xlsx'}`;
  X.writeFile(workbook, name, csv ? { bookType: 'csv' } : undefined);
  return name;
}
