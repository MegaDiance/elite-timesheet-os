import React, { type HTMLAttributes } from 'react';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'outline';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  ...props
}) => {
  const sizeStyles = {
    sm: 'text-[10px] px-1.5 py-0.5 rounded leading-tight font-medium',
    md: 'text-xs px-2 py-0.5 rounded-md font-medium',
  };

  const variantStyles = {
    default: 'bg-[var(--glass-8)] text-[var(--muted)] border border-[var(--border)]',
    outline: 'bg-transparent text-[var(--muted)] border border-[var(--border)]',
    success: 'bg-[var(--success-light)] text-[var(--success)] border border-[var(--success)]/25',
    warning: 'bg-[var(--warn-light)] text-[var(--warn)] border border-[var(--warn)]/25',
    danger: 'bg-[var(--danger-light)] text-[var(--danger)] border border-[var(--danger)]/25',
    info: 'bg-[var(--primary-light)] text-[var(--primary-text)] border border-[var(--primary)]/25',
    purple: 'bg-[var(--primary-light)] text-[var(--primary-text)] border border-[var(--primary)]/25',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 shrink-0 ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};
