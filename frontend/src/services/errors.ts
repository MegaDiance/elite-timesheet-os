/**
 * Turns a failed API request into a sentence a manager or employee can act on.
 *
 * The server's own message is used when it is written for people (most are). Codes and messages
 * that only make sense to a developer — bare "Forbidden", field names like `record_date`, format
 * hints like YYYY-MM-DD, server errors — are replaced with plain language. The technical detail
 * stays in the browser console for support.
 */

interface ErrorLike {
  response?: { status?: number; data?: { code?: string; message?: string; error?: { code?: string; message?: string } } };
  message?: string;
}

const BY_CODE: Record<string, string> = {
  FORBIDDEN: 'You don’t have access to this. It may belong to a branch you aren’t assigned to.',
  NOT_FOUND: 'We couldn’t find that. It may have been removed, or it belongs to a branch you can’t see.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again in a moment.',
  TOO_MANY_REQUESTS: 'Too many attempts in a short time. Please wait 15 minutes and try again.',
  SESSION_EXPIRED: 'You were signed out because you were inactive. Please sign in again.',
  LINK_EXPIRED: 'This sign-in link has expired. Ask your manager for the new sign-in link.',
  LINK_INVALID: 'This sign-in link isn’t valid. Ask your manager for your organisation’s sign-in link.',
  OVERLAP: 'Two of the times on this day overlap. Change one so they don’t cross.',
};

/** Looks like it was written for a developer: snake_case field names, formats, enum lists. */
const TECHNICAL = /\b[a-z]+_[a-z_]+\b|YYYY|\bmust be (ROSTER|true or false|a list)|\buuid\b|\bpayload\b|\bnull\b|\bundefined\b/i;

export function errorCode(err: unknown): string | null {
  const e = err as ErrorLike;
  return e?.response?.data?.error?.code || e?.response?.data?.code || null;
}

export function friendlyError(err: unknown, fallback: string): string {
  const e = err as ErrorLike;
  const status = e?.response?.status;
  const code = errorCode(err);
  const message = e?.response?.data?.error?.message || e?.response?.data?.message;

  if (!e?.response) {
    if (e?.message && !/network|timeout/i.test(e.message)) console.warn('[SimpleHours]', e.message);
    return 'SimpleHours could not be reached. Check your internet connection and try again.';
  }
  if (status && status >= 500) {
    console.warn('[SimpleHours]', status, code, message);
    return BY_CODE.INTERNAL_ERROR;
  }
  if (code && BY_CODE[code] && (!message || TECHNICAL.test(message) || code === 'FORBIDDEN' || code === 'NOT_FOUND')) {
    return BY_CODE[code];
  }
  if (message && !TECHNICAL.test(message)) return message;
  if (message) console.warn('[SimpleHours]', code, message);
  if (status === 403) return BY_CODE.FORBIDDEN;
  if (status === 404) return BY_CODE.NOT_FOUND;
  if (status === 429) return BY_CODE.TOO_MANY_REQUESTS;
  return fallback;
}

/** Why the server left a day unchanged in a bulk action, as the end of a sentence. */
export const SKIP_REASON_LABEL: Record<string, string> = {
  INACTIVE: 'the worker is inactive',
  WORKER_INACTIVE: 'the worker is inactive',
  APPROVED: 'the timesheet is approved',
  TIMESHEET_ALREADY_APPROVED: 'the timesheet is approved',
  ROSTER_LOCKED: 'the roster is locked',
  TIMESHEET_LOCKED: 'timesheets are locked',
  HAS_WORKED_HOURS: 'the day already has worked hours',
  APPROVED_LEAVE: 'approved leave covers the whole day, so it was kept as is',
  LEAVE_ON_DAY: 'a whole day of leave is rostered, so it was kept as is',
  LEAVE_CONFLICT: 'it would overlap leave on that day',
  OVERLAP: 'the new times overlap something already on that day',
  NOTHING_TO_CHANGE: 'there was nothing to change',
  NO_SHIFT: 'there is no shift on that day',
};

export const skipReason = (code: string): string => SKIP_REASON_LABEL[code] ?? 'it could not be changed';
