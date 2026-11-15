/** Modules and "open where I left" (docs/notes/PRD.md FR-83 – FR-87). */
import { describe, expect, it } from 'vitest';
import {
  MODULES,
  homeOf,
  moduleOfPath,
  readLastModule,
  saveLastModule,
} from '../../src/lib/modules';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('moduleOfPath', () => {
  it.each([
    ['/tasks', 'tasks'],
    ['/l/abc', 'tasks'],
    ['/l/abc/t/def', 'tasks'],
    ['/public/abc', 'tasks'],
    ['/public/abc/t/def', 'tasks'],
    ['/lists/manage', 'tasks'],
    ['/notes', 'notes'],
    ['/notes/', 'notes'],
    ['/notes/public', 'notes'],
    ['/plans', 'plan'],
    ['/plans/', 'plan'],
    ['/plan/abc', 'plan'],
    ['/calendar', 'calendar'],
    ['/calendar/', 'calendar'],
    ['/calendar/new', 'calendar'],
    ['/calendar/e/abc', 'calendar'],
    ['/calendar/manage', 'calendar'],
  ])('%s belongs to %s', (path, id) => {
    expect(moduleOfPath(path)).toBe(id);
  });

  // `/` is the start address: it opens the last module, so it belongs to none.
  it.each([
    '/',
    '/settings',
    '/admin',
    '/notesx',
    '/lists',
    '/publicx',
    '/tasksx',
    '/lists/managex',
    '/calendarx',
  ])('%s belongs to no module', (path) => {
    expect(moduleOfPath(path)).toBeUndefined();
  });
});

describe('the module list', () => {
  it('has Tasks first, then Notes, Plan and Calendar, each with a home address it owns', () => {
    expect(MODULES.map((m) => m.id)).toEqual(['tasks', 'notes', 'plan', 'calendar']);
    expect(homeOf('calendar')).toBe('/calendar');
    for (const m of MODULES) expect(moduleOfPath(m.home)).toBe(m.id);
    expect(homeOf('notes')).toBe('/notes');
    expect(homeOf('tasks')).toBe('/tasks');
  });
});

describe('last module on this device', () => {
  it('remembers the calendar', () => {
    const s = memoryStorage();
    saveLastModule(s, 'calendar');
    expect(readLastModule(s)).toBe('calendar');
  });

  it('defaults to tasks', () => {
    expect(readLastModule(memoryStorage())).toBe('tasks');
  });

  it('remembers what was saved', () => {
    const s = memoryStorage();
    saveLastModule(s, 'notes');
    expect(s.data.get('todoness.module')).toBe('notes');
    expect(readLastModule(s)).toBe('notes');
  });

  it('ignores unknown values and storage that throws', () => {
    expect(readLastModule(memoryStorage({ 'todoness.module': 'journal' }))).toBe('tasks');
    expect(readLastModule(broken)).toBe('tasks');
    expect(() => saveLastModule(broken, 'notes')).not.toThrow();
    expect(readLastModule(undefined)).toBe('tasks');
  });
});
