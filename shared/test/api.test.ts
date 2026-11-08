import { describe, expect, it } from 'vitest';
import { newId } from '../src/id';
import {
  adminUsersResponseSchema,
  credentialsSchema,
  meResponseSchema,
  pushEnvelopeSchema,
} from '../src/api';

describe('credentialsSchema', () => {
  it('accepts an e-mail and a password of at least 8 characters', () => {
    expect(
      credentialsSchema.safeParse({ email: 'ann@corp.test', password: '12345678' }).success,
    ).toBe(true);
  });

  it('trims and lowercases the e-mail', () => {
    const r = credentialsSchema.parse({ email: '  Ann@Corp.TEST ', password: '12345678' });
    expect(r.email).toBe('ann@corp.test');
  });

  it('rejects a bad e-mail', () => {
    for (const email of ['', 'ann', 'ann@', '@corp.test', 'a b@corp.test']) {
      expect(credentialsSchema.safeParse({ email, password: '12345678' }).success, email).toBe(
        false,
      );
    }
  });

  it('rejects a short or very long password', () => {
    expect(credentialsSchema.safeParse({ email: 'a@b.co', password: '1234567' }).success).toBe(
      false,
    );
    expect(
      credentialsSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('does not trim the password', () => {
    const r = credentialsSchema.parse({ email: 'a@b.co', password: '  12345678  ' });
    expect(r.password).toBe('  12345678  ');
  });

  it('ignores unknown fields', () => {
    const r = credentialsSchema.parse({ email: 'a@b.co', password: '12345678', role: 'admin' });
    expect(r).toEqual({ email: 'a@b.co', password: '12345678' });
  });
});

describe('meResponseSchema / adminUsersResponseSchema', () => {
  it('accept the expected shapes', () => {
    const user = { id: newId(), email: 'a@b.co', role: 'admin' };
    expect(meResponseSchema.safeParse(user).success).toBe(true);
    expect(meResponseSchema.safeParse({ ...user, role: 'root' }).success).toBe(false);
    const list = {
      users: [{ ...user, createdAt: 1, passwordReset: false, online: false, lastSeenAt: null }],
    };
    expect(adminUsersResponseSchema.safeParse(list).success).toBe(true);
  });
});

describe('pushEnvelopeSchema', () => {
  const op = () => ({ opId: newId(), anything: 'else' });

  it('accepts operations without checking their content', () => {
    expect(pushEnvelopeSchema.safeParse({ clientId: 'c9f1a2', ops: [op(), op()] }).success).toBe(
      true,
    );
  });

  it('requires every operation to carry a valid opId so it can be reported', () => {
    expect(pushEnvelopeSchema.safeParse({ clientId: 'c9f1a2', ops: [{ x: 1 }] }).success).toBe(
      false,
    );
    expect(pushEnvelopeSchema.safeParse({ clientId: 'c9f1a2', ops: [{ opId: 'x' }] }).success).toBe(
      false,
    );
  });

  it('limits the batch size and checks the client id', () => {
    expect(pushEnvelopeSchema.safeParse({ clientId: 'c9f1a2', ops: [] }).success).toBe(false);
    const many = Array.from({ length: 501 }, op);
    expect(pushEnvelopeSchema.safeParse({ clientId: 'c9f1a2', ops: many }).success).toBe(false);
    expect(pushEnvelopeSchema.safeParse({ clientId: 'no-dash', ops: [op()] }).success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('needs the current password and a new one of the same length rules', async () => {
    const { changePasswordSchema } = await import('../src/api');
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'long enough' }).success,
    ).toBe(true);
    expect(
      changePasswordSchema.safeParse({ currentPassword: '', newPassword: 'long enough' }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'short' }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'y'.repeat(201) })
        .success,
    ).toBe(false);
    expect(changePasswordSchema.safeParse({ newPassword: 'long enough' }).success).toBe(false);
  });
});

describe('adminUsersResponseSchema (presence)', () => {
  it('carries online and lastSeenAt', () => {
    const user = {
      id: newId(),
      email: 'a@b.co',
      role: 'user',
      createdAt: 1,
      passwordReset: false,
    };
    const ok = (extra: object) =>
      adminUsersResponseSchema.safeParse({ users: [{ ...user, ...extra }] }).success;
    expect(ok({ online: true, lastSeenAt: 5 })).toBe(true);
    expect(ok({ online: false, lastSeenAt: null })).toBe(true);
    expect(ok({ online: 'yes', lastSeenAt: null })).toBe(false);
    expect(ok({})).toBe(false);
  });
});
