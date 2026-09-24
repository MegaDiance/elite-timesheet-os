import { useEffect, useRef, useState, type Ref } from 'react';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import SmartTimeInput from '../SmartTimeInput';
import { inputClass } from './Dialog';
import {
  BREAK_LENGTHS, ENTRY_TYPES, MAX_LINES, TYPE_LABEL, blankLine, breakChoiceLabel, breakChoiceOf, breakFromChoice, formatHours, formatTime, isEntryType, isUntouched,
  type BreakChoice, type BreakRule, type DraftLine, type EntryType, type HoursPreview,
} from './day';

interface TimeLinesProps {
  /** Unique prefix for element ids. */
  id: string;
  /** How this part is named in field labels, e.g. "Rostered". */
  name: string;
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  preview: HoursPreview;
  issues: (string | null)[];
  /** Put the cursor in the first line when the editor opens. */
  autoFocus?: boolean;
  /** The day's break rule, to label the "Standard" break choice. */
  breakRule?: BreakRule;
  /** The types a line may have (default: all). The employee portal only offers Normal Work. */
  types?: readonly EntryType[];
}

const fieldClass = `${inputClass} h-11 md:h-9 text-base md:text-xs`;
const timeClass = `${fieldClass} min-w-0 flex-1 md:flex-none md:w-[5.5rem] text-center tabular-nums px-1.5`;
const selectClass = `${fieldClass} min-w-0 flex-1 md:flex-none md:w-36 cursor-pointer px-2`;

/**
 * A short list of time lines: [type] [start] → [finish] = hours [remove]. Typing "9" and "5p" is a
 * normal day. "Add time" starts the next line where the last one finished and puts the cursor on its
 * finish. A line can instead be hours only (whole-day leave such as 7.6 h LWIP).
 */
