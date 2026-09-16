import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Check, ArrowRight } from 'lucide-react';

export interface OrganisationMembership {
  id: string;
  name: string;
  role: string;
}

interface OrgSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  organisations: OrganisationMembership[];
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
      title="Switch Organisation"
      description="You have access to multiple workplace tenants. Select an organisation to switch active context."
      maxWidth="md"
    >
      <div className="space-y-3">
        <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
          {organisations.map((org) => {
            const isCurrent = org.id === currentOrgId;
            return (
              <div
                key={org.id}
                onClick={() => !isCurrent && !switching && onSwitch(org.id)}
                className={`p-3.5 flex items-center justify-between transition-colors ${
                  isCurrent
                    ? 'bg-[var(--panel-subtle)]/70 cursor-default'
                    : 'hover:bg-[var(--hover-row)] cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-center text-xs font-bold text-[var(--text)]">
                    {org.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
                      <span>{org.name}</span>
                      {isCurrent && (
                        <span className="text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted)]">Role: {org.role}</div>
                  </div>
                </div>

                <div>
                  {isCurrent ? (
                    <div className="w-6 h-6 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <Button variant="secondary" size="sm" disabled={switching} rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                      Switch
                    </Button>
                  )}
                </div>
              </div>
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
