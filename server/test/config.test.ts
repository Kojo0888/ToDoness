import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('uses development defaults when nothing is set', () => {
    const c = loadConfig({});
    expect(c).toEqual({
      port: 3000,
      databasePath: './data/todoness.db',
      clientDir: undefined,
      cookieSecure: false,
      trustProxy: false,
      production: false,
    });
  });

  it('reads every setting', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_PATH: '/data/todoness.db',
      CLIENT_DIR: '/app/client/dist',
      COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
    });
    expect(c).toEqual({
      port: 8080,
      databasePath: '/data/todoness.db',
      clientDir: '/app/client/dist',
      cookieSecure: true,
      trustProxy: true,
      production: true,
    });
  });

  it('turns secure cookies on by default in production', () => {
    expect(loadConfig({ NODE_ENV: 'production', DATABASE_PATH: '/d.db' }).cookieSecure).toBe(true);
    expect(
      loadConfig({ NODE_ENV: 'production', DATABASE_PATH: '/d.db', COOKIE_SECURE: 'false' })
        .cookieSecure,
    ).toBe(false);
  });

  it('requires DATABASE_PATH in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_PATH/);
  });

  it('rejects an invalid port', () => {
    for (const PORT of ['abc', '0', '70000', '-1', '80.5']) {
      expect(() => loadConfig({ PORT }), PORT).toThrow(/PORT/);
    }
  });

  it('rejects a boolean that is not true or false', () => {
    expect(() => loadConfig({ TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });

  it('treats empty strings as not set', () => {
    expect(loadConfig({ PORT: '', CLIENT_DIR: '', TRUST_PROXY: '' }).port).toBe(3000);
  });
});
