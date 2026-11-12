/**
 * What one change on a plan's timeline did (docs/plan/PRD.md FR-147): per activity, the
 * fields it changed with their value before and after. Undo writes the "before" values
 * back, and only where the field still has the "after" value, so it can never overwrite
 * something that was changed again since (on this device or another one).
 *
 * A change that moved an activity into or out of a group (FR-187) also records the
 * activities it created (a new group) or removed (an emptied group), so that Undo removes or
 * brings them back. Adding or deleting an activity on its own is not an undo point: it has
 * its own Undo message.
 */
import type { Activity } from '@todoness/shared';

/** What a change on the timeline can alter in an activity. */
export type ActivityState = Pick<Activity, 'id' | 'start' | 'days' | 'dependsOn' | 'done'> & {
  parentId?: string | null;
};
export type ActivityFields = Partial<Omit<ActivityState, 'id'>>;

export interface ActivityChange {
  id: string;
  before: ActivityFields;
  after: ActivityFields;
  /** The change created this activity: Undo deletes it. */
  created?: true;
  /** The change deleted this activity: Undo restores it. */
  deleted?: true;
}

export const sameLinks = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => b[i] === id);

/** The live activities before and after a change: what differs, and what came or went. */
export function diffActivities(
  before: readonly ActivityState[],
  after: readonly ActivityState[],
): ActivityChange[] {
  const now = new Map(after.map((a) => [a.id, a]));
  const was = new Map(before.map((a) => [a.id, a]));
  const changes: ActivityChange[] = [];
  let regrouped = false;
  for (const old of before) {
    const is = now.get(old.id);
    if (!is) continue;
    const change: ActivityChange = { id: old.id, before: {}, after: {} };
    if (old.start !== is.start) {
      change.before.start = old.start;
      change.after.start = is.start;
    }
    if (old.days !== is.days) {
      change.before.days = old.days;
      change.after.days = is.days;
    }
    if (old.done !== is.done) {
      change.before.done = old.done;
      change.after.done = is.done;
    }
    if (!sameLinks(old.dependsOn, is.dependsOn)) {
      change.before.dependsOn = old.dependsOn;
      change.after.dependsOn = is.dependsOn;
    }
    if ((old.parentId ?? null) !== (is.parentId ?? null)) {
      change.before.parentId = old.parentId ?? null;
      change.after.parentId = is.parentId ?? null;
      regrouped = true;
    }
    if (Object.keys(change.before).length > 0) changes.push(change);
  }
  if (!regrouped) return changes;
  for (const a of after) {
    if (!was.has(a.id)) changes.push({ id: a.id, before: {}, after: {}, created: true });
  }
  for (const a of before) {
    if (!now.has(a.id)) changes.push({ id: a.id, before: {}, after: {}, deleted: true });
  }
  return changes;
}
