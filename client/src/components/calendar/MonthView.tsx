import { useState } from 'react';
import { eventsOnDay } from '@todoness/shared';
import { firstOfMonth, monthGrid } from '../../lib/calendarGrid';
import { t } from '../../app/strings';
import { EventChip } from './EventChip';
import { dayLong, dayNumberOf, weekdayShort } from './format';
import type { CalItem } from './items';
import { AgendaRows } from './AgendaView';

const MAX_PER_DAY = 3;
/** 2026-11-09 is a Monday: the header names of the weekdays. */
const HEADER_DAYS = Array.from(
  { length: 7 },
  (_, i) => `2026-11-${String(9 + i).padStart(2, '0')}`,
);

/** A grid of weeks for a computer (docs/calendar/PRD.md FR-210). */
export function MonthGrid({
  day,
  items,
  today,
  onOpenDay,
}: {
  day: string;
  items: CalItem[];
  today: string;
  onOpenDay: (day: string) => void;
}) {
  const month = day.slice(0, 7);
  return (
    <div className="cal-month" role="grid" aria-label={t.calendar.views.month}>
      <div className="cal-month-head" role="row">
        {HEADER_DAYS.map((d) => (
          <div key={d} role="columnheader" className="cal-dow">
            {weekdayShort(d)}
          </div>
        ))}
      </div>
      {monthGrid(day).map((week) => (
        <div key={week[0]} className="cal-month-week" role="row">
          {week.map((d) => {
            const list = eventsOnDay(items, d);
            const shown = list.slice(0, MAX_PER_DAY);
            const more = list.length - shown.length;
            return (
              <div
                key={d}
                role="gridcell"
                className={`cal-cell${d.startsWith(month) ? '' : ' is-out'}${d === today ? ' is-today' : ''}`}
              >
                <button
                  type="button"
                  className="cal-daynum"
                  aria-label={t.calendar.dayLabel(dayLong(d))}
                  onClick={() => onOpenDay(d)}
                >
                  {dayNumberOf(d)}
                </button>
                {shown.map((item) => (
                  <EventChip key={item.key} item={item} />
                ))}
                {more > 0 && (
                  <button type="button" className="cal-more" onClick={() => onOpenDay(d)}>
                    {t.calendar.moreEvents(more)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * A small month with a dot for every day that has something, and the chosen day's events
 * below it, for a phone: nothing is squeezed into tiny cells (FR-210).
 */
export function MonthCompact({
  day,
  items,
  today,
}: {
  day: string;
  items: CalItem[];
  today: string;
}) {
  const month = firstOfMonth(day);
  const [chosen, setChosen] = useState<string | null>(null);
  // The chosen day only counts while it is in the month shown; otherwise today, or the 1st.
  const selected =
    chosen !== null && chosen.startsWith(month.slice(0, 7))
      ? chosen
      : today.startsWith(month.slice(0, 7))
        ? today
        : month;
  return (
    <div className="cal-month-compact">
      <div className="cal-compact-grid" role="grid" aria-label={t.calendar.views.month}>
        {HEADER_DAYS.map((d) => (
          <div key={d} role="columnheader" className="cal-dow">
            {weekdayShort(d).slice(0, 2)}
          </div>
        ))}
        {monthGrid(day)
          .flat()
          .map((d) => {
            const list = eventsOnDay(items, d);
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                aria-label={dayLong(d)}
                aria-pressed={d === selected}
                className={`cal-compact-day${d.startsWith(month.slice(0, 7)) ? '' : ' is-out'}${d === today ? ' is-today' : ''}`}
                onClick={() => setChosen(d)}
              >
                {dayNumberOf(d)}
                <span className="cal-dots" aria-hidden="true">
                  {list.slice(0, 3).map((item) => (
                    <i
                      key={item.key}
                      className={item.kind === 'task' ? 'cal-task' : `cal-${item.color}`}
                    />
                  ))}
                </span>
              </button>
            );
          })}
      </div>
      <AgendaRows day={selected} today={today} events={eventsOnDay(items, selected)} />
    </div>
  );
}
