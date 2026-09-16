import { useState, useEffect } from 'react';

interface SmartTimeInputProps {
  value: string;
  onChange: (parsedVal: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export const parseSmartTime = (raw: string): string => {
  if (!raw) return '';
  let str = raw.trim().toLowerCase();

  // If already HH:MM
  if (/^\d{2}:\d{2}$/.test(str)) return str;

  let isPM = str.includes('p');
  let isAM = str.includes('a');
  str = str.replace(/[^\d:]/g, '');

  if (!str) return '';

  let hours = 0;
  let minutes = 0;

  if (str.includes(':')) {
    const parts = str.split(':');
    hours = parseInt(parts[0], 10) || 0;
    minutes = parseInt(parts[1], 10) || 0;
  } else if (str.length === 4) {
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

export default function SmartTimeInput({ value, onChange, disabled, placeholder = 'e.g. 9a, 1700', className = '' }: SmartTimeInputProps) {
  const [val, setVal] = useState(value || '');

  useEffect(() => {
    setVal(value || '');
  }, [value]);

  const handleBlur = () => {
    const parsed = parseSmartTime(val);
    setVal(parsed);
    onChange(parsed);
  };

  return (
    <input
      type="text"
      disabled={disabled}
      placeholder={placeholder}
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={handleBlur}
      className={className}
    />
  );
}
