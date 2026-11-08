/** Server settings, read from environment variables (see docs/mvp/TechStack.md, section 13.4). */

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

  return {
    port,
    databasePath: databasePath ?? './data/todoness.db',
    clientDir: text(env, 'CLIENT_DIR'),
    cookieSecure: bool(env, 'COOKIE_SECURE') ?? production,
    trustProxy: bool(env, 'TRUST_PROXY') ?? false,
    production,
  };
}
