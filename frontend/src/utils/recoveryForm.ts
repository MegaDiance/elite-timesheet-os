/**
 * Checks for the "Find your login link" form. These only spare people a round trip for an empty
 * or mistyped field — the server checks everything again and is the only authority.
 */
export interface RecoveryFields {
  email: string;
  password: string;
}

export type RecoveryErrors = Partial<Record<keyof RecoveryFields, string>>;

/** Same shape the server accepts: something@something.tld, no spaces. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(raw: string): string | undefined {
  const email = raw.trim();
  if (!email) return 'Enter your email address.';
  if (email.length > 254 || !EMAIL_SHAPE.test(email)) return 'Enter a valid email address, like you@company.com.';
  return undefined;
}

export function validateRecovery(fields: RecoveryFields): RecoveryErrors {
  const errors: RecoveryErrors = {};
  const email = emailError(fields.email);
  if (email) errors.email = email;
  if (!fields.password) errors.password = 'Enter your password.';
  return errors;
}

/** What a failed request says. The server's answer is deliberately the same for every kind of wrong detail, and so is this. */
export const UNVERIFIED_MESSAGE = 'That email and password don’t match an account. Check them and try again.';

export function recoveryFailureMessage(status: number | undefined, serverMessage?: string): string {
  if (status === undefined) return 'We couldn’t reach SimpleHours. Check your connection and try again.';
  if (status === 429) return serverMessage || 'Too many attempts. Please wait a while before trying again.';
  if (status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
  return UNVERIFIED_MESSAGE;
}
