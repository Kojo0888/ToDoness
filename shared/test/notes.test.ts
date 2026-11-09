/** The `note` entity (docs/notes/PRD.md FR-91): schemas and merge. */
import { describe, expect, it } from 'vitest';
import { formatHlc } from '../src/hlc';
import { newId } from '../src/id';
import { applyOp, type ApplyInput } from '../src/merge';
import {
  NOTE_TEXT_MAX,
  noteSchema,
  pullChangeSchema,
  syncOpSchema,
  type Note,
} from '../src/schemas';

const T0 = 1_730_822_400_000;
const hlc = (wall: number, counter = 0, clientId = 'a') => formatHlc({ wall, counter, clientId });
const NOTE_ID = newId(T0);

function op(overrides: Record<string, unknown>) {
  return {
    opId: newId(),
    entity: 'note',
    entityId: NOTE_ID,
    type: 'update',
    patch: { text: 'hello' },
    hlc: hlc(T0),
    ...overrides,
  };
}

describe('syncOpSchema – notes', () => {
  it('accepts a create with only an order key, and with every field', () => {
    expect(syncOpSchema.safeParse(op({ type: 'create', patch: { orderKey: 'a0' } })).success).toBe(
      true,
    );
    expect(
      syncOpSchema.safeParse(
        op({ type: 'create', patch: { orderKey: 'a0', text: 'x', isPublic: true } }),
      ).success,
    ).toBe(true);
  });

  it('refuses a create without an order key', () => {
    expect(syncOpSchema.safeParse(op({ type: 'create', patch: { text: 'x' } })).success).toBe(
      false,
    );
  });

  it('accepts updates of text (also empty), public flag and order', () => {
    for (const patch of [{ text: '' }, { text: 'a\nb' }, { isPublic: true }, { orderKey: 'a1' }]) {
      expect(syncOpSchema.safeParse(op({ patch })).success).toBe(true);
    }
  });

  it('refuses unknown or protected fields, empty patches and too long text', () => {
    for (const patch of [
      {},
      { title: 'x' },
      { userId: newId() },
      { deletedAt: 1 },
      { isInbox: true },
      { text: 'x'.repeat(NOTE_TEXT_MAX + 1) },
    ]) {
      expect(syncOpSchema.safeParse(op({ patch })).success).toBe(false);
    }
    expect(syncOpSchema.safeParse(op({ patch: { text: 'x'.repeat(NOTE_TEXT_MAX) } })).success).toBe(
      true,
    );
  });

  it('accepts delete and restore with an empty patch only', () => {
    expect(syncOpSchema.safeParse(op({ type: 'delete', patch: {} })).success).toBe(true);
    expect(syncOpSchema.safeParse(op({ type: 'restore', patch: {} })).success).toBe(true);
    expect(syncOpSchema.safeParse(op({ type: 'delete', patch: { text: 'x' } })).success).toBe(
      false,
    );
  });

  it('parses a pulled note change', () => {
    const change = {
      serverSeq: 3,
      entity: 'note',
      entityId: NOTE_ID,
      type: 'update',
      patch: { text: 'x', deletedAt: null },
      hlc: hlc(T0),
    };
    expect(pullChangeSchema.safeParse(change).success).toBe(true);
    expect(
      pullChangeSchema.safeParse({ ...change, patch: { title: 'not a note field' } }).success,
    ).toBe(false);
  });
});

describe('applyOp – notes', () => {
  const create = (patch: Record<string, unknown>, at = hlc(T0)): ApplyInput => ({
    entity: 'note',
    entityId: NOTE_ID,
    type: 'create',
    patch,
    hlc: at,
  });
  const update = (patch: Record<string, unknown>, at: string): ApplyInput => ({
    entity: 'note',
    entityId: NOTE_ID,
    type: 'update',
    patch,
    hlc: at,
  });

  function run(ops: ApplyInput[]): Note {
    let row: Note | undefined;
    for (const o of ops) {
      const r = applyOp<Note>(row, o);
      if (!r.ok) throw new Error(r.reason);
      row = r.row;
    }
    return row!;
  }

  it('creates a note with defaults', () => {
    const row = run([create({ orderKey: 'a0' })]);
    expect(row).toEqual({
      id: NOTE_ID,
      text: '',
      isPublic: false,
      orderKey: 'a0',
      fieldHlc: { orderKey: hlc(T0) },
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    });
    expect(noteSchema.safeParse(row).success).toBe(true);
  });

  it('needs an order key to create', () => {
    expect(applyOp(undefined, create({ text: 'x' }))).toEqual({
      ok: false,
      reason: 'missing_fields',
    });
  });

  it('merges per field, last write wins, in any order', () => {
    const a = create({ orderKey: 'a0', text: 'one' });
    const b = update({ text: 'two' }, hlc(T0 + 2));
    const c = update({ text: 'old', isPublic: true }, hlc(T0 + 1));
    const forward = run([a, b, c]);
    const backward = run([a, c, b]);
    expect(forward.text).toBe('two');
    expect(forward.isPublic).toBe(true);
    expect(backward).toEqual(forward);
  });

  it('an older edit does not undelete; applying twice changes nothing', () => {
    const del: ApplyInput = {
      entity: 'note',
      entityId: NOTE_ID,
      type: 'delete',
      patch: {},
      hlc: hlc(T0 + 5),
    };
    const row = run([create({ orderKey: 'a0' }), del, update({ text: 'x' }, hlc(T0 + 3))]);
    expect(row.deletedAt).toBe(T0 + 5);
    const again = applyOp(row, del);
    expect(again.ok && again.changed).toBe(false);
  });
});
