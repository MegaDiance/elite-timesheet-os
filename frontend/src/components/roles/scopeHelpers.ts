import type { ScopeChoice } from './types';

/** Starting choice: the entire organisation for organisation-only roles, otherwise nothing chosen yet. */
export const initialScope = (entireOnly: boolean): ScopeChoice =>
  entireOnly ? { mode: 'all', branchIds: [] } : { mode: null, branchIds: [] };

/** A friendly message when the choice is not usable, or null. */
export function scopeProblem(value: ScopeChoice, entireOnly: boolean): string | null {
  if (value.mode === null) return 'Choose the entire organisation or selected branches.';
  if (value.mode === 'all') return null;
  if (entireOnly) return 'This role only works across the entire organisation. Choose the entire organisation.';
  if (value.branchIds.length === 0) return 'Choose at least one branch, or the entire organisation.';
  return null;
}

/** Turns an existing scope into a choice (for "Change"). */
export const choiceFromScope = (scope: { all: boolean; branches: Array<{ id: string }> }): ScopeChoice =>
  scope.all ? { mode: 'all', branchIds: [] } : { mode: 'branches', branchIds: scope.branches.map(b => b.id) };
