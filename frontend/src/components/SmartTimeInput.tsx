import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';

interface SmartTimeInputProps {
  value: string;
  onChange: (parsedVal: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  /** Accessible name for the field, e.g. "Rostered start, segment 1". */
  label?: string;
  id?: string;
  /**
   * Report the parsed time on every keystroke (for live previews) rather than only on blur / Enter.
   * The text the user typed stays on screen until they leave the field.
   */
  live?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Select the whole value on focus, so typing replaces it. */
  selectOnFocus?: boolean;
  onFocus?: () => void;
  /** Lets a parent focus the field programmatically. */
  ref?: Ref<HTMLInputElement>;
}

export const parseSmartTime = (raw: string): string => {
  if (!raw) return '';
  let str = raw.trim().toLowerCase().replace(/\s/g, '');
  if (!str) return '';

  // If it's standard ISO or SQL TIME like "09:00:00" or "09:00:00.0000"
  if (/^\d{2}:\d{2}:\d{2}/.test(str)) {
    return str.substring(0, 5);
  }
  if (/^\d{2}:\d{2}$/.test(str)) return str;

  const isPM = str.includes('p');
  const isAM = str.includes('a');

  // Handle periods/dots: e.g. 9.30 (9:30), 9.5 (9:30), 9.00 (9:00)
  if (str.includes('.')) {
    const dotParts = str.replace(/[^\d.]/g, '').split('.');
    const hoursNum = parseInt(dotParts[0], 10) || 0;
    const decStr = dotParts[1] || '';

    let mins = 0;
    if (decStr.length === 1) {
      mins = Math.round(Number('0.' + decStr) * 60);
    } else if (decStr === '25') {
      mins = 15;
    } else if (decStr === '50') {
      mins = 30;
    } else if (decStr === '75') {
      mins = 45;
    } else {
      mins = parseInt(decStr.substring(0, 2), 10) || 0;
    }

    let h = hoursNum;
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    if (h > 23) h = 23;
    if (mins > 59) mins = 59;
    return `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  str = str.replace(/[^\d:]/g, '');
  if (!str) return '';

  let hours = 0;
  let minutes = 0;

  if (str.includes(':')) {
    const parts = str.split(':');
    hours = parseInt(parts[0], 10) || 0;
    minutes = parseInt(parts[1], 10) || 0;
  } else if (str.length >= 4) {
    hours = parseInt(str.substring(0, 2), 10) || 0;
    minutes = parseInt(str.substring(2, 4), 10) || 0;
  } else if (str.length === 3) {
    hours = parseInt(str.substring(0, 1), 10) || 0;
    minutes = parseInt(str.substring(1, 3), 10) || 0;
  } else {
    hours = parseInt(str, 10) || 0;
    minutes = 0;
  }

  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  if (hours > 23) hours = 23;
  if (minutes > 59) minutes = 59;

  const hStr = String(hours).padStart(2, '0');
  const mStr = String(minutes).padStart(2, '0');
  return `${hStr}:${mStr}`;
};

/**
 * A forgiving time field: "9", "9a", "5p", "1730", "9.30" and "17:30" all become HH:MM
 * when the user leaves the field or presses Enter.
 */
export default function SmartTimeInput({
  value,
  onChange,
  disabled,
  readOnly,
  placeholder = 'e.g. 9a, 1700',
  className = '',
  label,
  id,
  live = false,
  invalid,
  describedBy,
  selectOnFocus = false,
  onFocus,
  ref,
}: SmartTimeInputProps) {
  const [val, setVal] = useState(value || '');
  const focused = useRef(false);

  useEffect(() => {
    // In live mode the parent holds the parsed value while the user is still typing; keep their text.
    if (live && focused.current) return;
    setVal(value || '');
  }, [value, live]);

  const commit = () => {
    if (disabled || readOnly) return;
    const parsed = parseSmartTime(val);
    setVal(parsed);
    onChange(parsed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
  };

  return (
    <input
      ref={ref}
      id={id}
      type="text"
      inputMode="text"
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      value={val}
      onChange={e => {
        setVal(e.target.value);
        if (live) onChange(parseSmartTime(e.target.value));
      }}
      onFocus={e => {
        focused.current = true;
        if (selectOnFocus) e.currentTarget.select();
        onFocus?.();
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={handleKeyDown}
      className={className}
    />
  );
}
