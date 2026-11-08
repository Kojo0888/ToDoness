import type Database from 'better-sqlite3';
import { webpush } from './webpush';
import type { Config } from '../config';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * The server's web push identity (FR-64): from the environment if set, otherwise
 * generated on first start and kept in the database, so it never changes by accident
 * (changing it would invalidate every subscription).
 */
export function getVapidKeys(
  db: Database.Database,
  config: Pick<Config, 'vapidPublicKey' | 'vapidPrivateKey'>,
  generate: () => VapidKeys = () => webpush.generateVAPIDKeys(),
): VapidKeys {
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    return { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  }
  const read = () => {
    const rows = db
      .prepare("SELECT key, value FROM app_settings WHERE key IN ('vapid_public', 'vapid_private')")
      .all() as { key: string; value: string }[];
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    const publicKey = get('vapid_public');
    const privateKey = get('vapid_private');
    return publicKey && privateKey ? { publicKey, privateKey } : undefined;
  };

  const existing = read();
  if (existing) return existing;

  const keys = generate();
  db.transaction(() => {
    const put = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
    put.run('vapid_public', keys.publicKey);
    put.run('vapid_private', keys.privateKey);
  })();
  return read() ?? keys; // read again: another process may have stored its keys first
}
