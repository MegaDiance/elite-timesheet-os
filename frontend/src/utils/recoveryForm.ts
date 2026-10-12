/**
 * Checks for the "Recover your company link" form. These only spare people a round trip for an
 * empty or mistyped field — the server checks everything again and is the only authority.
 */
export interface RecoveryFields {
  companyName: string;
  password: string;
}

export type RecoveryErrors = Partial<Record<keyof RecoveryFields | 'email', string>>;

/** Same shape the server accepts: something@something.tld, no spaces. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(raw: string): string | undefined {
  const email = raw.trim();
  if (!email) return 'Enter your email.';
  if (email.length > 254 || !EMAIL_SHAPE.test(email)) return 'Enter a valid email, like you@company.com.';
  return undefined;
}

export function validateRecovery(fields: RecoveryFields): RecoveryErrors {
  const errors: RecoveryErrors = {};
  const name = fields.companyName.trim();
  if (!name) errors.companyName = 'Enter your company name.';
  else if (name.length > 120) errors.companyName = 'Company names are 120 characters at most.';
  if (!fields.password) errors.password = 'Enter the recovery password.';
  return errors;
}

/** What a failed request says. The server's answer is deliberately the same for every kind of wrong detail, and so is this. */
export const UNVERIFIED_MESSAGE = 'Company name or recovery password is incorrect.';

export function recoveryFailureMessage(status: number | undefined, serverMessage?: string): string {
  if (status === undefined) return 'Can’t reach SimpleHours. Check your connection and try again.';
  if (status === 429) return serverMessage || 'Too many attempts. Try again later.';
  if (status >= 500) return 'Something went wrong. Try again in a moment.';
  return UNVERIFIED_MESSAGE;
}
