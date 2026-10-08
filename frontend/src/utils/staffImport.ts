/**
 * Reading a staff spreadsheet in the browser, before anything is sent to the server.
 *
 * The file never leaves the browser as a file: it is parsed here into rows of text, the person maps
 * their columns to SimpleHours fields, and only those values are sent for validation. The server
 * checks every value again and is the only authority (routes/employeeImport.ts).
 */

export type ImportField = 'full_name' | 'branch' | 'department' | 'email' | 'phone' | 'contracted_hours' | 'employee_code';

export const IMPORT_FIELDS: ReadonlyArray<{ key: ImportField; label: string; required?: boolean; hint: string }> = [
  { key: 'full_name', label: 'Full name', required: true, hint: 'e.g. Alex Smith' },
  { key: 'branch', label: 'Branch', hint: 'The branch name, as it appears in SimpleHours' },
  { key: 'employee_code', label: 'Employee ID', hint: 'Your own staff number (optional)' },
  { key: 'email', label: 'Email', hint: 'Optional' },
  { key: 'phone', label: 'Phone', hint: 'Optional' },
  { key: 'department', label: 'Department', hint: 'Optional' },
  { key: 'contracted_hours', label: 'Contracted hours (fortnight)', hint: 'Defaults to 76' },
];

/** Words people use for each field in their own spreadsheets, to suggest a mapping. */
const HEADER_GUESSES: Record<ImportField, RegExp> = {
  full_name: /^(full\s*name|name|employee(\s*name)?|staff(\s*name)?|worker(\s*name)?)$/i,
  branch: /^(branch|location|site|store|venue|clinic)(\s*name)?$/i,
  department: /^(department|dept|team|area)$/i,
  email: /^(e-?mail(\s*address)?)$/i,
  phone: /^(phone|mobile|cell|telephone|phone\s*number|mobile\s*number)$/i,
  contracted_hours: /^(contracted\s*hours|hours|fortnight(ly)?\s*hours|contract(ed)?)$/i,
  employee_code: /^(employee\s*(id|code|number|no\.?)|staff\s*(id|code|number|no\.?)|id|code|payroll\s*(id|number))$/i,
};

export const MAX_IMPORT_ROWS = 5000;

/**
 * RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks; CRLF or LF line ends;
 * a leading byte-order mark is ignored. Completely empty lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    if (row.some(cell => cell.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (src[i + 1] === '\n') i++; endRow(); }
    else field += ch;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** The first row is the header; every cell is text, trimmed. */
export function splitHeader(table: unknown[][]): { headers: string[]; rows: string[][] } {
  const text = table.map(r => r.map(cellText));
  const [headers = [], ...rows] = text;
  const width = Math.max(headers.length, ...rows.map(r => r.length));
  const named = Array.from({ length: width }, (_, i) => headers[i]?.trim() || `Column ${i + 1}`);
  return { headers: named, rows: rows.map(r => Array.from({ length: width }, (_, i) => r[i] ?? '')) };
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** A suggested column for each field, from the header names. Each column is used at most once. */
export function guessMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const mapping: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  for (const { key } of IMPORT_FIELDS) {
    const index = headers.findIndex((h, i) => !used.has(i) && HEADER_GUESSES[key].test(h.trim()));
    if (index >= 0) { mapping[key] = index; used.add(index); }
  }
  return mapping;
}

export interface ImportRow {
  /** The row number as the person sees it in their spreadsheet (header is row 1). */
  row: number;
  full_name: string;
  branch: string;
  department: string;
  email: string;
  phone: string;
  contracted_hours: string;
  employee_code: string;
}

/** Applies a mapping. Fields that aren't mapped are sent empty. */
export function mapRows(rows: string[][], mapping: Partial<Record<ImportField, number>>): ImportRow[] {
  const pick = (r: string[], field: ImportField) => (mapping[field] === undefined ? '' : (r[mapping[field]!] ?? '').trim());
  return rows.map((r, i) => ({
    row: i + 2,
    full_name: pick(r, 'full_name'),
    branch: pick(r, 'branch'),
    department: pick(r, 'department'),
    email: pick(r, 'email'),
    phone: pick(r, 'phone'),
    contracted_hours: pick(r, 'contracted_hours'),
    employee_code: pick(r, 'employee_code'),
  }));
}

export type FileKind = 'csv' | 'xlsx' | null;

export function fileKind(name: string): FileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}
