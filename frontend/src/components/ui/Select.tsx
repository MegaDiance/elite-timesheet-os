import React, { type SelectHTMLAttributes, forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  options?: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({
  label,
  error,
  helperText,
  leftIcon,
  options,
  children,
  className = '',
  id,
  disabled,
  ...props
}, ref) => {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {leftIcon && (
          <div className="absolute left-3 text-[var(--muted)] pointer-events-none flex items-center">
            {leftIcon}
          </div>
        )}
        <select
          ref={ref}
          id={selectId}
          disabled={disabled}
          className={`w-full appearance-none text-sm bg-[var(--input-bg)] text-[var(--text)] border ${
            error
              ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20'
              : 'border-[var(--border)] focus:border-indigo-500 focus:ring-indigo-500/20'
          } rounded-md px-3 py-2 pr-9 transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
            leftIcon ? 'pl-9' : ''
          } ${className}`}
          {...props}
        >
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled} className="bg-[var(--panel)] text-[var(--text)]">
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        <div className="absolute right-3 text-[var(--muted)] pointer-events-none flex items-center">
          <ChevronDown className="w-4 h-4" />
        </div>
      </div>
      {error && (
        <p className="mt-1 text-xs text-rose-500 font-medium">{error}</p>
      )}
      {!error && helperText && (
        <p className="mt-1 text-xs text-[var(--muted)]">{helperText}</p>
      )}
    </div>
  );
});

Select.displayName = 'Select';
