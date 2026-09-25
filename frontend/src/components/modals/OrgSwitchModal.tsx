import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Check, ArrowRight } from 'lucide-react';
import { ROLE_LABEL, type Role } from '../../hooks/useAccess';

/** One entry of GET /auth/organisations. */
export interface OrganisationChoice {
  id: string;
  name: string;
  role: Role;
  is_current: boolean;
}

interface OrgSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  organisations: OrganisationChoice[];
  currentOrgId?: string;
  onSwitch: (orgId: string) => void;
  switching: boolean;
}

export const OrgSwitchModal: React.FC<OrgSwitchModalProps> = ({
  isOpen,
  onClose,
  organisations,
  currentOrgId,
  onSwitch,
  switching,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Switch organisation"
      description="Your account has access to more than one organisation. Choose the one you want to work in."
      maxWidth="md"
    >
      <div className="space-y-3">
        <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
          {organisations.map((org) => {
            const isCurrent = currentOrgId ? org.id === currentOrgId : org.is_current;
            return (
              <button
                key={org.id}
                type="button"
                disabled={isCurrent || switching}
                onClick={() => onSwitch(org.id)}
                className={`w-full p-3.5 flex items-center justify-between gap-3 text-left transition-colors ${
                  isCurrent ? 'bg-[var(--panel-subtle)]/70 cursor-default' : 'hover:bg-[var(--hover-row)] cursor-pointer disabled:opacity-60'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-center text-xs font-bold text-[var(--text)] shrink-0">
                    {org.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
                      <span className="truncate">{org.name}</span>
                      {isCurrent && (
                        <span className="text-[10px] font-semibold text-[var(--success)] bg-[var(--success-light)] px-1.5 rounded border border-[var(--success)]/20 shrink-0">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted)]">{ROLE_LABEL[org.role]}</div>
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
          <Button variant="ghost" size="sm" onClick={onClose} disabled={switching}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
