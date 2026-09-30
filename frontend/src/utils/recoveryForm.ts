/**
 * Checks for the "Recover your login link" form. These only spare people a round trip for an
 * empty or mistyped field — the server checks everything again and is the only authority.
 */
export interface RecoveryFields {
  organisationName: string;
  email: string;
  password: string;
}

export type RecoveryErrors = Partial<Record<keyof RecoveryFields, string>>;

/** Same shape the server accepts: something@something.tld, no spaces. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ORGANISATION_NAME_MAX = 120;

export function validateRecovery(fields: RecoveryFields): RecoveryErrors {
  const errors: RecoveryErrors = {};
  const name = fields.organisationName.trim();
  if (!name) errors.organisationName = 'Enter your organisation name.';
  else if (name.length > ORGANISATION_NAME_MAX) errors.organisationName = `Organisation names are ${ORGANISATION_NAME_MAX} characters or fewer.`;

  const email = fields.email.trim();
  if (!email) errors.email = 'Enter the owner’s email address.';
  else if (email.length > 254 || !EMAIL_SHAPE.test(email)) errors.email = 'Enter a valid email address, like owner@company.com.';

  if (!fields.password) errors.password = 'Enter the owner’s password.';
  return errors;
}

/** What a failed request says. The server's answer is deliberately the same for every kind of wrong detail, and so is this. */
export const UNVERIFIED_MESSAGE = 'The details provided could not be verified. Check the organisation name, owner email, and password and try again.';

export function recoveryFailureMessage(status: number | undefined, serverMessage?: string): string {
  if (status === undefined) return 'We couldn’t reach SimpleHours. Check your connection and try again.';
  if (status === 429) return serverMessage || 'Too many attempts. Please wait a while before trying again.';
  if (status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
  return UNVERIFIED_MESSAGE;
}
