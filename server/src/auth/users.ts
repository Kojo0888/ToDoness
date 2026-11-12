import type Database from 'better-sqlite3';
import { newId, type Hlc } from '@todoness/shared';
import type { AuthUser } from '../http/types';

/**
 * Creates a user together with their Inbox list.
 * The first user ever created becomes the admin.
 * The Inbox also gets a change-log entry, so it reaches the browser through the
 * normal pull.
 */
export function createUserWithInbox(
  db: Database.Database,
  input: { email: string; passwordHash: string; now: number; hlc: Hlc },
): AuthUser {
  const { email, passwordHash, now, hlc } = input;

  const create = db.transaction((): AuthUser => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    const role = n === 0 ? 'admin' : 'user';
    const id = newId(now);

    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, email, passwordHash, role, now, now);

    const inboxId = newId(now);
    const fieldHlc = JSON.stringify({ name: hlc, orderKey: hlc, isInbox: hlc });
    db.prepare(
      `INSERT INTO lists (id, user_id, name, is_inbox, order_key, field_hlc, created_at, updated_at)
       VALUES (?, ?, 'Inbox', 1, 'a0', ?, ?, ?)`,
    ).run(inboxId, id, fieldHlc, now, now);

    db.prepare(
      `INSERT INTO change_log (user_id, client_id, entity, entity_id, op_type, patch, hlc, created_at)
       VALUES (?, 'server', 'list', ?, 'create', ?, ?, ?)`,
    ).run(id, inboxId, JSON.stringify({ name: 'Inbox', orderKey: 'a0', isInbox: true }), hlc, now);

    ensureNotesList(db, id, now, hlc);
    return { id, email, role };
  });

  return create.immediate();
}

export const NOTES_LIST_NAME = 'My notes';

/**
 * Creates the default note list "My notes" of a user if there is none yet (docs/note-lists,
 * FR-124, decision L2). Called at sign-up and before every pull, so accounts from before
 * note lists get it at their first sync; doing it on the server means devices cannot race
 * to create two. Returns whether it created one.
 */
export function ensureNotesList(
  db: Database.Database,
  userId: string,
  now: number,
  hlc: Hlc | (() => Hlc),
): boolean {
  const exists = db
    .prepare(
      `SELECT 1 FROM lists
        WHERE user_id = ? AND module = 'notes' AND is_inbox = 1 AND deleted_at IS NULL`,
    )
    .get(userId);
  if (exists) return false;
  const stamp = typeof hlc === 'function' ? hlc() : hlc;
  const id = newId(now);
  const patch = { name: NOTES_LIST_NAME, orderKey: 'a0', isInbox: true, module: 'notes' };
  const fieldHlc = JSON.stringify({ name: stamp, orderKey: stamp, isInbox: stamp, module: stamp });
  db.prepare(
    `INSERT INTO lists (id, user_id, name, is_inbox, module, order_key, field_hlc, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'notes', 'a0', ?, ?, ?)`,
  ).run(id, userId, NOTES_LIST_NAME, fieldHlc, now, now);
  db.prepare(
    `INSERT INTO change_log (user_id, client_id, entity, entity_id, op_type, patch, hlc, created_at)
     VALUES (?, 'server', 'list', ?, 'create', ?, ?, ?)`,
  ).run(userId, id, JSON.stringify(patch), stamp, now);
  return true;
}
