import type Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@todoness/shared';
import type { AuthUser } from '../types';

export const SESSION_COOKIE = 'todoness_session';
export const SESSION_MS = 90 * 24 * 60 * 60 * 1000;

/** The database stores only this hash, so a leaked database cannot be used to log in. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a session and returns the secret value for the cookie. */
export function createSession(db: Database.Database, userId: string, now: number): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now + SESSION_MS,
    now,
  );
  return token;
}

export function getUserBySession(
  db: Database.Database,
  token: string,
  now: number,
): AuthUser | undefined {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), now) as { id: string; email: string; role: Role } | undefined;
  return row;
}

export function deleteSession(db: Database.Database, token: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

export function deleteUserSessions(db: Database.Database, userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function deleteExpiredSessions(db: Database.Database, now: number): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
}
