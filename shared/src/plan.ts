/**
 * The Plan module's rules (docs/plan/PRD.md): calendar days and dependencies.
 * Pure functions, used by the client to keep a plan consistent and to draw it.
 */

// ---------------------------------------------------------------------------
// Days: `YYYY-MM-DD`, a calendar day without a time zone
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MIN = 1900;
const YEAR_MAX = 2999;

/** Days since 1970-01-01, for arithmetic. `NaN` for something that is not a day. */
export function dayNumber(day: string): number {
  const m = DAY_RE.exec(day);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

export function dayOf(number: number): string {
  return new Date(number * DAY_MS).toISOString().slice(0, 10);
}

/** A real calendar day (so no 30 February) between 1900 and 2999. */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  return year >= YEAR_MIN && year <= YEAR_MAX && dayOf(dayNumber(value)) === value;
}

export const addDays = (day: string, n: number): string => dayOf(dayNumber(day) + n);

/** How many days `to` is after `from` (negative when it is before). */
export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from);

/** The last day of an activity that starts on `start` and lasts `days`. */
export const endDay = (start: string, days: number): string => addDays(start, days - 1);

/** The calendar day of a moment (epoch ms) on this device. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/** What the rules need to know about an activity. */
export interface Scheduled {
  id: string;
  planId: string;
  start: string;
  days: number;
  dependsOn: readonly string[];
  deletedAt: number | null;
}

/** `to` can only start after `from` has ended. */
export interface Link {
  from: string;
  to: string;
}

/** Can `target` be reached from `start` by following links forward? */
function reaches(next: Map<string, string[]>, start: string, target: string): boolean {
  const seen = new Set<string>();
  const todo = [start];
  while (todo.length > 0) {
    const id = todo.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    todo.push(...(next.get(id) ?? []));
  }
  return false;
}

/**
 * The dependencies that count. `dependsOn` is merged between devices as one value, so it can
 * name anything: ids that are unknown, deleted, in another plan, the activity itself, or
 * links that together form a loop. Those are ignored here, never refused when stored.
 * Links are looked at in a fixed order (by id), so every device drops the same link of a loop.
 */
export function liveLinks(activities: readonly Scheduled[]): Link[] {
  const live = activities
    .filter((a) => a.deletedAt === null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byId = new Map(live.map((a) => [a.id, a]));
  const next = new Map<string, string[]>();
  const links: Link[] = [];

  for (const to of live) {
    for (const from of [...new Set(to.dependsOn)].sort()) {
      const pred = byId.get(from);
      if (!pred || pred.planId !== to.planId || from === to.id) continue;
      if (reaches(next, to.id, from)) continue; // would close a loop
      links.push({ from, to: to.id });
      next.set(from, [...(next.get(from) ?? []), to.id]);
    }
  }
  return links;
}

/** Would the new link `from → to` close a loop (or link an activity to itself)? */
export function wouldLoop(activities: readonly Scheduled[], from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const l of liveLinks(activities)) next.set(l.from, [...(next.get(l.from) ?? []), l.to]);
  return reaches(next, to, from);
}

/** First day after each activity: the day a successor may start. */
function freeAfter(activities: readonly Scheduled[]): Map<string, number> {
  return new Map(
    activities.filter((a) => a.deletedAt === null).map((a) => [a.id, dayNumber(a.start) + a.days]),
  );
}

/**
 * The functions below take the plan's links as an optional last argument. The links do not
 * depend on the days, so a caller that asks several questions about one plan (the timeline,
 * on every pointer move) computes `liveLinks` once and passes it in.
 */

/**
 * The start days that have to change so that every activity starts after its predecessors
 * have ended (docs/plan/PRD.md FR-136): id → new start. Durations stay; an activity is only
 * ever moved later, to the first allowed day. Empty when the plan is consistent.
 */
