import { hash, verify } from '@node-rs/argon2';

/** argon2id with the library defaults. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/**
 * Checks a password against a throw-away hash. Used when the e-mail is unknown,
 * so "unknown e-mail" and "wrong password" take about the same time.
 */
export async function verifyDummy(password: string): Promise<void> {
  dummy ??= hashPassword('not-a-real-password');
  await verifyPassword(await dummy, password);
}
