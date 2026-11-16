/** The Calendar module and the module picker in the real app (docs/calendar/PRD.md). */
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  launch,
  newDevice,
  newPage,
  signUp,
  startApp,
  syncNow,
  uniqueEmail,
  waitSaved,
  type App,
} from './harness';

let app: App;
let browser: Browser;

beforeAll(async () => {
  app = await startApp();
  browser = await launch();
  // The first account is the admin; keep it out of the way.
  await signUp(await newPage(await newDevice(browser, app)), uniqueEmail('admin'));
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

const modules = (page: Page) => page.getByRole('group', { name: 'Modules' });
const views = (page: Page) => page.getByRole('group', { name: 'Calendar view' });
const view = (page: Page, name: string) => views(page).getByRole('button', { name, exact: true });
const eventLink = (page: Page, title: string) =>
  page.getByRole('link', { name: new RegExp(`^${title},`) }).first();

const today = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });

async function newUser(name: string, viewport?: { width: number; height: number }) {
  const email = uniqueEmail(name);
  const context = await newDevice(browser, app, viewport);
  const page = await newPage(context);
  await signUp(page, email);
  return { email, context, page };
}

async function openCalendar(page: Page) {
  await modules(page).getByRole('link', { name: 'Calendar' }).first().click();
  await page.waitForURL(/\/calendar/);
}

