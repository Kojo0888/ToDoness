import { dirname, join } from 'node:path';

/**
 * Server settings, read from environment variables (see docs/mvp/TechStack.md,
 * section 13.4, and docs/v1/TechStack.md, section 4).
 */

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface Config {
  port: number;
  databasePath: string;
  /** Folder with the built web app. When unset the server only serves the API. */
  clientDir: string | undefined;
  cookieSecure: boolean;
  trustProxy: boolean;
  production: boolean;
  /** Largest allowed attachment, in bytes (MAX_ATTACHMENT_MB). */
  maxAttachmentBytes: number;
  /** Where uploaded files are stored (ATTACHMENTS_DIR). */
  attachmentsDir: string;
  /** A user counts as online if the server heard from them this recently. */
  onlineWindowMs: number;
  /** Web push identity. Both unset = generated on first start and kept in the database. */
  vapidPublicKey: string | undefined;
  vapidPrivateKey: string | undefined;
  /** `mailto:` or `https:` contact sent to push services. */
  vapidSubject: string;
  /** ntfy server for reminders (NTFY_URL); unset = ntfy is off. No trailing slash. */
  ntfyUrl: string | undefined;
  /** Access token for a protected ntfy server (NTFY_TOKEN). */
  ntfyToken: string | undefined;
  /** Address of this app as users reach it (PUBLIC_URL); lets an ntfy click open the task. */
  publicUrl: string | undefined;
}

type Env = Record<string, string | undefined>;

function text(env: Env, key: string): string | undefined {
  const v = env[key];
  return v === undefined || v === '' ? undefined : v;
}

function bool(env: Env, key: string): boolean | undefined {
  const v = text(env, key);
  if (v === undefined) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ConfigError(`${key} must be "true" or "false" (got "${v}")`);
}

function wholeNumber(env: Env, key: string, fallback: number, min: number, max: number): number {
  const v = text(env, key);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!/^\d+$/.test(v) || n < min || n > max) {
    throw new ConfigError(`${key} must be a whole number from ${min} to ${max} (got "${v}")`);
  }
  return n;
}

/** An http(s) address with its trailing slashes removed. */
function webAddress(env: Env, key: string): string | undefined {
  const v = text(env, key);
  if (v === undefined) return undefined;
  if (!/^https?:\/\/[^\s/]+\S*$/.test(v)) {
    throw new ConfigError(
      `${key} must be an address starting with http:// or https:// (got "${v}")`,
    );
  }
  return v.replace(/\/+$/, '');
}

export function loadConfig(env: Env = process.env): Config {
  const production = env.NODE_ENV === 'production';

  const portText = text(env, 'PORT');
  const port = portText === undefined ? 3000 : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be a whole number from 1 to 65535 (got "${portText}")`);
  }

  const databasePath = text(env, 'DATABASE_PATH');
  if (production && databasePath === undefined) {
    throw new ConfigError('DATABASE_PATH is required in production');
  }

  const resolvedDatabasePath = databasePath ?? './data/todoness.db';
  const maxMb = wholeNumber(env, 'MAX_ATTACHMENT_MB', 100, 1, 1_000_000);
  const windowSeconds = wholeNumber(env, 'ONLINE_WINDOW_SECONDS', 30, 10, 3600);

  const vapidPublicKey = text(env, 'VAPID_PUBLIC_KEY');
  const vapidPrivateKey = text(env, 'VAPID_PRIVATE_KEY');
  if ((vapidPublicKey === undefined) !== (vapidPrivateKey === undefined)) {
    throw new ConfigError(
      `${vapidPublicKey === undefined ? 'VAPID_PUBLIC_KEY' : 'VAPID_PRIVATE_KEY'} is missing: set both VAPID keys or neither`,
    );
  }
  const vapidSubject = text(env, 'VAPID_SUBJECT') ?? 'mailto:todoness@localhost';
  if (!/^(mailto:|https:\/\/)\S+$/.test(vapidSubject)) {
    throw new ConfigError(
      `VAPID_SUBJECT must start with "mailto:" or "https://" (got "${vapidSubject}")`,
    );
  }

  const ntfyUrl = webAddress(env, 'NTFY_URL');
  const ntfyToken = text(env, 'NTFY_TOKEN');
  if (ntfyToken !== undefined && ntfyUrl === undefined) {
    throw new ConfigError(
      'NTFY_TOKEN is set but NTFY_URL is not: set NTFY_URL too, or remove the token',
    );
  }

  return {
    port,
    databasePath: resolvedDatabasePath,
    clientDir: text(env, 'CLIENT_DIR'),
    cookieSecure: bool(env, 'COOKIE_SECURE') ?? production,
    trustProxy: bool(env, 'TRUST_PROXY') ?? false,
    production,
    maxAttachmentBytes: maxMb * 1024 * 1024,
    attachmentsDir:
      text(env, 'ATTACHMENTS_DIR') ?? join(dirname(resolvedDatabasePath), 'attachments'),
    onlineWindowMs: windowSeconds * 1000,
    vapidPublicKey,
    vapidPrivateKey,
    vapidSubject,
    ntfyUrl,
    ntfyToken,
    publicUrl: webAddress(env, 'PUBLIC_URL'),
  };
}
