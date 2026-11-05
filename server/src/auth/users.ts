import type Database from 'better-sqlite3';
import { newId, type Hlc } from '@todoness/shared';
import type { AuthUser } from '../types';

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

    return { id, email, role };
  });

  return create.immediate();
}
