import React, { type InputHTMLAttributes, forwardRef } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  helperText,
  leftIcon,
  rightIcon,
  className = '',
  id,
  disabled,
  ...props
}, ref) => {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {leftIcon && (
          <div className="absolute left-3 text-[var(--muted)] pointer-events-none flex items-center">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          className={`w-full text-sm bg-[var(--input-bg)] text-[var(--text)] border ${
            error
              ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20'
              : 'border-[var(--border)] focus:border-indigo-500 focus:ring-indigo-500/20'
          } rounded-md px-3 py-2 transition-colors placeholder:text-[var(--muted)]/60 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            leftIcon ? 'pl-9' : ''
          } ${rightIcon ? 'pr-9' : ''} ${className}`}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3 text-[var(--muted)] flex items-center">
            {rightIcon}
          </div>
        )}
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

Input.displayName = 'Input';