/** Every account starts with "My calendar" (FR-244): rename it, so the tests keep their names. */
async function firstCalendar(page: Page, name: string) {
  // By address, so it also works on a phone (where the link is in the menu).
  await page.goto(new URL('/calendar/manage', page.url()).href);
  await page.getByRole('button', { name: 'Actions: My calendar' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const field = page.getByLabel('Calendar name', { exact: true });
  await field.fill(name);
  await field.press('Enter');
  await page.locator('.manage-name', { hasText: name }).waitFor();
  await page.getByRole('link', { name: 'Back to the calendar' }).click();
  await view(page, 'Month').waitFor();
}

async function addEvent(
  page: Page,
  title: string,
  opts: { day?: string; start?: string; end?: string } = {},
) {
  await page.getByRole('link', { name: 'New event' }).click();
  await page.getByLabel('Title').fill(title);
  if (opts.day) await page.getByLabel('Start date').fill(opts.day);
  if (opts.start) {
    await page.getByRole('switch', { name: 'All day' }).uncheck();
    await page.getByLabel('Starts').fill(opts.start);
    if (opts.end) await page.getByLabel('Ends').fill(opts.end);
  }
  await page.getByRole('button', { name: 'Save' }).click();
  await view(page, 'Month').waitFor();
}

describe('module picker (four modules)', () => {
  it('lists every module with its full name; Calendar is the fourth; the current one is marked', async () => {
    const { page, context } = await newUser('picker');
    const names = await modules(page).getByRole('link').allInnerTexts();
    expect(names.map((n) => n.trim()).filter(Boolean)).toEqual(
      expect.arrayContaining(['Tasks', 'Notes', 'Plan', 'Calendar']),
    );
    await openCalendar(page);
    await expect
      .poll(() =>
        modules(page).getByRole('link', { name: 'Calendar' }).first().getAttribute('aria-current'),
      )
      .toBe('page');
    await context.close();
  });

  it('on a phone it is a bar at the bottom with 44 px targets; the top bar has no module links', async () => {
    const { page, context } = await newUser('phonebar', { width: 390, height: 780 });
    const bar = page.locator('div.tabbar');
    await bar.waitFor();
    const box = (await bar.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(700);
    const links = bar.getByRole('link');
    expect(await links.count()).toBe(4);
    for (let i = 0; i < 4; i++) {
      const b = (await links.nth(i).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
    await page
      .locator('header.topbar')
      .getByRole('link', { name: 'Calendar' })
      .waitFor({ state: 'hidden' });
    await links.filter({ hasText: 'Calendar' }).click();
    await page.waitForURL(/\/calendar/);
    await context.close();
  });

  it('on a computer it is a vertical list in the sidebar', async () => {
    const { page, context } = await newUser('rail');
    const rail = page
      .locator('aside nav.module-rail, .sidebar nav.module-rail, .sidebar .module-rail')
      .first();
    await rail.waitFor();
    const a = (await rail.getByRole('link', { name: 'Tasks' }).boundingBox())!;
    const b = (await rail.getByRole('link', { name: 'Calendar' }).boundingBox())!;
    expect(b.y).toBeGreaterThan(a.y + 20);
    await context.close();
  });
});

describe('calendars and events', () => {
  it('starts with "My calendar", adds an event and shows it in the month', async () => {
    const { page, context } = await newUser('month');
    await openCalendar(page);
    await firstCalendar(page, 'Work');
    await expect.poll(() => view(page, 'Month').getAttribute('aria-pressed')).toBe('true'); // computer default
    await addEvent(page, 'Dentist', { start: '09:30', end: '10:15' });
    await eventLink(page, 'Dentist').waitFor();
    await page.getByRole('button', { name: 'Today' }).waitFor();
    await context.close();
  });

  it('opens an event, changes it and deletes it with an Undo', async () => {
    const { page, context } = await newUser('edit');
    await openCalendar(page);
    await firstCalendar(page, 'Work');
    await addEvent(page, 'Standup');
    await eventLink(page, 'Standup').click();
    await page.getByLabel('Title').fill('Standup (moved)');
    await page.getByLabel('Place').fill('Room 4');
    await page.getByRole('button', { name: 'Save' }).click();
    await eventLink(page, 'Standup \\(moved\\)').waitFor();

    await eventLink(page, 'Standup \\(moved\\)').click();
    await page.getByRole('button', { name: 'Delete event' }).click();
    await eventLink(page, 'Standup').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Undo' }).click();
    await eventLink(page, 'Standup \\(moved\\)').waitFor();
    await context.close();
  });

  it('switches between Month, Week and Agenda and moves through time', async () => {
    const { page, context } = await newUser('views');
    await openCalendar(page);
    await firstCalendar(page, 'Work');
    await addEvent(page, 'Gym', { start: '18:00', end: '19:00' });

    await view(page, 'Week').click();
    await expect.poll(() => view(page, 'Week').getAttribute('aria-pressed')).toBe('true');
    await page.locator('.cal-week').waitFor();
    await eventLink(page, 'Gym').waitFor();

    await view(page, 'Agenda').click();
    await page.locator('.cal-agenda').waitFor();
    await eventLink(page, 'Gym').waitFor();

    await view(page, 'Month').click();
    const title = await page.locator('.cal-title').innerText();
    await page.getByRole('button', { name: 'Next' }).click();
    expect(await page.locator('.cal-title').innerText()).not.toBe(title);
    await eventLink(page, 'Gym').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Today' }).click();
    expect(await page.locator('.cal-title').innerText()).toBe(title);
    await eventLink(page, 'Gym').waitFor();

    // The view is a device setting: it is still Month after a reload.
    await view(page, 'Week').click();
    await page.reload();
    await expect.poll(() => view(page, 'Week').getAttribute('aria-pressed')).toBe('true');
    await context.close();
  });

  it('hides and shows a calendar; the choice stays on this device', async () => {
    const { page, context } = await newUser('hide');
    await openCalendar(page);
    await firstCalendar(page, 'Work');
    await addEvent(page, 'Visible one');
    const toggle = page
      .getByRole('group', { name: 'Calendars' })
      .getByRole('button', { name: 'Work' });
    await expect.poll(() => toggle.getAttribute('aria-pressed')).toBe('true');
    await toggle.click();
    await expect.poll(() => toggle.getAttribute('aria-pressed')).toBe('false');
    await eventLink(page, 'Visible one').waitFor({ state: 'hidden' });
    await toggle.click();
    await eventLink(page, 'Visible one').waitFor();
    await context.close();
  });

  it('a second calendar has its own colour and name; managing renames and deletes it with its events', async () => {
    const { page, context } = await newUser('manage');
    await openCalendar(page);
    await firstCalendar(page, 'Work');
    await page.getByLabel('New calendar name').fill('Home');
    await page.getByLabel('New calendar name').press('Enter');
    await page
      .getByRole('group', { name: 'Calendars' })
      .getByRole('button', { name: 'Home' })
      .waitFor();

    await page.getByRole('link', { name: 'Manage calendars' }).click();
    await page.waitForURL(/\/calendar\/manage/);
    await page.locator('.manage-name', { hasText: 'Work' }).waitFor();
    const red = page
      .getByRole('group', { name: 'Colour of Home' })
      .getByRole('button', { name: 'Red', exact: true });
    await red.click();
    await expect.poll(() => red.getAttribute('aria-pressed')).toBe('true');
    await context.close();
  });

  it('a phone shows the agenda by default and the month with a day list', async () => {
    const { page, context } = await newUser('phone', { width: 390, height: 780 });
    await openCalendar(page);
    await firstCalendar(page, 'Work');
    await expect.poll(() => view(page, 'Agenda').getAttribute('aria-pressed')).toBe('true');
    await view(page, 'Month').click();
    await page.locator('.cal-month-compact').waitFor();
    const b = (await page.getByRole('link', { name: 'New event' }).boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await context.close();
  });

  it('calendars and events appear on the second device of the user', async () => {
    const { email, page, context } = await newUser('sync');
    await openCalendar(page);
    await firstCalendar(page, 'Work');
    const day = await today(page);
    await addEvent(page, 'Shared event', { day });
    await waitSaved(page);
    await syncNow(page);

    const second = await newPage(await newDevice(browser, app));
    const { logIn } = await import('./harness');
    await logIn(second, email);
    await openCalendar(second);
    await eventLink(second, 'Shared event').waitFor();
    await context.close();
  });
});

/** Today's day and a time `minutes` from now, as the page's own clock shows them. */
const soon = (page: Page, minutes: number) =>
  page.evaluate((m) => {
    const d = new Date(Date.now() + m * 60_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
      time: `${p(d.getHours())}:${p(d.getMinutes())}`,
    };
  }, minutes);
const plus = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const chip = (page: Page, group: string, name: string) =>
  page.getByRole('group', { name: group }).getByRole('button', { name, exact: true });

describe('repeating events and reminders', () => {
  it('a weekly event shows in later months; "Repeat until" stops it', async () => {
    const { page, context } = await newUser('repeat');
    await openCalendar(page);
    await firstCalendar(page, 'Work');
    await page.getByRole('link', { name: 'New event' }).click();
    await page.getByLabel('Title').fill('Standup');
    await chip(page, 'Repeats', 'Weekly').click();
    await expect
      .poll(() => chip(page, 'Repeats', 'Weekly').getAttribute('aria-pressed'))
      .toBe('true');
    await page.getByRole('button', { name: 'Save' }).click();
    await view(page, 'Month').waitFor();

    await page.getByRole('button', { name: 'Next' }).click();
    await eventLink(page, 'Standup').waitFor(); // an occurrence next month
    await page.getByRole('button', { name: 'Today' }).click();

    await eventLink(page, 'Standup').click();
    await chip(page, 'Repeats', 'Weekly').waitFor();
    await page.getByLabel('Repeat until').fill(plus(await today(page), 10));
    await page.getByRole('button', { name: 'Save' }).click();
    await view(page, 'Month').waitFor();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await eventLink(page, 'Standup').waitFor({ state: 'hidden' });
    await context.close();
  });

  it('the repeat and reminder choices are kept when the event is opened again', async () => {
    const { page, context } = await newUser('choices');
    await openCalendar(page);
    await firstCalendar(page, 'Work');
    await page.getByRole('link', { name: 'New event' }).click();
    await page.getByLabel('Title').fill('Dentist');
    await chip(page, 'Reminders', '1 day before').click();
    await chip(page, 'Reminders', 'At start').click();
    await chip(page, 'Repeats', 'Monthly').click();
    await page.getByRole('button', { name: 'Save' }).click();
    await view(page, 'Month').waitFor();
    await eventLink(page, 'Dentist').click();
    for (const [group, name, on] of [
      ['Reminders', '1 day before', 'true'],
      ['Reminders', 'At start', 'true'],
      ['Reminders', '1 hour before', 'false'],
      ['Repeats', 'Monthly', 'true'],
      ['Repeats', 'Never', 'false'],
    ] as const) {
      await expect.poll(() => chip(page, group, name).getAttribute('aria-pressed')).toBe(on);
    }
    await context.close();
  });

  it('a reminder of an event starting soon shows in the app, once, and opens the event', async () => {
    const { page, context } = await newUser('remind');
    await openCalendar(page);
    await firstCalendar(page, 'Work');
    const { day, time } = await soon(page, 30);
    await page.getByRole('link', { name: 'New event' }).click();
    await page.getByLabel('Title').fill('Board call');
    await page.getByLabel('Start date').fill(day);
    await page.getByRole('switch', { name: 'All day' }).uncheck();
    await page.getByLabel('Starts').fill(time);
    await chip(page, 'Reminders', '1 hour before').click();
    await page.getByRole('button', { name: 'Save' }).click();
    await view(page, 'Month').waitFor();

    // The check runs every 30 seconds while the app is open.
    const message = page.getByRole('status').filter({ hasText: 'Reminder: Board call' });
    await message.waitFor({ timeout: 45_000 });
    await message.getByRole('link', { name: 'Open' }).click();
    await page.waitForURL(/\/calendar\/e\//);
    await page.getByLabel('Title').waitFor();
    await context.close();
  }, 90_000);
});

describe('Update 2: default calendar, form, description, public calendars', () => {
  it('a new user already has "My calendar" and can add an event at once (FR-244)', async () => {
    const { page, context } = await newUser('default');
    await openCalendar(page);
    await view(page, 'Month').waitFor();
    await page
      .getByRole('group', { name: 'Calendars' })
      .getByRole('button', { name: 'My calendar' })
      .waitFor();
    await addEvent(page, 'First thing');
    await eventLink(page, 'First thing').waitFor();
    await context.close();
  });

  it('the form: compact All day switch, both dates kept, description, buttons on the right (FR-243 – FR-247)', async () => {
    const { page, context } = await newUser('form', { width: 390, height: 780 });
    await openCalendar(page);
    await page.getByRole('link', { name: 'New event' }).click();
    const sw = page.getByRole('switch', { name: 'All day' });
    const box = (await sw.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(32);

    await page.getByLabel('Title').fill('Conference');
    await page.getByLabel('Start date').fill('2026-12-01');
    await page.getByLabel('End date').fill('2026-12-03');
    await sw.uncheck();
    await page.getByLabel('Starts').fill('09:00');
    await page.getByLabel('Ends').fill('17:30');
    // Both dates are still there after switching All day off (and on again).
    expect(await page.getByLabel('Start date').inputValue()).toBe('2026-12-01');
    expect(await page.getByLabel('End date').inputValue()).toBe('2026-12-03');
    await sw.check();
    await sw.uncheck();
    expect(await page.getByLabel('End date').inputValue()).toBe('2026-12-03');
    expect(await page.getByLabel('Ends').inputValue()).toBe('17:30');

    await page.getByLabel('Description').fill('Hall B, bring the badge');

    // Cancel and Save are on the right side of the screen; Save is the last one.
    const save = (await page.getByRole('button', { name: 'Save' }).boundingBox())!;
    const cancel = (await page.getByRole('link', { name: 'Cancel' }).boundingBox())!;
    expect(save.x + save.width).toBeGreaterThan(390 - 24);
    expect(cancel.x).toBeGreaterThan(390 / 4);
    expect(save.x).toBeGreaterThan(cancel.x);

    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL(/\/calendar$/);
    await context.close();
  });

  it('saved description and end date come back when the event is opened again', async () => {
    const { page, context } = await newUser('desc');
    await openCalendar(page);
    const day = await today(page);
    await page.getByRole('link', { name: 'New event' }).click();
    await page.getByLabel('Title').fill('Workshop');
    await page.getByLabel('Start date').fill(day);
    await page.getByRole('switch', { name: 'All day' }).uncheck();
    await page.getByLabel('Starts').fill('10:00');
    await page.getByLabel('End date').fill(day);
    await page.getByLabel('Ends').fill('12:00');
    await page.getByLabel('Description').fill('Bring a laptop');
    await page.getByRole('button', { name: 'Save' }).click();
    await view(page, 'Month').waitFor();
    await eventLink(page, 'Workshop').click();
    expect(await page.getByLabel('Description').inputValue()).toBe('Bring a laptop');
    expect(await page.getByLabel('End date').inputValue()).toBe(day);
    expect(await page.getByLabel('Ends').inputValue()).toBe('12:00');
    await context.close();
  });

  it('a public calendar is visible, read-only, to another user (FR-241, FR-242)', async () => {
    const ann = await newUser('pub-ann');
    await openCalendar(ann.page);
    const day = await today(ann.page);
    await addEvent(ann.page, 'Open day', { day });
    await ann.page.getByRole('link', { name: 'Manage calendars' }).click();
    const sw = ann.page.getByRole('switch', { name: 'Public: My calendar' });
    await sw.click(); // the switch follows the stored value, so it turns on a moment later
    await expect.poll(() => sw.isChecked()).toBe(true);
    await waitSaved(ann.page);
    await syncNow(ann.page);

    const bob = await newUser('pub-bob');
    await openCalendar(bob.page);
    await bob.page.getByRole('link', { name: 'Public calendars' }).click();
    await bob.page.waitForURL(/\/calendar\/public/);
    await bob.page.getByText('Open day').waitFor();
    await bob.page.getByText(ann.email).first().waitFor();
    // Nothing to edit there.
    expect(await bob.page.getByRole('link', { name: 'New event' }).count()).toBe(0);
    await ann.context.close();
    await bob.context.close();
  });
});
