import { join } from 'node:path';
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
      maxAttachmentBytes: 100 * 1024 * 1024,
      attachmentsDir: join('./data', 'attachments'),
      onlineWindowMs: 30_000,
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
      MAX_ATTACHMENT_MB: '25',
      ATTACHMENTS_DIR: '/files',
      ONLINE_WINDOW_SECONDS: '90',
    });
    expect(c).toEqual({
      port: 8080,
      databasePath: '/data/todoness.db',
      clientDir: '/app/client/dist',
      cookieSecure: true,
      trustProxy: true,
      production: true,
      maxAttachmentBytes: 25 * 1024 * 1024,
      attachmentsDir: '/files',
      onlineWindowMs: 90_000,
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

describe('loadConfig – v1 settings', () => {
  it('MAX_ATTACHMENT_MB defaults to 100 and is read in megabytes', () => {
    expect(loadConfig({}).maxAttachmentBytes).toBe(100 * 1024 * 1024);
    expect(loadConfig({ MAX_ATTACHMENT_MB: '1' }).maxAttachmentBytes).toBe(1024 * 1024);
    expect(loadConfig({ MAX_ATTACHMENT_MB: '2048' }).maxAttachmentBytes).toBe(2048 * 1024 * 1024);
  });

  it('MAX_ATTACHMENT_MB must be a whole number of at least 1', () => {
    for (const v of ['0', '-5', '1.5', 'abc', '100MB', '100000000']) {
      expect(() => loadConfig({ MAX_ATTACHMENT_MB: v }), v).toThrow(ConfigError);
      expect(() => loadConfig({ MAX_ATTACHMENT_MB: v }), v).toThrow(/MAX_ATTACHMENT_MB/);
    }
  });

  it('ATTACHMENTS_DIR defaults to a folder next to the database', () => {
    expect(loadConfig({ DATABASE_PATH: '/data/todoness.db' }).attachmentsDir).toBe(
      join('/data', 'attachments'),
    );
    expect(
      loadConfig({ DATABASE_PATH: '/data/todoness.db', ATTACHMENTS_DIR: '/mnt/files' })
        .attachmentsDir,
    ).toBe('/mnt/files');
  });

  it('ONLINE_WINDOW_SECONDS defaults to 30 and must be a whole number from 10 to 3600', () => {
    expect(loadConfig({}).onlineWindowMs).toBe(30_000);
    expect(loadConfig({ ONLINE_WINDOW_SECONDS: '10' }).onlineWindowMs).toBe(10_000);
    for (const v of ['9', '0', '3601', 'x', '30.5']) {
      expect(() => loadConfig({ ONLINE_WINDOW_SECONDS: v }), v).toThrow(/ONLINE_WINDOW_SECONDS/);
    }
  });
});
