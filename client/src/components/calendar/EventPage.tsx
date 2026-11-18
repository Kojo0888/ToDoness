import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import {
  EVENT_DAYS_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_PLACE_MAX,
  EVENT_REMINDS,
  EVENT_TITLE_MAX,
  REPEATS,
  addDays,
  dayNumber,
  isDay,
  localDay,
  type Calendar,
  type CalendarEvent,
  type EventRemind,
  type Repeat,
} from '@todoness/shared';
import { getCalendars, getEventById } from '../../data/queries';
import { RepoError } from '../../data/repo';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import { AppBar } from '../common/icons';
import { AttachmentsSection } from '../lists/Attachments';
import { InfoTip } from '../common/InfoTip';
import { useUndoToast } from '../common/Toast';
import { CALENDAR_PATH } from './paths';

/** At most this many calendars are chips; more are a select (UI_GUIDELINES.md). */
const CHIPS_MAX = 6;
const DEFAULT_START = '09:00';
const DEFAULT_END = '10:00';

/**
 * A new event (`/calendar/new?day=…`) or an existing one (`/calendar/e/:id`), docs/calendar
 * PRD.md FR-208: native date and time inputs, an All day switch and the calendar. Start and
 * end are a date each (and a time each when the event is not all day), FR-245.
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
  // The end date is kept whether or not the event is all day (FR-245).
  const [endDate, setEndDate] = useState(event ? addDays(event.start, event.days - 1) : day);
  const [description, setDescription] = useState(event?.description ?? '');
  const [calendarId, setCalendarId] = useState(event?.calendarId ?? calendars[0]?.id ?? '');
  const [repeat, setRepeat] = useState<Repeat>(event?.repeat ?? 'none');
  const [repeatUntil, setRepeatUntil] = useState(event?.repeatUntil ?? '');
  const [reminders, setReminders] = useState<EventRemind[]>(event?.reminders ?? []);
  const [error, setError] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const days = dayNumber(endDate) - dayNumber(date) + 1;
    if (!title.trim() || !calendarId || !(days >= 1 && days <= EVENT_DAYS_MAX)) {
      return setError(true);
    }
    const fields = {
      calendarId,
      title,
      place,
      description,
      start: date,
      days,
      startTime: allDay ? null : startTime,
      endTime: allDay || !endTime ? null : endTime,
      repeat,
      repeatUntil: repeat === 'none' || !repeatUntil ? null : repeatUntil,
      reminders,
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
            {t.calendar.startDate}
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                // The end never comes before the start: it moves along.
                if (isDay(e.target.value) && endDate < e.target.value) setEndDate(e.target.value);
              }}
            />
          </label>
          {!allDay && (
            <label>
              {t.calendar.starts}
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
          )}
        </div>
        <div className="event-row">
          <label>
            {t.calendar.endDate}
            <input
              type="date"
              value={endDate}
              min={date}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          {!allDay && (
            <label>
              {t.calendar.ends}
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
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

        <label>
          {t.calendar.description}
          <textarea
            value={description}
            maxLength={EVENT_DESCRIPTION_MAX}
            rows={4}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="event-field">
          <span id="event-repeat-label">{t.calendar.repeats}</span>
          <div className="chip-group" role="group" aria-labelledby="event-repeat-label">
            {REPEATS.map((r) => (
              <button
                key={r}
                type="button"
                className={`chip${r === repeat ? ' is-selected' : ''}`}
                aria-pressed={r === repeat}
                onClick={() => setRepeat(r)}
              >
                {t.calendar.repeatChoices[r]}
              </button>
            ))}
          </div>
        </div>
        {repeat !== 'none' && (
          <div className="event-row event-until">
            <label>
              {t.calendar.repeatUntil}
              <input
                type="date"
                value={repeatUntil}
                min={date}
                onChange={(e) => setRepeatUntil(e.target.value)}
              />
            </label>
            {repeatUntil && (
              <button type="button" onClick={() => setRepeatUntil('')}>
                {t.calendar.noEnd}
              </button>
            )}
          </div>
        )}

        <div className="event-field">
          <span id="event-reminders-label" className="event-label-row">
            {t.calendar.reminders}
            <InfoTip
              text={t.calendar.remindersInfo}
              label={t.common.moreInfo(t.calendar.reminders)}
            />
          </span>
          <div className="chip-group" role="group" aria-labelledby="event-reminders-label">
            {[...EVENT_REMINDS].reverse().map((r) => (
              <button
                key={r}
                type="button"
                className={`chip${reminders.includes(r) ? ' is-selected' : ''}`}
                aria-pressed={reminders.includes(r)}
                onClick={() =>
                  setReminders(
                    reminders.includes(r) ? reminders.filter((x) => x !== r) : [...reminders, r],
                  )
                }
              >
                {t.calendar.reminderChoices[r]}
              </button>
            ))}
          </div>
        </div>

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

        {/* Files need a saved event (FR-250). */}
        {event && <AttachmentsSection parent={{ kind: 'events', id: event.id }} />}

        {error && (
          <p className="error" role="alert">
            {t.calendar.saveFailed}
          </p>
        )}

        {/* Cancel and Save on the right, Save last; Delete stays on the left (FR-247). */}
        <div className="event-actions">
          {event && (
            <button type="button" className="danger event-delete" onClick={() => void remove()}>
              {t.calendar.deleteEvent}
            </button>
          )}
          <Link href={CALENDAR_PATH} className="btn">
            {t.calendar.cancel}
          </Link>
          <button type="submit" className="primary">
            {t.calendar.save}
          </button>
        </div>
      </form>
    </section>
  );
}
