import { useEffect, useRef } from 'react';
import { eventsOnDay, eventSpan } from '@todoness/shared';
import { layoutTimed, weekDays } from '../../lib/calendarGrid';
import { t } from '../../app/strings';
import { EventChip } from './EventChip';
import { dayLong, dayNumberOf, weekdayShort } from './format';
import type { CalItem } from './items';
import { Link } from 'wouter';

/** Pixels per hour in the grid. */
export const HOUR_PX = 40;
/** The grid starts scrolled to this hour (FR-211). */
const FIRST_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const pad = (h: number) => String(h).padStart(2, '0');

/** Seven day columns, an all-day row and an hour grid (docs/calendar/PRD.md FR-211). */
export function WeekView({
  day,
  items,
  today,
  now,
}: {
  day: string;
  items: CalItem[];
  today: string;
  /** Minutes after midnight, for the "now" line in the current week. */
  now: number;
}) {
  const days = weekDays(day);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = FIRST_HOUR * HOUR_PX;
  }, []);

  return (
    <div className="cal-week">
      <div className="cal-week-head">
        <span />
        {days.map((d) => (
          <div key={d} className={`cal-week-dayhead${d === today ? ' is-today' : ''}`}>
            {weekdayShort(d)}
            <b aria-label={dayLong(d)}>{dayNumberOf(d)}</b>
          </div>
        ))}
      </div>
      <div className="cal-week-allday">
        <span>{t.calendar.allDayRow}</span>
        {days.map((d) => (
          <div key={d}>
            {eventsOnDay(items, d)
              .filter((i) => eventSpan(i).from === null)
              .map((i) => (
                <EventChip key={i.key} item={i} />
              ))}
          </div>
        ))}
      </div>
      <div className="cal-week-scroll" ref={scroller}>
        <div className="cal-week-body" style={{ height: 24 * HOUR_PX }}>
          <div className="cal-week-hours" aria-hidden="true">
            {HOURS.map((h) => (
              <span key={h} style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : `${pad(h)}:00`}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className="cal-week-col">
              {layoutTimed(eventsOnDay(items, d), d).map((b) => (
                <Link
                  key={b.event.key}
                  href={b.event.href}
                  aria-label={b.event.label}
                  title={b.event.label}
                  className={`cal-block cal-${b.event.color}`}
                  style={{
                    top: (b.from / 60) * HOUR_PX,
                    height: Math.max(((b.to - b.from) / 60) * HOUR_PX - 2, 18),
                    left: `${(b.column / b.columns) * 100}%`,
                    width: `${100 / b.columns}%`,
                  }}
                >
                  <b>{b.event.startTime}</b> {b.event.title}
                </Link>
              ))}
              {d === today && (
                <div className="cal-now" style={{ top: (now / 60) * HOUR_PX }} aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
