/**
 * The password step before a sensitive change (the server answers 403 REAUTH_REQUIRED when it
 * wants the password again, e.g. before someone is given organisation-wide control).
 *
 * The API client calls `askForPassword()`; the <ReauthPrompt> mounted in the signed-in app shows
 * the prompt, sends the password to POST /auth/reauthenticate itself, and answers true once the
 * server has accepted it (or false if the person cancels). The request is then sent again once.
 * The password never leaves the prompt.
 */
type Pending = { message: string; resolve: (ok: boolean) => void };

let listener: ((pending: Pending) => void) | null = null;
let inFlight: Promise<boolean> | null = null;

export function onPasswordRequested(fn: ((pending: Pending) => void) | null): void {
  listener = fn;
}

export function askForPassword(message: string): Promise<boolean> {
  if (!listener) return Promise.resolve(false);
  // Several requests failing at once share one prompt.
  if (!inFlight) {
    const show = listener;
    inFlight = new Promise<boolean>(resolve => show({ message, resolve })).finally(() => { inFlight = null; });
  }
  return inFlight;
}
