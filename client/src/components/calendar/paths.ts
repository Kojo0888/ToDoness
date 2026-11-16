export const CALENDAR_PATH = '/calendar';
export const MANAGE_CALENDARS_PATH = '/calendar/manage';
export const eventPath = (id: string) => `/calendar/e/${id}`;
/** A new event, on `day` when given (`?day=YYYY-MM-DD`). */
export const newEventPath = (day?: string) => (day ? `/calendar/new?day=${day}` : '/calendar/new');
