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
  let str = raw.trim().toLowerCase().replace(/\s/g, '');
  if (!str) return '';

  // If it's standard ISO or SQL TIME like "09:00:00" or "09:00:00.0000"
  if (/^\d{2}:\d{2}:\d{2}/.test(str)) {
    return str.substring(0, 5);
  }
  if (/^\d{2}:\d{2}$/.test(str)) return str;

  let isPM = str.includes('p') || str.includes('pm');
  let isAM = str.includes('a') || str.includes('am');

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const parsed = parseSmartTime(val);
      setVal(parsed);
      onChange(parsed);
    }
  };

  return (
    <input
      type="text"
      disabled={disabled}
      placeholder={placeholder}
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={className}
    />
  );
}
