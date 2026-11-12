/** When the login screen offers "Sign up again" (docs/recovery-upload FR-166). */
import { describe, expect, it } from 'vitest';
import { offerSignUpAgain } from '../../src/lib/signUpAgain';

const base = {
  mode: 'login' as const,
  reason: 'expired' as const,
  storedEmail: 'ann@corp.test',
  typedEmail: 'ann@corp.test',
  error: 'invalid_credentials' as const,
};

describe('offerSignUpAgain', () => {
  it('after a failed login with the e-mail the device data belongs to', () => {
    expect(offerSignUpAgain(base)).toBe(true);
  });

  it('ignores case and spaces around the typed e-mail', () => {
    expect(offerSignUpAgain({ ...base, typedEmail: '  Ann@Corp.TEST ' })).toBe(true);
  });

  it('not for another e-mail: that is someone else, and their data is never uploaded', () => {
    expect(offerSignUpAgain({ ...base, typedEmail: 'bob@corp.test' })).toBe(false);
  });

  it('not when the device holds no data (logged out, or never used)', () => {
    expect(offerSignUpAgain({ ...base, reason: 'logged_out' })).toBe(false);
    expect(offerSignUpAgain({ ...base, reason: undefined, storedEmail: undefined })).toBe(false);
  });

  it('not for other errors, and not while signing up', () => {
    expect(offerSignUpAgain({ ...base, error: 'network' })).toBe(false);
    expect(offerSignUpAgain({ ...base, error: 'too_many_attempts' })).toBe(false);
    expect(offerSignUpAgain({ ...base, error: undefined })).toBe(false);
    expect(offerSignUpAgain({ ...base, mode: 'register' })).toBe(false);
  });
});
