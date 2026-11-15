import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import {
  EVENT_DAYS_MAX,
  EVENT_PLACE_MAX,
  EVENT_TITLE_MAX,
  isDay,
  localDay,
  type Calendar,
  type CalendarEvent,
} from '@todoness/shared';
import { getCalendars, getEventById } from '../../data/queries';
import { RepoError } from '../../data/repo';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import { AppBar } from '../common/icons';
import { useUndoToast } from '../common/Toast';
import { CALENDAR_PATH } from './paths';

/** At most this many calendars are chips; more are a select (UI_GUIDELINES.md). */
const CHIPS_MAX = 6;
const DEFAULT_START = '09:00';
const DEFAULT_END = '10:00';

/**
 * A new event (`/calendar/new?day=…`) or an existing one (`/calendar/e/:id`), docs/calendar
 * PRD.md FR-208: native date and time inputs, an All day switch and the calendar.
 */
export function EventPage({ eventId }: { eventId?: string }) {
  const calendars = useLiveQuery(() => getCalendars(db), []);
  // `null` = no such event; `undefined` = still loading.
  const event = useLiveQuery(
    async () => (eventId ? ((await getEventById(db, eventId)) ?? null) : undefined),
    [eventId],
  );
  const search = useSearch();
  const [today] = useState(() => localDay(Date.now()));

  if (calendars === undefined || (eventId && event === undefined)) return null;
  if (eventId && event === null) {
    return (
      <section className="event-page">
        <AppBar
          backHref={CALENDAR_PATH}
          backLabel={t.calendar.back}
          title={t.calendar.editEventTitle}
        />
        <p className="empty">{t.calendar.notFound}</p>
      </section>
    );
  }
  const asked = new URLSearchParams(search).get('day');
  const day = asked && isDay(asked) ? asked : today;
  return (
    <EventForm key={eventId ?? 'new'} event={event ?? undefined} calendars={calendars} day={day} />
  );
}

function EventForm({
  event,
  calendars,
  day,
}: {
  event: CalendarEvent | undefined;
  calendars: Calendar[];
  day: string;
}) {
  const [, navigate] = useLocation();
  const undoToast = useUndoToast();
  const [title, setTitle] = useState(event?.title ?? '');
  const [place, setPlace] = useState(event?.place ?? '');
  const [allDay, setAllDay] = useState(event ? event.startTime === null : true);
  const [date, setDate] = useState(event?.start ?? day);
  const [startTime, setStartTime] = useState(event?.startTime ?? DEFAULT_START);
  const [endTime, setEndTime] = useState(event?.endTime ?? DEFAULT_END);
  const [days, setDays] = useState(event?.days ?? 1);
  const [calendarId, setCalendarId] = useState(event?.calendarId ?? calendars[0]?.id ?? '');
  const [error, setError] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !calendarId) return setError(true);
    const fields = {
      calendarId,
      title,
      place,
      start: date,
      days: allDay ? days : 1,
      startTime: allDay ? null : startTime,
      endTime: allDay || !endTime ? null : endTime,
    };
    try {
      if (event) await repo.updateEvent(event.id, fields);
      else await repo.createEvent(fields);
      navigate(CALENDAR_PATH);
    } catch (err) {
      if (!(err instanceof RepoError)) throw err;
      setError(true);
    }
  }

  async function remove() {
    if (!event) return;
    await repo.deleteEvent(event.id);
    undoToast(t.calendar.eventDeleted, () => void repo.restoreEvent(event.id));
    navigate(CALENDAR_PATH);
  }

  return (
    <section className="event-page">
      <AppBar
        backHref={CALENDAR_PATH}
        backLabel={t.calendar.back}
        title={event ? t.calendar.editEventTitle : t.calendar.newEventTitle}
      />
      <form className="event-form" onSubmit={(e) => void save(e)}>
        <label>
          {t.calendar.title}
          <input
            type="text"
            value={title}
            maxLength={EVENT_TITLE_MAX}
            autoFocus={!event}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          {t.calendar.allDay}
        </label>

        <div className="event-row">
          <label>
            {t.calendar.date}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {allDay ? (
            <label>
              {t.calendar.lasts}
              <input
                type="number"
                min={1}
                max={EVENT_DAYS_MAX}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
              />
            </label>
          ) : (
            <>
              <label>
                {t.calendar.starts}
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </label>
              <label>
                {t.calendar.ends}
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </label>
            </>
          )}
        </div>

        <label>
          {t.calendar.place}
          <input
            type="text"
            value={place}
            maxLength={EVENT_PLACE_MAX}
            onChange={(e) => setPlace(e.target.value)}
          />
        </label>

        {calendars.length <= CHIPS_MAX ? (
          <div className="event-field">
            <span id="event-calendar-label">{t.calendar.calendar}</span>
            <div className="chip-group" role="group" aria-labelledby="event-calendar-label">
              {calendars.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip${c.id === calendarId ? ' is-selected' : ''}`}
                  aria-pressed={c.id === calendarId}
                  onClick={() => setCalendarId(c.id)}
                >
                  <span className={`cal-dot cal-${c.color}`} aria-hidden="true" /> {c.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label>
            {t.calendar.calendar}
            <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && (
          <p className="error" role="alert">
            {t.calendar.saveFailed}
          </p>
        )}

        <div className="event-actions">
          <button type="submit" className="primary">
            {t.calendar.save}
          </button>
          <Link href={CALENDAR_PATH} className="btn">
            {t.calendar.cancel}
          </Link>
          {event && (
            <button type="button" className="danger" onClick={() => void remove()}>
              {t.calendar.deleteEvent}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
