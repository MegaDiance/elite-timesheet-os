/**
 * Reading a staff spreadsheet in the browser: CSV parsing, header handling, column guesses and
 * mapping. Runs with Node's own test runner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileKind, guessMapping, mapRows, parseCsv, splitHeader } from '../src/utils/staffImport.ts';

describe('parseCsv', () => {
  it('reads plain rows with CRLF or LF line ends', () => {
    assert.deepEqual(parseCsv('a,b\r\nc,d\ne,f'), [['a', 'b'], ['c', 'd'], ['e', 'f']]);
  });

  it('handles quoted commas, doubled quotes and line breaks inside quotes', () => {
    assert.deepEqual(parseCsv('name,notes\n"Smith, Alex","said ""hi""\nthen left"\n'), [
      ['name', 'notes'],
      ['Smith, Alex', 'said "hi"\nthen left'],
    ]);
  });

  it('ignores a byte-order mark and blank lines, and keeps empty fields', () => {
    assert.deepEqual(parseCsv('﻿name,email\n\nAlex,\n,,\n'), [['name', 'email'], ['Alex', '']]);
  });

  it('keeps a last line without a line end', () => {
    assert.deepEqual(parseCsv('a\nb'), [['a'], ['b']]);
  });
});

describe('splitHeader', () => {
  it('names missing headers and pads short rows', () => {
    const { headers, rows } = splitHeader([['Name', ''], ['Alex', 'x', 'extra'], ['Sam']]);
    assert.deepEqual(headers, ['Name', 'Column 2', 'Column 3']);
    assert.deepEqual(rows, [['Alex', 'x', 'extra'], ['Sam', '', '']]);
  });

  it('turns numbers and dates from a spreadsheet into text', () => {
    const { rows } = splitHeader([['Hours', 'Start'], [76, new Date('2026-01-05T00:00:00Z')]]);
    assert.deepEqual(rows, [['76', '2026-01-05']]);
  });
});

describe('guessMapping', () => {
  it('recognises the usual header names, whatever the case', () => {
    const mapping = guessMapping(['Staff ID', 'Employee Name', 'LOCATION', 'E-mail', 'Mobile', 'Dept', 'Hours']);
    assert.deepEqual(mapping, { full_name: 1, branch: 2, employee_code: 0, email: 3, phone: 4, department: 5, contracted_hours: 6 });
  });

  it('leaves unknown columns unmapped and never uses a column twice', () => {
    const mapping = guessMapping(['Name', 'Name', 'Favourite colour']);
    assert.equal(mapping.full_name, 0);
    assert.equal(Object.values(mapping).filter(v => v === 1).length, 0);
  });
});

describe('mapRows', () => {
  it('numbers rows as the spreadsheet shows them, and sends unmapped fields empty', () => {
    const rows = mapRows([['Alex', 'Melbourne'], ['  Sam ', '']], { full_name: 0, branch: 1 });
    assert.deepEqual(rows[0], { row: 2, full_name: 'Alex', branch: 'Melbourne', department: '', email: '', phone: '', contracted_hours: '', employee_code: '' });
    assert.equal(rows[1].row, 3);
    assert.equal(rows[1].full_name, 'Sam');
  });
});

describe('fileKind', () => {
  it('accepts CSV and XLSX only', () => {
    assert.equal(fileKind('Staff.CSV'), 'csv');
    assert.equal(fileKind('staff list.xlsx'), 'xlsx');
    assert.equal(fileKind('staff.xls'), null);
    assert.equal(fileKind('staff.numbers'), null);
  });
});
