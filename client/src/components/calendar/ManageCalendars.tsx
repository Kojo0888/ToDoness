import { useLiveQuery } from 'dexie-react-hooks';
import { CALENDAR_COLORS, CALENDAR_NAME_MAX } from '@todoness/shared';
import { getCalendars } from '../../data/queries';
import { db, repo } from '../../app/container';
import { dropScope } from '../../lib/dropOrder';
import { t } from '../../app/strings';
import { ManageItems, type ManageText } from '../common/ManageItems';
import { CALENDAR_PATH } from './paths';

const TEXT: ManageText = {
  title: t.manageCalendars.title,
  back: t.manageCalendars.back,
  empty: t.manageCalendars.empty,
  renameLabel: t.calendar.nameLabel,
  deleteItem: t.calendar.deleteCalendar,
  deleteTitle: t.calendar.deleteCalendarTitle,
  deleteText: t.calendar.deleteCalendarText,
  drag: t.manageCalendars.drag,
  reorderFailed: t.manageCalendars.reorderFailed,
};

/** Rename, recolour, reorder and delete calendars (docs/calendar/PRD.md FR-205). */
export function ManageCalendars() {
  const calendars = useLiveQuery(() => getCalendars(db), [], []);
  const colourOf = new Map(calendars.map((c) => [c.id, c.color]));
  return (
    <ManageItems
      items={calendars}
      scope={dropScope.calendars}
      backHref={CALENDAR_PATH}
      nameMax={CALENDAR_NAME_MAX}
      text={TEXT}
      rename={repo.renameCalendar}
      reorder={repo.reorderCalendar}
      remove={repo.deleteCalendar}
      countOf={async (id) =>
        db.events
          .where('calendarId')
          .equals(id)
          .filter((e) => e.deletedAt === null)
          .count()
      }
      extra={(item) => (
        <div
          className="chip-group cal-colours"
          role="group"
          aria-label={t.calendar.colourOf(item.name)}
        >
          {CALENDAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`cal-swatch cal-${c}`}
              aria-label={t.calendar.colours[c]}
              title={t.calendar.colours[c]}
              aria-pressed={colourOf.get(item.id) === c}
              onClick={() => void repo.recolorCalendar(item.id, c)}
            />
          ))}
        </div>
      )}
    />
  );
}
