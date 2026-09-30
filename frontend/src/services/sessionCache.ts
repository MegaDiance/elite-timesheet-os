/**
 * Everything this browser remembers about the signed-in organisation, in one place, so it can be
 * forgotten together: the branch each organisation last showed and the walkthrough progress.
 * (The theme and sidebar preferences belong to the device, not the organisation, and stay.)
 * Nothing about an organisation is kept in module-level variables; React state is discarded by the
 * hard navigation that follows a switch or a sign-out.
 */
const ACTIVE_BRANCH_PREFIX = 'active_branch_';
const TOUR_KEY = 'simplehours_tour_version';

export function forgetOrganisationState(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(ACTIVE_BRANCH_PREFIX)) localStorage.removeItem(key);
    }
    localStorage.removeItem(TOUR_KEY);
  } catch {
    // Storage may be unavailable; there is then nothing remembered to clear.
  }
}
