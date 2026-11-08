/**
 * Who is online (docs/v1/PRD.md FR-56 – FR-58).
 * Every authenticated request records `users.last_seen_at`; to keep the database
 * quiet the write is skipped if the same user was recorded a moment ago.
 */
import type Database from 'better-sqlite3';

export interface Presence {
  /** Records that the user was just heard from. */
  touch(userId: string, now: number): void;
  isOnline(lastSeenAt: number | null, now: number): boolean;
}

export function createPresence(db: Database.Database, windowMs: number): Presence {
  const write = db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?');
  const lastWrite = new Map<string, number>();
  // At least three writes fit into the window, so a user who is active never flickers.
  const throttleMs = Math.min(5000, Math.floor(windowMs / 3));

  return {
    touch(userId, now) {
      const last = lastWrite.get(userId);
      if (last !== undefined && now - last < throttleMs && now >= last) return;
      write.run(now, userId);
      lastWrite.set(userId, now);
    },
    isOnline: (lastSeenAt, now) => lastSeenAt !== null && now - lastSeenAt <= windowMs,
  };
}
