/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starting with = + - @, a tab or a
 * carriage return) is prefixed with an apostrophe, so a name like "=HYPERLINK(...)" imported or
 * typed into SimpleHours stays text when the export is opened. Numbers are left as numbers.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