export function schedulePlan(
  activities: readonly Scheduled[],
  links: readonly Link[] = liveLinks(activities),
): Map<string, string> {
  const live = activities.filter((a) => a.deletedAt === null);
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const l of links) {
    preds.set(l.to, [...(preds.get(l.to) ?? []), l.from]);
    succs.set(l.from, [...(succs.get(l.from) ?? []), l.to]);
  }

  const start = new Map(live.map((a) => [a.id, dayNumber(a.start)]));
  const days = new Map(live.map((a) => [a.id, a.days]));
  const waiting = new Map(live.map((a) => [a.id, preds.get(a.id)?.length ?? 0]));
  // Predecessors first. `liveLinks` has no loops, so every activity gets its turn.
  const ready = live.filter((a) => waiting.get(a.id) === 0).map((a) => a.id);
  const moved = new Map<string, string>();

  while (ready.length > 0) {
    const id = ready.shift()!;
    let earliest = start.get(id)!;
    for (const p of preds.get(id) ?? []) {
      earliest = Math.max(earliest, start.get(p)! + days.get(p)!);
    }
    if (earliest !== start.get(id)) {
      start.set(id, earliest);
      moved.set(id, dayOf(earliest));
    }
    for (const s of succs.get(id) ?? []) {
      const left = waiting.get(s)! - 1;
      waiting.set(s, left);
      if (left === 0) ready.push(s);
    }
  }
  return moved;
}

/** Links whose successor starts before the predecessor has ended (FR-139). */
export function brokenLinks(
  activities: readonly Scheduled[],
  links: readonly Link[] = liveLinks(activities),
): Link[] {
  const free = freeAfter(activities);
  const start = new Map(activities.map((a) => [a.id, dayNumber(a.start)]));
  return links.filter((l) => start.get(l.to)! < free.get(l.from)!);
}

/** The first day `id` may start on because of its predecessors; `null` if it has none. */
export function earliestStart(
  activities: readonly Scheduled[],
  id: string,
  links: readonly Link[] = liveLinks(activities),
): string | null {
  const free = freeAfter(activities);
  const ends = links.filter((l) => l.to === id).map((l) => free.get(l.from)!);
  return ends.length === 0 ? null : dayOf(Math.max(...ends));
}

/**
 * The activities that can still be put before `id` ("Starts after"): live ones of the same
 * plan that are not linked to it yet (by the links that count) and that do not come after
 * it, which would close a loop. In the given order. One walk over the links, however many
 * candidates there are.
 */
export function linkCandidates(
  activities: readonly Scheduled[],
  id: string,
  links: readonly Link[] = liveLinks(activities),
): string[] {
  const target = activities.find((a) => a.id === id && a.deletedAt === null);
  if (!target) return [];
  const next = new Map<string, string[]>();
  for (const l of links) next.set(l.from, [...(next.get(l.from) ?? []), l.to]);
  // Everything that already waits for `id`, directly or not.
  const after = new Set<string>();
  const todo = [id];
  while (todo.length > 0) {
    for (const s of next.get(todo.pop()!) ?? []) {
      if (!after.has(s)) {
        after.add(s);
        todo.push(s);
      }
    }
  }
  const linked = new Set(links.filter((l) => l.to === id).map((l) => l.from));
  return activities
    .filter(
      (a) =>
        a.deletedAt === null &&
        a.planId === target.planId &&
        a.id !== id &&
        !linked.has(a.id) &&
        !after.has(a.id),
    )
    .map((a) => a.id);
}

/**
 * Stored links between live activities of one plan that `liveLinks` leaves out: the ones
 * that close a loop (after a merge of two devices) and links of an activity to itself.
 * They are invisible, and would show up by themselves once the link they clash with is
 * removed, so the client clears them at that moment. Sorted like `liveLinks`.
 */
export function ignoredLinks(
  activities: readonly Scheduled[],
  links: readonly Link[] = liveLinks(activities),
): Link[] {
  const live = activities
    .filter((a) => a.deletedAt === null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byId = new Map(live.map((a) => [a.id, a]));
  const counted = new Set(links.map((l) => `${l.from}>${l.to}`));
  const ignored: Link[] = [];
  for (const to of live) {
    for (const from of [...new Set(to.dependsOn)].sort()) {
      if (byId.get(from)?.planId !== to.planId) continue;
      if (!counted.has(`${from}>${to.id}`)) ignored.push({ from, to: to.id });
    }
  }
  return ignored;
}
