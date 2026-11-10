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
      vapidPublicKey: undefined,
      vapidPrivateKey: undefined,
      vapidSubject: 'mailto:todoness@localhost',
      ntfyUrl: undefined,
      ntfyToken: undefined,
      publicUrl: undefined,
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
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'https://todo.company.internal',
      NTFY_URL: 'https://ntfy.company.internal',
      NTFY_TOKEN: 'tk_secret',
      PUBLIC_URL: 'https://todo.company.internal',
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
      vapidPublicKey: 'pub',
      vapidPrivateKey: 'priv',
      vapidSubject: 'https://todo.company.internal',
      ntfyUrl: 'https://ntfy.company.internal',
      ntfyToken: 'tk_secret',
      publicUrl: 'https://todo.company.internal',
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

describe('loadConfig – web push settings (FR-64)', () => {
  it('keys are optional (they are generated and stored on first start)', () => {
    const c = loadConfig({});
    expect(c.vapidPublicKey).toBeUndefined();
    expect(c.vapidPrivateKey).toBeUndefined();
    expect(c.vapidSubject).toBe('mailto:todoness@localhost');
  });

  it('needs both keys or none', () => {
    expect(() => loadConfig({ VAPID_PUBLIC_KEY: 'x' })).toThrow(/VAPID_PRIVATE_KEY/);
    expect(() => loadConfig({ VAPID_PRIVATE_KEY: 'x' })).toThrow(/VAPID_PUBLIC_KEY/);
  });

  it('the subject must be a mailto: or https: address', () => {
    for (const v of ['mailto:a@b.co', 'https://x.example']) {
      expect(loadConfig({ VAPID_SUBJECT: v }).vapidSubject).toBe(v);
    }
    for (const v of ['a@b.co', 'http://x.example', 'ftp://x']) {
      expect(() => loadConfig({ VAPID_SUBJECT: v }), v).toThrow(/VAPID_SUBJECT/);
    }
  });
});

describe('loadConfig – ntfy', () => {
  it('is off unless NTFY_URL is set', () => {
    expect(loadConfig({}).ntfyUrl).toBeUndefined();
    expect(loadConfig({ NTFY_URL: '' }).ntfyUrl).toBeUndefined();
  });

  it('accepts http (a server on the local network) and https addresses', () => {
    expect(loadConfig({ NTFY_URL: 'http://ntfy.lan:8080' }).ntfyUrl).toBe('http://ntfy.lan:8080');
    expect(loadConfig({ NTFY_URL: 'https://ntfy.sh' }).ntfyUrl).toBe('https://ntfy.sh');
  });

  it('drops trailing slashes so the address can be used as it is', () => {
    expect(loadConfig({ NTFY_URL: 'https://ntfy.sh/' }).ntfyUrl).toBe('https://ntfy.sh');
    expect(loadConfig({ NTFY_URL: 'https://ntfy.example/base//' }).ntfyUrl).toBe(
      'https://ntfy.example/base',
    );
  });

  it('rejects an address that is not http(s)', () => {
    for (const v of ['ntfy.sh', 'ftp://ntfy.sh', 'https://', 'https://has space', 'javascript:1']) {
      expect(() => loadConfig({ NTFY_URL: v }), v).toThrow(ConfigError);
      expect(() => loadConfig({ NTFY_URL: v }), v).toThrow(/NTFY_URL/);
    }
  });

  it('NTFY_TOKEN is optional and needs NTFY_URL', () => {
    expect(loadConfig({ NTFY_URL: 'https://ntfy.sh' }).ntfyToken).toBeUndefined();
    expect(loadConfig({ NTFY_URL: 'https://ntfy.sh', NTFY_TOKEN: 'tk_x' }).ntfyToken).toBe('tk_x');
    expect(() => loadConfig({ NTFY_TOKEN: 'tk_x' })).toThrow(/NTFY_TOKEN.*NTFY_URL/);
  });

  it('PUBLIC_URL is checked like NTFY_URL and loses trailing slashes', () => {
    expect(loadConfig({ PUBLIC_URL: 'https://todo.example/' }).publicUrl).toBe(
      'https://todo.example',
    );
    expect(() => loadConfig({ PUBLIC_URL: 'todo.example' })).toThrow(/PUBLIC_URL/);
  });
});
