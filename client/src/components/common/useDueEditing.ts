import { fromDateTimeInput, toDateInput, toTimeInput } from '../../lib/dates';
import { usePendingValue } from './usePendingValue';

/**
 * The due date and time of a task detail (private and public lists alike). A date and then
 * a time picked in quick succession combine, even before the first change is saved.
 */
export function useDueEditing(
  savedDueAt: number | null,
  save: (dueAt: number | null) => Promise<boolean>,
) {
  const due = usePendingValue(savedDueAt);
  return {
    dueAt: due.value,
    /** A new date keeps the time of day; '' removes the due date. */
    changeDate: (date: string) => due.set(fromDateTimeInput(date, toTimeInput(due.latest())), save),
    /** A new time of day on the chosen date ('' = no time). */
    async changeTime(time: string) {
      const current = due.latest();
      if (current === null) return false;
      const dueAt = fromDateTimeInput(toDateInput(current), time);
      return dueAt === null ? false : due.set(dueAt, save);
    },
  };
}
