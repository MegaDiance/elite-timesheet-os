import React from 'react';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  action,
  className = ''
}) => {
  return (
    <div className={`p-8 text-center bg-[var(--panel)] border border-[var(--border)] rounded-lg flex flex-col items-center justify-center space-y-3 ${className}`}>
      {icon && (
        <div className="w-10 h-10 rounded-full bg-[var(--panel-subtle)] text-[var(--muted)] border border-[var(--border)] flex items-center justify-center">
          {icon}
        </div>
      )}
      <div className="space-y-1 max-w-sm">
        <h4 className="text-sm font-semibold text-[var(--text)] tracking-tight">{title}</h4>
        <p className="text-xs text-[var(--muted)] leading-relaxed">{description}</p>
      </div>
      {action ? (
        <div className="mt-2">{action}</div>
      ) : actionLabel && onAction ? (
        <Button variant="outline" size="sm" onClick={onAction} className="mt-2">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
};
