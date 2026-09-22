import React from 'react';
import { Building2, Check, ArrowRight } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { Branch } from '../../hooks/useAccess';

interface BranchSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: Branch[];
  currentBranchId: string | null;
  onSwitch: (branchId: string) => void;
}

/** Switches the one branch the app is currently showing. Instant — no sign-out, no page reload. */
export const BranchSwitchModal: React.FC<BranchSwitchModalProps> = ({ isOpen, onClose, branches, currentBranchId, onSwitch }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Switch branch"
      description="Choose the branch you want to work in. Everything you see — rosters, timesheets, workers, reports — follows it."
      maxWidth="md"
    >
      <div className="space-y-3">
        <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden max-h-80 overflow-y-auto">
          {branches.map(branch => {
            const isCurrent = branch.id === currentBranchId;
            return (
              <button
                key={branch.id}
                type="button"
                disabled={isCurrent}
                onClick={() => {
                  onSwitch(branch.id);
                  onClose();
                }}
                className={`w-full p-3.5 flex items-center justify-between gap-3 text-left transition-colors ${
                  isCurrent ? 'bg-[var(--panel-subtle)]/70 cursor-default' : 'hover:bg-[var(--hover-row)] cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-[var(--muted)]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
                      <span className="truncate">{branch.name}</span>
                      {isCurrent && (
                        <span className="text-[10px] font-semibold text-[var(--success)] bg-[var(--success-light)] px-1.5 rounded border border-[var(--success)]/20 shrink-0">
                          Current
                        </span>
                      )}
                    </div>
                    {branch.address && <div className="text-xs text-[var(--muted)] truncate">{branch.address}</div>}
                  </div>
                </div>

                {isCurrent ? (
                  <span className="w-6 h-6 rounded-full bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] shrink-0">
                    Switch <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
