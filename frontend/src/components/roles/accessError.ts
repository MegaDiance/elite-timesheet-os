import { friendlyError } from '../../services/errors';

interface ErrorLike {
  response?: { status?: number; data?: { message?: string; error?: { message?: string } } };
}

/** Looks like a developer message: snake_case field names and the like. */
const TECHNICAL = /\b[a-z]+_[a-z_]+\b|\buuid\b|\bpayload\b|\bnull\b|\bundefined\b/i;
const GENERIC_DENIAL = /^you do not have access to this\.?$/i;

/**
 * Like friendlyError, but keeps the reason the server gives when it refuses a change to someone's
 * access ("You can’t do this because it includes access you don’t have yourself: …"), which is
 * written for people and far more useful than the generic "no access" text. `denied` replaces the
 * generic refusal, e.g. for a page that cannot be loaded at all.
 */
export function accessError(err: unknown, fallback: string, denied?: string): string {
  const e = err as ErrorLike;
  const message = e?.response?.data?.error?.message || e?.response?.data?.message;
  if (e?.response?.status === 403) {
    if (message && !GENERIC_DENIAL.test(message) && !TECHNICAL.test(message)) return message;
    if (denied) return denied;
  }
  return friendlyError(err, fallback);
}
