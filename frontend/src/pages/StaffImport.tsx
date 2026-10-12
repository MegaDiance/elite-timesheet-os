import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import api from '../services/apiClient';
import { friendlyError } from '../services/errors';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import {
  IMPORT_FIELDS, MAX_IMPORT_ROWS, fileKind, guessMapping, mapRows, parseCsv, splitHeader,
  type ImportField, type ImportRow,
} from '../utils/staffImport';

interface RowIssue { field: string; message: string }
interface CheckedRow {
  row: number;
  errors: RowIssue[];
  value: { full_name: string; branch_name: string; employee_code: string | null; email: string | null; contracted_hours: number } | null;
}
type Step = 'upload' | 'map' | 'review' | 'importing' | 'done';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FIELD_LABEL: Record<string, string> = Object.fromEntries(IMPORT_FIELDS.map(f => [f.key, f.label]));
const TEMPLATE = 'Full name,Branch,Employee ID,Email,Phone,Department,Contracted hours\nAlex Smith,Melbourne,E001,alex@example.com,0400 000 000,Front desk,76\n';

/**
 * Staff → Import. Upload a spreadsheet, match its columns, check it, see what will be added,
 * then import. The server checks every row again and imports all of them or none.
 */
export default function StaffImport() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const [checked, setChecked] = useState<CheckedRow[] | null>(null);
  const [mapped, setMapped] = useState<ImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [imported, setImported] = useState(0);

  const readFile = async (file: File) => {
    setError(null);
    const kind = fileKind(file.name);
    if (!kind) { setError('Choose a CSV or .xlsx file. Save older .xls files as .xlsx first.'); return; }
    if (file.size > MAX_FILE_BYTES) { setError('File is over 10 MB. Split it into smaller files.'); return; }
    setBusy(true);
    try {
      let table: unknown[][];
      if (kind === 'csv') table = parseCsv(await file.text());
      else {
        // Loaded only when someone imports a spreadsheet.
        const { readSheet } = await import('read-excel-file/browser');
        table = await readSheet(file) as unknown[][];
      }
      const { headers: h, rows } = splitHeader(table);
      if (rows.length === 0) { setError('No rows found under the header row.'); return; }
      if (rows.length > MAX_IMPORT_ROWS) { setError(`File has ${rows.length} rows. Import up to ${MAX_IMPORT_ROWS} at a time.`); return; }
      setFileName(file.name);
      setHeaders(h);
      setRawRows(rows);
      setMapping(guessMapping(h));
      setChecked(null);
      setStep('map');
    } catch {
      setError('Couldn’t read that file. Check it opens in your spreadsheet app.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void readFile(f); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); };

  const check = async () => {
    if (mapping.full_name === undefined) { setError('Choose the Full name column.'); return; }
    setError(null);
    setBusy(true);
    const rows = mapRows(rawRows, mapping);
    try {
      const res = await api.post('/staff-import/validate', { rows });
      setMapped(rows);
      setChecked(res.data.data.rows);
      setStep('review');
    } catch (err) {
      setError(friendlyError(err, 'Couldn’t check the file. Nothing was imported.'));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.post('/staff-import', { rows: mapped });
      if (res.status === 202) {
        setProgress({ done: 0, total: res.data.data.total });
        setStep('importing');
        await follow(res.data.data.job_id);
      } else {
        setImported(res.data.data.imported);
        setStep('done');
      }
    } catch (err: any) {
      if (err?.response?.status === 422 && err.response.data?.data?.rows) {
        // Something changed since the check (e.g. someone added the same person): show the rows again.
        setChecked(err.response.data.data.rows);
        setError(err.response.data.error?.message ?? 'Some rows have problems. Nothing was imported.');
      } else {
        setError(friendlyError(err, 'Import failed. Nothing was imported.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const follow = async (jobId: string) => {
    for (;;) {
      await new Promise(r => setTimeout(r, 1000));
      const job = (await api.get(`/staff-import/jobs/${jobId}`)).data.data;
      setProgress({ done: job.done_rows, total: job.total_rows });
      if (job.status === 'done') { setImported(job.total_rows); setStep('done'); return; }
      if (job.status === 'failed') { setError(job.error || 'Import failed. Nothing was imported.'); setStep('review'); return; }
    }
  };

  // Leaving mid-import would hide the result; the import itself carries on either way.
  useEffect(() => {
    if (step !== 'importing') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [step]);

  const problems = (checked ?? []).filter(r => r.errors.length > 0);
  const ready = (checked ?? []).filter(r => r.errors.length === 0);
  const sample = rawRows[0] ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="space-y-1">
        <Link to="/staff" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)]">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Staff
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text)]">Import staff</h1>
      </div>

      <ol className="flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Steps">
        {(['Upload', 'Match columns', 'Check and import'] as const).map((label, i) => {
          const at = step === 'upload' ? 0 : step === 'map' ? 1 : 2;
          return (
            <li key={label} aria-current={i === at ? 'step' : undefined} className={i === at ? 'font-semibold text-[var(--text)]' : i < at ? 'text-[var(--text)]' : 'text-[var(--muted)]'}>
              {i + 1}. {label}
            </li>
          );
        })}
      </ol>

      {error && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger-light)] text-sm text-[var(--danger)]">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {step === 'upload' && (
        <section className="space-y-4">
          <label
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center gap-3 p-10 rounded-lg border-2 border-dashed text-center cursor-pointer ${dragging ? 'border-[var(--primary)] bg-[var(--primary-light)]' : 'border-[var(--border)] hover:border-[var(--border-hover)]'}`}
          >
            <Upload className="w-6 h-6 text-[var(--muted)]" aria-hidden="true" />
            <span className="text-sm font-medium text-[var(--text)]">{busy ? 'Reading file…' : 'Choose a spreadsheet or drop it here'}</span>
            <span className="text-xs text-[var(--muted)]">CSV or Excel (.xlsx), up to {MAX_IMPORT_ROWS.toLocaleString()} people, column names in the first row</span>
            <input ref={fileInput} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onPick} className="sr-only" disabled={busy} />
          </label>
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="simplehours-staff-template.csv"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--primary-text)] hover:underline"
          >
            <Download className="w-4 h-4" aria-hidden="true" /> Download a template
          </a>
        </section>
      )}

      {step === 'map' && (
        <section className="space-y-4">
          <p className="text-sm text-[var(--muted)]">
            <FileSpreadsheet className="inline w-4 h-4 mr-1 -mt-0.5" aria-hidden="true" />
            <span className="text-[var(--text)] font-medium">{fileName}</span> · {rawRows.length} {rawRows.length === 1 ? 'person' : 'people'}
          </p>
          <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-md">
            {IMPORT_FIELDS.map(field => (
              <div key={field.key} className="grid sm:grid-cols-[1fr_1.2fr] gap-2 items-center px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium text-[var(--text)]">{field.label}{field.required && <span className="text-[var(--danger)]"> *</span>}</div>
                  <div className="text-xs text-[var(--muted)]">{field.hint}</div>
                </div>
                <Select
                  aria-label={`Column for ${field.label}`}
                  value={mapping[field.key] === undefined ? '' : String(mapping[field.key])}
                  onChange={e => setMapping(m => {
                    const next = { ...m };
                    if (e.target.value === '') delete next[field.key];
                    else next[field.key] = Number(e.target.value);
                    return next;
                  })}
                >
                  <option value="">{field.required ? 'Choose a column' : 'Not in my file'}</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h}{sample[i] ? ` (e.g. ${sample[i].slice(0, 30)})` : ''}</option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" size="md" onClick={() => setStep('upload')} disabled={busy}>Choose another file</Button>
            <Button variant="primary" size="md" onClick={check} loading={busy}>Check file</Button>
          </div>
        </section>
      )}

      {(step === 'review' || step === 'importing') && checked && (
        <section className="space-y-4">
          <p className="text-sm text-[var(--text)]" role="status">
            <span className="font-semibold">{ready.length} ready</span>
            {problems.length > 0 && <> · <span className="font-semibold text-[var(--danger)]">{problems.length} {problems.length === 1 ? 'row needs' : 'rows need'} fixing</span></>}
          </p>

          {problems.length > 0 ? (
            <>
              <p className="text-sm text-[var(--muted)]">
                Nothing is imported until every row is fixed. Fix these in your spreadsheet and upload it again.
              </p>
              <div className="overflow-x-auto border border-[var(--border)] rounded-md">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-[var(--muted)]">
                    <tr><th scope="col" className="px-3 py-2 w-16">Row</th><th scope="col" className="px-3 py-2">Name</th><th scope="col" className="px-3 py-2">What to fix</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {problems.slice(0, 200).map(r => (
                      <tr key={r.row}>
                        <td className="px-3 py-2 tabular-nums">{r.row}</td>
                        <td className="px-3 py-2">{mapped.find(m => m.row === r.row)?.full_name || <span className="text-[var(--muted)]">(no name)</span>}</td>
                        <td className="px-3 py-2">
                          <ul className="space-y-0.5">
                            {r.errors.map((e, i) => <li key={i}><span className="text-[var(--muted)]">{FIELD_LABEL[e.field] ?? 'Row'}:</span> {e.message}</li>)}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {problems.length > 200 && <p className="text-xs text-[var(--muted)]">Showing the first 200 rows with problems.</p>}
              <div className="flex flex-wrap justify-between gap-2">
                <Button variant="ghost" size="md" onClick={() => setStep('map')}>Change columns</Button>
                <Button variant="primary" size="md" onClick={() => { setError(null); setStep('upload'); }} leftIcon={<Upload className="w-4 h-4" />}>Upload the fixed file</Button>
              </div>
            </>
          ) : (
            <>
              <div className="overflow-x-auto border border-[var(--border)] rounded-md">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-[var(--muted)]">
                    <tr>
                      <th scope="col" className="px-3 py-2">Name</th><th scope="col" className="px-3 py-2">Branch</th>
                      <th scope="col" className="px-3 py-2">Employee ID</th><th scope="col" className="px-3 py-2">Email</th>
                      <th scope="col" className="px-3 py-2 text-right">Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {ready.slice(0, 20).map(r => (
                      <tr key={r.row}>
                        <td className="px-3 py-2">{r.value?.full_name}</td>
                        <td className="px-3 py-2">{r.value?.branch_name}</td>
                        <td className="px-3 py-2">{r.value?.employee_code ?? '—'}</td>
                        <td className="px-3 py-2 break-all">{r.value?.email ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.value?.contracted_hours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ready.length > 20 && <p className="text-xs text-[var(--muted)]">Showing the first 20 of {ready.length}.</p>}

              {step === 'importing' && progress ? (
                <div className="space-y-1.5" role="status" aria-live="polite">
                  <div className="h-2 rounded-full bg-[var(--panel-subtle)] overflow-hidden">
                    <div className="h-full bg-[var(--primary)] transition-[width]" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
                  </div>
                  <p className="text-sm text-[var(--muted)]">Importing… {progress.done} of {progress.total}. You can leave this page; the import continues.</p>
                </div>
              ) : (
                <div className="flex flex-wrap justify-between gap-2">
                  <Button variant="ghost" size="md" onClick={() => setStep('map')} disabled={busy}>Change columns</Button>
                  <Button variant="primary" size="md" onClick={runImport} loading={busy}>
                    Import {ready.length} {ready.length === 1 ? 'person' : 'people'}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {step === 'done' && (
        <section className="space-y-4 text-center py-8" role="status">
          <CheckCircle2 className="w-8 h-8 mx-auto text-[var(--success)]" aria-hidden="true" />
          <p className="text-lg font-semibold text-[var(--text)]">{imported} {imported === 1 ? 'person' : 'people'} imported</p>
          <p className="text-sm text-[var(--muted)]">Add their shifts on the Schedule, or set up portal access from Staff.</p>
          <div className="flex justify-center gap-2">
            <Button variant="primary" size="md" onClick={() => navigate('/staff')}>Go to Staff</Button>
            <Button variant="ghost" size="md" onClick={() => { setChecked(null); setStep('upload'); }}>Import another file</Button>
          </div>
        </section>
      )}
    </div>
  );
}
