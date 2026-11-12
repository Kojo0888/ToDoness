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
// Groups (docs/plan/PRD.md section 11)
// ---------------------------------------------------------------------------

/** What the rules need to know about an activity. */
export interface Scheduled {
  id: string;
  planId: string;
  start: string;
  days: number;
  dependsOn: readonly string[];
  /** The group it is part of (FR-174); missing or `null` = top level. */
  parentId?: string | null;
  deletedAt: number | null;
}

/** How deep activities can be nested: a top-level activity is on level 1 (FR-174). */
export const GROUP_DEPTH_MAX = 4;

/** The groups of a plan: the parents that count, and each group's children in row order. */
export interface PlanTree {
  parent: ReadonlyMap<string, string>;
  children: ReadonlyMap<string, readonly string[]>;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The parents that count (decision P21). `parentId` is merged between devices like any
 * field, so it can name anything: an unknown or deleted activity, one of another plan, the
 * activity itself, or – after two devices nested two activities into each other – make a
 * loop. Those are ignored. Activities are looked at by id, so every device drops the same
 * parent of a loop. Children keep the order of `activities` (row order).
 */
export function planTree(activities: readonly Scheduled[]): PlanTree {
  const live = activities.filter((a) => a.deletedAt === null);
  const all = new Map(live.map((a) => [a.id, a]));
  const parent = new Map<string, string>();
  for (const a of [...live].sort(byId)) {
    const p = a.parentId;
    if (!p || p === a.id || all.get(p)?.planId !== a.planId) continue;
    let up: string | undefined = p;
    while (up !== undefined && up !== a.id) up = parent.get(up);
    if (up === a.id) continue; // would close a loop
    parent.set(a.id, p);
  }
  const children = new Map<string, string[]>();
  for (const a of live) {
    const p = parent.get(a.id);
    if (p !== undefined) children.set(p, [...(children.get(p) ?? []), a.id]);
  }
  return { parent, children };
}

/** Is `id` a group: an activity with at least one child that counts? */
export const isGroup = (tree: PlanTree, id: string): boolean =>
  (tree.children.get(id)?.length ?? 0) > 0;

/** The activities in `id` that are not groups, in row order; an activity is its own leaf. */
export function leavesOf(tree: PlanTree, id: string): string[] {
  const kids = tree.children.get(id);
  return kids && kids.length > 0 ? kids.flatMap((k) => leavesOf(tree, k)) : [id];
}

/** Is `id` the activity `ancestor` or inside it? */
export function isInside(tree: PlanTree, id: string, ancestor: string): boolean {
  for (let up: string | undefined = id; up !== undefined; up = tree.parent.get(up)) {
    if (up === ancestor) return true;
  }
  return false;
}

/** The level of an activity: 1 at the top level, 2 in a top-level group, … */
export function depthOf(tree: PlanTree, id: string): number {
  let depth = 1;
  for (let up = tree.parent.get(id); up !== undefined; up = tree.parent.get(up)) depth++;
  return depth;
}

/** How many levels an activity takes: 1 for an activity, 2 for a group of activities, … */
export function heightOf(tree: PlanTree, id: string): number {
  const kids = tree.children.get(id) ?? [];
  return 1 + Math.max(0, ...kids.map((k) => heightOf(tree, k)));
}

/**
 * The days of every live activity (FR-175, decision P22): its own, or for a group from the
 * earliest start to the latest end of its children – whatever the group stores.
 */
export function spansOf(
  activities: readonly Scheduled[],
  tree: PlanTree = planTree(activities),
): Map<string, { start: string; days: number }> {
  const own = new Map(
    activities.filter((a) => a.deletedAt === null).map((a) => [a.id, a] as const),
  );
  const result = new Map<string, { start: string; days: number }>();
  const visit = (id: string): { from: number; to: number } => {
    const kids = tree.children.get(id);
    let from: number;
    let to: number;
    if (kids && kids.length > 0) {
      from = Infinity;
      to = -Infinity;
      for (const k of kids) {
        const s = visit(k);
        from = Math.min(from, s.from);
        to = Math.max(to, s.to);
      }
    } else {
      const a = own.get(id)!;
      from = dayNumber(a.start);
      to = from + a.days; // the first day after
    }
    result.set(id, { start: dayOf(from), days: to - from });
    return { from, to };
  };
  for (const id of own.keys()) if (!result.has(id)) visit(id);
  return result;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

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
 * A link stands for links between the activities in its two ends (decision P24): from every
 * leaf of `from` to every leaf of `to`. Successors per leaf.
 */
function leafGraph(links: readonly Link[], tree: PlanTree): Map<string, string[]> {
  const next = new Map<string, string[]>();
  for (const l of links) {
    const to = leavesOf(tree, l.to);
    for (const f of leavesOf(tree, l.from)) next.set(f, [...(next.get(f) ?? []), ...to]);
  }
  return next;
}

/** Would `from → to`, as links between their leaves, close a loop in `next`? */
const closesLoop = (next: Map<string, string[]>, tree: PlanTree, from: string, to: string) => {
  const fromLeaves = leavesOf(tree, from);
  return leavesOf(tree, to).some((t) => fromLeaves.some((f) => reaches(next, t, f)));
};

/**
 * The dependencies that count. `dependsOn` is merged between devices as one value, so it can
 * name anything: ids that are unknown, deleted, in another plan, the activity itself, a group
 * it is in or an activity inside it (FR-183), or links that together form a loop – also
 * through groups. Those are ignored here, never refused when stored. Links are looked at in a
 * fixed order (by id), so every device drops the same link of a loop.
 */
export function liveLinks(activities: readonly Scheduled[]): Link[] {
  const tree = planTree(activities);
  const live = activities.filter((a) => a.deletedAt === null).sort(byId);
  const all = new Map(live.map((a) => [a.id, a]));
  const next = new Map<string, string[]>();
  const links: Link[] = [];

  for (const to of live) {
    for (const from of [...new Set(to.dependsOn)].sort()) {
      const pred = all.get(from);
      if (!pred || pred.planId !== to.planId || from === to.id) continue;
      if (isInside(tree, from, to.id) || isInside(tree, to.id, from)) continue;
      if (closesLoop(next, tree, from, to.id)) continue;
      links.push({ from, to: to.id });
      const toLeaves = leavesOf(tree, to.id);
      for (const f of leavesOf(tree, from)) next.set(f, [...(next.get(f) ?? []), ...toLeaves]);
    }
  }
  return links;
}

/**
 * Would the new link `from → to` close a loop, link an activity to itself, or link a group
 * and an activity inside it?
 */
export function wouldLoop(activities: readonly Scheduled[], from: string, to: string): boolean {
  if (from === to) return true;
  const tree = planTree(activities);
  if (isInside(tree, from, to) || isInside(tree, to, from)) return true;
  return closesLoop(leafGraph(liveLinks(activities), tree), tree, from, to);
}

/**
 * The functions below take the plan's links as an optional last argument. The links do not
 * depend on the days, so a caller that asks several questions about one plan (the timeline,
 * on every pointer move) computes `liveLinks` once and passes it in.
 */

/** Predecessors of every leaf, from the links (to a group, to its ancestors) that count. */
function leafPreds(links: readonly Link[], tree: PlanTree): Map<string, Set<string>> {
  const preds = new Map<string, Set<string>>();
  for (const [f, tos] of leafGraph(links, tree)) {
    for (const t of tos) preds.set(t, (preds.get(t) ?? new Set()).add(f));
  }
  return preds;
}

/**
 * The start days that have to change so that every activity starts after its predecessors
 * have ended (docs/plan/PRD.md FR-136): id → new start. Durations stay; an activity is only
 * ever moved later, to the first allowed day. Empty when the plan is consistent. Only
 * activities that are not groups are moved; a group follows them (FR-175, FR-183).
 */
export function schedulePlan(
  activities: readonly Scheduled[],
  links: readonly Link[] = liveLinks(activities),
): Map<string, string> {
  const tree = planTree(activities);
  const leaves = activities.filter((a) => a.deletedAt === null && !isGroup(tree, a.id));
  const preds = leafPreds(links, tree);
  const succs = new Map<string, string[]>();
  for (const [t, from] of preds) {
    for (const f of from) succs.set(f, [...(succs.get(f) ?? []), t]);
  }

  const start = new Map(leaves.map((a) => [a.id, dayNumber(a.start)]));
  const days = new Map(leaves.map((a) => [a.id, a.days]));
  const waiting = new Map(leaves.map((a) => [a.id, preds.get(a.id)?.size ?? 0]));
  // Predecessors first. `liveLinks` has no loops, so every activity gets its turn.
  const ready = leaves.filter((a) => waiting.get(a.id) === 0).map((a) => a.id);
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

/** Links whose successor starts before the predecessor has ended (FR-139), by group dates. */
export function brokenLinks(
  activities: readonly Scheduled[],
  links: readonly Link[] = liveLinks(activities),
): Link[] {
  const spans = spansOf(activities);
  const free = (id: string) => dayNumber(spans.get(id)!.start) + spans.get(id)!.days;
  return links.filter((l) => dayNumber(spans.get(l.to)!.start) < free(l.from));
}

/**
 * The first day `id` may start on because of its predecessors; `null` if it has none. For a
 * group (FR-182): the first day it may move to so that every activity in it still starts
 * after its predecessors outside the group.
 */
export function earliestStart(
  activities: readonly Scheduled[],
  id: string,
  links: readonly Link[] = liveLinks(activities),
): string | null {
  const tree = planTree(activities);
  const spans = spansOf(activities, tree);
  if (!spans.has(id)) return null;
  const inside = new Set(leavesOf(tree, id));
  const preds = leafPreds(links, tree);
  const startOf = (x: string) => dayNumber(spans.get(x)!.start);
  let shift: number | null = null;
  for (const leaf of inside) {
    for (const p of preds.get(leaf) ?? []) {
      if (inside.has(p)) continue;
      const need = startOf(p) + spans.get(p)!.days - startOf(leaf);
      shift = shift === null ? need : Math.max(shift, need);
    }
  }
  return shift === null ? null : dayOf(startOf(id) + shift);
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

/**
 * The row order that sorts a plan (docs/plan-sort FR-189 – FR-191): the ids of the live
 * activities, top level first, every group followed by its own children, each set of siblings
 * sorted by start day (a group by its first activity). Ties keep the present row order. An
 * activity never comes before one it starts after, as far as they are siblings: a link
 * between leaves counts for the siblings that contain them (decision P24). Siblings that wait
 * for each other through groups (a loop that only exists between the groups) are broken at
 * the earliest start. Pure; `activities` are in their present row order.
 */
export function sortedActivityIds(
  activities: readonly Scheduled[],
  links: readonly Link[] = liveLinks(activities),
): string[] {
  const tree = planTree(activities);
  const live = activities.filter((a) => a.deletedAt === null);
  const row = new Map(live.map((a, i) => [a.id, i]));
  const spans = spansOf(activities, tree);
  const leafNext = leafGraph(links, tree);

  const orderSiblings = (ids: readonly string[]): string[] => {
    if (ids.length < 2) return [...ids];
    const owner = new Map<string, string>(); // leaf -> the sibling it is in
    for (const id of ids) for (const leaf of leavesOf(tree, id)) owner.set(leaf, id);
    // preds.get(y) = the siblings that have to come before y
    const preds = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
    for (const x of ids) {
      const seen = new Set<string>();
      const todo = leavesOf(tree, x);
      while (todo.length > 0) {
        const leaf = todo.pop()!;
        for (const next of leafNext.get(leaf) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          todo.push(next);
          const y = owner.get(next);
          if (y !== undefined && y !== x) preds.get(y)!.add(x);
        }
      }
    }
    const better = (a: string, b: string) =>
      dayNumber(spans.get(a)!.start) - dayNumber(spans.get(b)!.start) || row.get(a)! - row.get(b)!;
    const remaining = new Set(ids);
    const result: string[] = [];
    while (remaining.size > 0) {
      const all = [...remaining];
      const ready = all.filter((id) => [...preds.get(id)!].every((p) => !remaining.has(p)));
      const pick = (ready.length > 0 ? ready : all).sort(better)[0]!;
      remaining.delete(pick);
      result.push(pick);
    }
    return result;
  };

  const out: string[] = [];
  const visit = (ids: readonly string[]) => {
    for (const id of orderSiblings(ids)) {
      out.push(id);
      visit(tree.children.get(id) ?? []);
    }
  };
  visit(live.filter((a) => !tree.parent.has(a.id)).map((a) => a.id));
  return out;
}
