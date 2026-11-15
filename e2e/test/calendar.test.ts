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

async function firstCalendar(page: Page, name: string) {
  await page.getByLabel('Name of your first calendar').fill(name);
  await page.getByRole('button', { name: 'Create calendar' }).click();
  await view(page, 'Month').waitFor();
}

async function addEvent(
  page: Page,
  title: string,
  opts: { day?: string; start?: string; end?: string } = {},
) {
  await page.getByRole('link', { name: 'New event' }).click();
  await page.getByLabel('Title').fill(title);
  if (opts.day) await page.getByLabel('Date').fill(opts.day);
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
  it('starts empty, creates the first calendar, adds an event and shows it in the month', async () => {
    const { page, context } = await newUser('month');
    await openCalendar(page);
    await page.getByText('No calendars yet.').waitFor();
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
    await page.getByText('Work', { exact: true }).waitFor();
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