export default function TimeLines({ id, name, lines, onChange, preview, issues, autoFocus = false, breakRule, types = ENTRY_TYPES }: TimeLinesProps) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const addRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const bind = (target: string) => (el: HTMLInputElement | null) => {
    if (el) inputs.current.set(target, el);
    else inputs.current.delete(target);
  };

  const [initialFocus] = useState<string | null>(() => {
    const first = lines[0];
    if (!autoFocus || !first) return null;
    return first.hoursOnly ? `${first.key}:hours` : `${first.key}:${first.start && !first.finish ? 'finish' : 'start'}`;
  });
  useEffect(() => {
    if (initialFocus) inputs.current.get(initialFocus)?.focus();
  }, [initialFocus]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === 'add') addRef.current?.focus();
    else inputs.current.get(target)?.focus();
  });

  const patch = (key: string, change: Partial<DraftLine>) => onChange(lines.map(l => (l.key === key ? { ...l, ...change } : l)));

  const addLine = () => {
    const last = lines[lines.length - 1];
    if (last && isUntouched(last)) {
      inputs.current.get(`${last.key}:start`)?.focus();
      return;
    }
    if (lines.length >= MAX_LINES) return;
    const start = last && !last.hoursOnly ? last.finish : '';
    const line = blankLine(start);
    onChange([...lines, line]);
    pendingFocus.current = `${line.key}:${start ? 'finish' : 'start'}`;
  };

  const removeLine = (key: string) => {
    const rest = lines.filter(l => l.key !== key);
    onChange(rest.length > 0 ? rest : [blankLine()]);
    pendingFocus.current = 'add';
  };

  const toggleHoursOnly = (line: DraftLine, index: number) => {
    if (line.hoursOnly) {
      patch(line.key, { hoursOnly: false, hours: 0 });
      pendingFocus.current = `${line.key}:start`;
    } else {
      patch(line.key, { hoursOnly: true, start: '', finish: '', hours: preview.perEntry[index] ?? 0 });
      pendingFocus.current = `${line.key}:hours`;
    }
  };

  return (
    <div>
      <ol className="space-y-1.5" aria-label={`${name} times`}>
        {lines.map((line, index) => {
          const n = index + 1;
          const issue = editingKey === line.key ? null : issues[index];
          const messageId = `${id}-${line.key}-issue`;
          const hours = preview.perEntry[index];
          return (
            <li
              key={line.key}
              className={`rounded-lg p-1.5 -mx-1.5 ${issue ? 'bg-[var(--danger-light)] ring-1 ring-[var(--danger)]/40' : ''}`}
              onFocus={() => setEditingKey(line.key)}
              onBlur={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditingKey(k => (k === line.key ? null : k));
              }}
            >
              <div className="flex flex-wrap md:flex-nowrap items-center gap-x-2 gap-y-1.5">
                <select
                  aria-label={`${name} type, line ${n}`}
                  value={line.type}
                  onChange={e => { if (isEntryType(e.target.value)) patch(line.key, { type: e.target.value }); }}
                  className={selectClass}
                >
                  {types.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>

                <div className="order-last md:order-none basis-full md:basis-auto flex items-center gap-2 min-w-0">
                  {line.hoursOnly ? (
                    <>
                      <HoursInput
                        ref={bind(`${line.key}:hours`)}
                        value={line.hours}
                        label={`${name} hours, line ${n}`}
                        invalid={Boolean(issue)}
                        describedBy={issue ? messageId : undefined}
                        onChange={h => patch(line.key, { hours: h })}
                      />
                      <span className="text-xs text-[var(--muted)]">hours, no start or finish</span>
                    </>
                  ) : (
                    <>
                      <SmartTimeInput
                        live
                        selectOnFocus
                        ref={bind(`${line.key}:start`)}
                        label={`${name} start, line ${n}`}
                        placeholder="Start"
                        value={line.start}
                        format={formatTime}
                        invalid={Boolean(issue)}
                        describedBy={issue ? messageId : undefined}
                        onChange={v => { if (v !== line.start) patch(line.key, { start: v }); }}
                        className={timeClass}
                      />
                      <span className="text-[var(--muted)] text-sm" aria-hidden="true">→</span>
                      <SmartTimeInput
                        live
                        selectOnFocus
                        ref={bind(`${line.key}:finish`)}
                        label={`${name} finish, line ${n}`}
                        placeholder="Finish"
                        value={line.finish}
                        after={line.start}
                        format={formatTime}
                        invalid={Boolean(issue)}
                        describedBy={issue ? messageId : undefined}
                        onChange={v => { if (v !== line.finish) patch(line.key, { finish: v }); }}
                        className={timeClass}
                      />
                      <output
                        aria-label={`${name} hours, line ${n}`}
                        className="shrink-0 w-16 text-right text-xs font-semibold tabular-nums text-[var(--text)]"
                      >
                        = {hours === null ? '—' : formatHours(hours)}
                      </output>
                    </>
                  )}
                </div>

                {!line.hoursOnly && line.type === 'WORK' && (
                  <BreakSelect
                    label={`${name} break, line ${n}`}
                    value={breakChoiceOf(line.has_break, line.break_mins)}
                    rule={breakRule}
                    onChange={choice => patch(line.key, breakFromChoice(choice))}
                  />
                )}
                <button
                  type="button"
                  onClick={() => toggleHoursOnly(line, index)}
                  className="h-11 md:h-9 px-1.5 shrink-0 text-[11px] text-[var(--muted)] hover:text-[var(--text)] hover:underline underline-offset-2 cursor-pointer whitespace-nowrap"
                  title={line.hoursOnly ? 'Enter a start and finish instead' : 'Enter hours without times, e.g. a whole day of leave'}
                >
                  {line.hoursOnly ? 'Use times' : 'Hours only'}
                </button>
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  aria-label={`Remove ${name.toLowerCase()} line ${n}`}
                  title="Remove this line"
                  className="h-11 w-11 md:h-9 md:w-9 shrink-0 inline-flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-light)] transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {issue && (
                <p id={messageId} className="mt-1 flex items-start gap-1 text-xs font-semibold text-[var(--danger)]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                  {issue}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <button
        ref={addRef}
        type="button"
        onClick={addLine}
        disabled={lines.length >= MAX_LINES && !isUntouched(lines[lines.length - 1])}
        className="mt-1 inline-flex items-center gap-1.5 h-11 md:h-8 px-2 -ml-2 rounded-lg text-xs font-semibold text-[var(--primary)] hover:bg-[var(--primary-light)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add time
      </button>
    </div>
  );
}

/** Hours for a line without times (e.g. 7.6 h of leave). Keeps the typed text while focused. */
function HoursInput({ value, onChange, label, invalid, describedBy, ref }: {
  value: number;
  onChange: (hours: number) => void;
  label: string;
  invalid: boolean;
  describedBy?: string;
  ref?: Ref<HTMLInputElement>;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value ? String(value) : '');
  }, [value]);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      placeholder="e.g. 7.6"
      value={text}
      onFocus={e => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(value ? String(value) : '');
      }}
      onChange={e => {
        const cleaned = e.target.value.replace(/[^\d.]/g, '');
        setText(cleaned);
        const hours = parseFloat(cleaned);
        onChange(Number.isFinite(hours) ? hours : 0);
      }}
      className={`${fieldClass} w-24 md:w-20 text-right tabular-nums`}
    />
  );
}

/**
 * The break for one Normal Work shift, as one choice: the organisation's standard rule, an
 * explicit length (always deducted), or no break. Each part of the day (rostered / worked) keeps
 * its own, so a break taken differently from the roster is recorded as it actually happened.
 */
export function BreakSelect({ label, value, rule, onChange, className = '' }: {
  label: string;
  value: BreakChoice;
  rule?: BreakRule;
  onChange: (choice: BreakChoice) => void;
  className?: string;
}) {
  const choices: BreakChoice[] = ['standard', ...BREAK_LENGTHS.map(m => `${m}` as BreakChoice), 'none'];
  // A stored length that isn't one of the presets still shows (and round-trips) correctly.
  if (!choices.includes(value)) choices.splice(1, 0, value);
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value as BreakChoice)}
      title="Unpaid break for this shift"
      className={`${fieldClass} order-last md:order-none shrink-0 w-auto cursor-pointer px-2 ${value === 'none' ? 'text-[var(--muted)]' : ''} ${className}`}
    >
      {choices.map(c => <option key={c} value={c}>{breakChoiceLabel(c, rule)}</option>)}
    </select>
  );
}
