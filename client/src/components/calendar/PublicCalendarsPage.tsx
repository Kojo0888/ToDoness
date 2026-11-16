import { useEffect, useState } from 'react';
import {
  addDays,
  localDay,
  occurrenceDays,
  publicCalendarsResponseSchema,
  type PublicCalendarsResponse,
} from '@todoness/shared';
import { agendaGroups } from '../../lib/calendarGrid';
import { t } from '../../app/strings';
import { AppBar } from '../common/icons';
import { dayLong, timeText } from './format';
import { CALENDAR_PATH } from './paths';
import type { CalItem } from './items';

/** How far ahead the public calendars are listed. */
const DAYS_AHEAD = 60;

interface PublicItem extends CalItem {
  description: string;
  owner: string;
  calendar: string;
}

/**
 * The upcoming events of other users' public calendars (docs/calendar/PRD.md FR-242), grouped
 * by day. Read-only: nothing here links to an editor. Read on demand, not synced (decision C12).
 */
export function PublicCalendarsPage() {
  const [data, setData] = useState<PublicCalendarsResponse | null | undefined>(undefined);
  const [today] = useState(() => localDay(Date.now()));

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/public/calendars');
        const body = res.ok ? publicCalendarsResponseSchema.safeParse(await res.json()) : undefined;
        if (alive && body?.success) setData(body.data);
        else if (alive && !res.ok) setData((old) => old ?? null);
      } catch {
        if (alive) setData((old) => old ?? null); // offline: keep what is shown
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const to = addDays(today, DAYS_AHEAD - 1);
  const items: PublicItem[] = (data?.calendars ?? []).flatMap((c) =>
    c.events.flatMap((e) =>
      occurrenceDays(e, today, to).map((day) => ({
        key: `${e.id}:${day}`,
        kind: 'event' as const,
        title: e.title,
        start: day,
        days: e.days,
        startTime: e.startTime,
        endTime: e.endTime,
        href: '',
        color: c.color,
        detail: e.place,
        label: `${e.title}, ${day}`,
        description: e.description,
        owner: c.ownerEmail,
        calendar: c.name,
      })),
    ),
  );
  const groups = agendaGroups(items, today, to, '').filter((g) => g.events.length > 0);

  return (
    <section className="cal-public">
      <AppBar
        backHref={CALENDAR_PATH}
        backLabel={t.calendar.publicBack}
        title={t.calendar.publicCalendars}
      />
      {data === null && (
        <p className="error" role="alert">
          {t.calendar.publicFailed}
        </p>
      )}
      {data && groups.length === 0 && <p className="empty">{t.calendar.publicEmpty}</p>}
      <div className="cal-agenda">
        {groups.map((g) => (
          <section key={g.day} className="cal-day" aria-label={dayLong(g.day)}>
            <h3>{dayLong(g.day)}</h3>
            <ul className="cal-rows">
              {g.events.map((item) => (
                <li key={item.key} className="cal-row">
                  <span className="cal-row-time">{timeText(item)}</span>
                  <span className={`cal-row-bar cal-${item.color}`} aria-hidden="true" />
                  <span className="cal-row-what">
                    {item.title}
                    <small>{t.calendar.publicBy(item.calendar, item.owner)}</small>
                    {item.detail && <small>{item.detail}</small>}
                    {item.description && <small className="cal-desc">{item.description}</small>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
