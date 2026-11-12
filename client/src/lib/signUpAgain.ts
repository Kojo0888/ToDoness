/**
 * Whether the login screen offers "Sign up again" (docs/recovery-upload FR-166): a login
 * with the e-mail the data on this device belongs to failed as "wrong e-mail or password".
 * After the server was set up again that account does not exist yet, and signing up is the
 * way in that offers to upload the device's data. Another e-mail never gets the offer: the
 * device's data belongs to someone else (docs/v1/PRD.md D7).
 */
export function offerSignUpAgain(input: {
  mode: 'login' | 'register';
  /** Why the login screen shows; `expired` = the device still holds the user's data. */
  reason: 'expired' | 'logged_out' | undefined;
  /** E-mail of the user whose data is on this device. */
  storedEmail: string | undefined;
  typedEmail: string;
  error: string | undefined;
}): boolean {
  const { mode, reason, storedEmail, typedEmail, error } = input;
  if (mode !== 'login' || reason !== 'expired' || !storedEmail) return false;
  if (error !== 'invalid_credentials') return false;
  return typedEmail.trim().toLowerCase() === storedEmail.trim().toLowerCase();
}
