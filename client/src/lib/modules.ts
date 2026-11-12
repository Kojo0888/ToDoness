/**
 * The app's modules (docs/notes/PRD.md FR-83 – FR-87). Adding a module means adding one
 * entry here plus its pages and sidebar section; the switch and "open where I left" use
 * this list.
 */
export type ModuleId = 'tasks' | 'notes' | 'plan';

export interface AppModule {
  id: ModuleId;
  /** Where the module starts (`/tasks` opens the Inbox). `/` opens the last module. */
  home: string;
  /** Does this address belong to the module? */
  owns(path: string): boolean;
}

export const MODULES: readonly AppModule[] = [
  {
    id: 'tasks',
    home: '/tasks',
    owns: (p) => /^\/(tasks|l|public)(\/|$)|^\/lists\/manage\/?$/.test(p),
  },
  { id: 'notes', home: '/notes', owns: (p) => /^\/notes(\/|$)/.test(p) },
  // `/plans` is the module's start, `/plan/<id>` one plan (docs/plan/PRD.md FR-119, FR-122).
  { id: 'plan', home: '/plans', owns: (p) => /^\/plans?(\/|$)/.test(p) },
];

/** The module an address belongs to; `undefined` for Settings, Admin and the like. */
export function moduleOfPath(path: string): ModuleId | undefined {
  return MODULES.find((m) => m.owns(path))?.id;
}

export function homeOf(id: ModuleId): string {
  return MODULES.find((m) => m.id === id)!.home;
}

/** The part of `Storage` used here (so tests can pass their own). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'todoness.module';
const DEFAULT: ModuleId = 'tasks';

/**
 * The module the user had open last on this device. Stored in `localStorage`, not in the
 * synced data: it is needed before the database is open, and it is a device preference
 * (decision N2).
 */
export function readLastModule(storage: KeyValueStore | undefined): ModuleId {
  try {
    const v = storage?.getItem(KEY);
    return MODULES.some((m) => m.id === v) ? (v as ModuleId) : DEFAULT;
  } catch {
    return DEFAULT; // storage blocked
  }
}

export function saveLastModule(storage: KeyValueStore | undefined, id: ModuleId): void {
  try {
    storage?.setItem(KEY, id);
  } catch {
    /* storage may be blocked; the choice then lasts until reload */
  }
}

/** `localStorage`, or nothing where reading it throws (blocked storage). */
export function browserStorage(): KeyValueStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
