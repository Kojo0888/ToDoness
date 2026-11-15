import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { CALENDAR_NAME_MAX, addDays, localDay } from '@todoness/shared';
import { getCalendars, getDueTasks, getEventsInRange } from '../../data/queries';
import { db, repo } from '../../app/container';
import { useIsPhone } from '../../app/hooks';
import {
  CALENDAR_VIEWS,
  shiftPeriod,
  viewRange,
  weekDays,
  type CalendarView,
} from '../../lib/calendarGrid';
import { t } from '../../app/strings';
import { InfoTip } from '../common/InfoTip';
import { AgendaView } from './AgendaView';
import { dayLong, monthTitle, weekTitle } from './format';
import { eventItems, taskItems } from './items';
import { MonthCompact, MonthGrid } from './MonthView';
import { newEventPath } from './paths';
import { useCalendarPrefs } from './useCalendarPrefs';
import { WeekView } from './WeekView';

const readClock = () => {
  const d = new Date();
  return { today: localDay(d.getTime()), now: d.getHours() * 60 + d.getMinutes() };
};

/** The title of the period shown. */
function periodTitle(view: CalendarView, day: string): string {
  if (view === 'month') return monthTitle(day);
  if (view === 'week') return weekTitle(weekDays(day));
  return dayLong(day);
}

/**
 * The Calendar module (docs/calendar/PRD.md FR-206, FR-210 – FR-215): a toolbar and one of
 * three views over the events of the calendars that are shown, plus tasks with a due date.
 */
export function CalendarPage() {
  const calendars = useLiveQuery(() => getCalendars(db), []);
  const prefs = useCalendarPrefs();
  const isPhone = useIsPhone();
  const [clock, setClock] = useState(readClock);
  const { today, now } = clock;
  const [day, setDay] = useState(today);
  // Today and the "now" line move on their own once a minute.
  useEffect(() => {
    const id = setInterval(() => setClock(readClock()), 60_000);
    return () => clearInterval(id);
  }, []);

  // On a phone the week shows as the agenda (FR-211).
  const view = prefs.view === 'week' && isPhone ? 'agenda' : prefs.view;
  const range = viewRange(prefs.view === 'week' && isPhone ? 'week' : prefs.view, day);
  const events = useLiveQuery(
    () => getEventsInRange(db, range.from, range.to),
    [range.from, range.to],
    [],
  );
  const tasks = useLiveQuery(
    () => (prefs.showTasks ? getDueTasks(db, range.from, range.to) : Promise.resolve([])),
    [range.from, range.to, prefs.showTasks],
    [],
  );

  if (calendars === undefined) return null;
  if (calendars.length === 0) return <FirstCalendar />;

  const items = [...eventItems(events, calendars, prefs.hidden), ...taskItems(tasks)];
  const openDay = (d: string) => {
    prefs.setView('agenda');
    setDay(d);
  };

  return (
    <section className="calendar-page" aria-label={t.modules.calendar}>
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button
            type="button"
            className="icon-btn"
            aria-label={t.calendar.previous}
            title={t.calendar.previous}
            onClick={() => setDay(shiftPeriod(prefs.view, day, -1))}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={t.calendar.next}
            title={t.calendar.next}
            onClick={() => setDay(shiftPeriod(prefs.view, day, 1))}
          >
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" onClick={() => setDay(today)}>
            {t.calendar.today}
          </button>
        </div>
        <h2 className="cal-title" aria-live="polite">
          {periodTitle(prefs.view, day)}
        </h2>
        <div className="chip-group cal-views" role="group" aria-label={t.calendar.view}>
          {CALENDAR_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className={`chip${prefs.view === v ? ' is-selected' : ''}`}
              aria-pressed={prefs.view === v}
              onClick={() => prefs.setView(v)}
            >
              {t.calendar.views[v]}
            </button>
          ))}
        </div>
        <label className="switch cal-tasks-switch">
          <input
            type="checkbox"
            role="switch"
            checked={prefs.showTasks}
            onChange={(e) => prefs.setShowTasks(e.target.checked)}
          />
          {t.calendar.showTasks}
          <InfoTip text={t.calendar.tasksInfo} label={t.common.moreInfo(t.calendar.showTasks)} />
        </label>
        <Link href={newEventPath(day)} className="btn primary cal-new">
          <span aria-hidden="true">＋ </span>
          {t.calendar.newEvent}
        </Link>
      </div>

      {view === 'month' &&
        (isPhone ? (
          <MonthCompact key={day.slice(0, 7)} day={day} items={items} today={today} />
        ) : (
          <MonthGrid day={day} items={items} today={today} onOpenDay={openDay} />
        ))}
      {view === 'week' && <WeekView day={day} items={items} today={today} now={now} />}
      {view === 'agenda' && (
        <AgendaView
          from={prefs.view === 'week' ? range.from : day}
          to={prefs.view === 'week' ? range.to : addDays(day, 59)}
          today={today}
          items={items}
        />
      )}
    </section>
  );
}

/** With no calendar yet: a field to name the first one (FR-206). */
function FirstCalendar() {
  const [name, setName] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await repo.createCalendar(trimmed);
  }

  return (
    <section className="calendar-page" aria-label={t.modules.calendar}>
      <h2>{t.modules.calendar}</h2>
      <p className="empty">{t.calendar.empty}</p>
      <form onSubmit={(e) => void create(e)} className="plan-first">
        <input
          type="text"
          aria-label={t.calendar.firstCalendar}
          placeholder={t.calendar.firstCalendar}
          value={name}
          maxLength={CALENDAR_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="primary">
          {t.calendar.createCalendar}
        </button>
      </form>
    </section>
  );
}
