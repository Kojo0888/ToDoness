/**
 * What one change on a plan's timeline did (docs/plan/PRD.md FR-147): per activity, the
 * fields it changed with their value before and after. Undo writes the "before" values
 * back, and only where the field still has the "after" value, so it can never overwrite
 * something that was changed again since (on this device or another one).
 */
import type { Activity } from '@todoness/shared';

/** What a change on the timeline can alter in an activity. */
export type ActivityState = Pick<Activity, 'id' | 'start' | 'days' | 'dependsOn' | 'done'>;
export type ActivityFields = Partial<Omit<ActivityState, 'id'>>;

export interface ActivityChange {
  id: string;
  before: ActivityFields;
  after: ActivityFields;
}

export const sameLinks = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => b[i] === id);

/** The activities that are in both lists and differ, with the fields that differ. */
export function diffActivities(
  before: readonly ActivityState[],
  after: readonly ActivityState[],
): ActivityChange[] {
  const now = new Map(after.map((a) => [a.id, a]));
  const changes: ActivityChange[] = [];
  for (const was of before) {
    const is = now.get(was.id);
    if (!is) continue;
    const change: ActivityChange = { id: was.id, before: {}, after: {} };
    if (was.start !== is.start) {
      change.before.start = was.start;
      change.after.start = is.start;
    }
    if (was.days !== is.days) {
      change.before.days = was.days;
      change.after.days = is.days;
    }
    if (was.done !== is.done) {
      change.before.done = was.done;
      change.after.done = is.done;
    }
    if (!sameLinks(was.dependsOn, is.dependsOn)) {
      change.before.dependsOn = was.dependsOn;
      change.after.dependsOn = is.dependsOn;
    }
    if (Object.keys(change.before).length > 0) changes.push(change);
  }
  return changes;
}
