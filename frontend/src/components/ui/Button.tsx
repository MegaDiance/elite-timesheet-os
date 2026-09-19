import React, { type ButtonHTMLAttributes, forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  isLoading = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  ...props
}, ref) => {
  const isBusy = loading || isLoading;
  const baseStyles = 'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none rounded-md cursor-pointer select-none';

  const sizeStyles = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5 h-8',
    md: 'text-sm px-3.5 py-2 gap-2 h-9',
    lg: 'text-base px-5 py-2.5 gap-2.5 h-11',
  };

  const variantStyles = {
    primary: 'bg-[var(--primary)] hover:bg-[var(--primary-h)] active:scale-[0.98] text-white shadow-xs focus:ring-[var(--primary)] border border-transparent',
    secondary: 'bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] active:scale-[0.98] text-[var(--text)] border border-[var(--border)] focus:ring-[var(--primary)]',
    outline: 'border border-[var(--border)] hover:border-[var(--border-hover)] bg-transparent hover:bg-[var(--glass-4)] active:scale-[0.98] text-[var(--text)] focus:ring-[var(--primary)]',
    ghost: 'hover:bg-[var(--glass-8)] active:scale-[0.98] text-[var(--muted)] hover:text-[var(--text)] focus:ring-[var(--primary)]',
    danger: 'bg-[var(--danger)] hover:opacity-90 active:scale-[0.98] text-white shadow-xs focus:ring-[var(--danger)] border border-transparent',
  };

  return (
    <button
      ref={ref}
      disabled={disabled || isBusy}
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {isBusy ? (
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      {children}
      {!isBusy && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
});

Button.displayName = 'Button';
