/** Note lists, unified settings and the sidebar counts (docs/note-lists/PRD.md). */
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addTask,
  launch,
  newDevice,
  newPage,
  signUp,
  startApp,
  syncNow,
  task,
  uniqueEmail,
  waitSaved,
  type App,
} from './harness';

let app: App;
let browser: Browser;

beforeAll(async () => {
  app = await startApp();
  browser = await launch();
  await signUp(await newPage(await newDevice(browser, app)), uniqueEmail('admin'));
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

const nav = (page: Page) => page.getByRole('navigation');
const heading = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });

async function openNotes(page: Page) {
  await page.getByRole('group', { name: 'Modules' }).getByRole('link', { name: 'Notes' }).click();
  await heading(page, 'My notes').waitFor();
}

async function addNote(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'New note' });
  await box.fill(text);
  await box.press('Control+Enter');
  await page.waitForFunction(
    (t) =>
      [...document.querySelectorAll('.notes .note-text')].some(
        (e) => (e as HTMLTextAreaElement).value === t,
      ),
    text,
  );
}

const noteTexts = (page: Page) =>
  page
    .locator('.notes .note-text')
    .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));

/** The count badge of a sidebar link. */
const countOf = (page: Page, name: string) =>
  nav(page)
    .locator('.nav-lists a')
    .filter({ has: page.locator('.nav-name', { hasText: new RegExp(`^${name}$`) }) })
    .locator('.nav-count')
    .textContent();

describe('settings: one switch per notification channel (FR-119 – FR-123)', () => {
  it('shows the channels as rows with a switch and an info button, no hint paragraphs', async () => {
    const page = await newPage(await newDevice(browser, app));
    await signUp(page, uniqueEmail('settings'));
    await page.getByRole('link', { name: 'Settings' }).click();
    for (const name of ['Notifications on this device', 'Push notifications']) {
      await page.getByRole('switch', { name }).waitFor();
      await page.getByRole('button', { name: `About ${name}` }).waitFor();
    }
    expect(await page.locator('.page p.hint').count()).toBe(0);

    // The info text shows as a tooltip when the "i" is used.
    const info = page.getByRole('button', { name: 'About Notifications on this device' });
    await info.click();
    await page
      .getByRole('tooltip')
      .filter({ hasText: /only while the app is open/ })
      .waitFor();
    expect(
      await page
        .getByRole('tooltip')
        .filter({ hasText: /only while/ })
        .isVisible(),
    ).toBe(true);
  });

  it('notifications on this device can be switched off and on again (FR-120)', async () => {
    const page = await newPage(await newDevice(browser, app));
    await signUp(page, uniqueEmail('quiet'));
    await page.getByRole('link', { name: 'Settings' }).click();
    const sw = page.getByRole('switch', { name: 'Notifications on this device' });
    expect(await sw.isChecked()).toBe(true);
    await sw.click();
    await expect.poll(() => sw.isChecked()).toBe(false);
    await page.getByText('Off on this device.').first().waitFor();
    await page.reload();
    expect(
      await page.getByRole('switch', { name: 'Notifications on this device' }).isChecked(),
    ).toBe(false);
    await page.getByRole('switch', { name: 'Notifications on this device' }).click();
    await expect
      .poll(() => page.getByRole('switch', { name: 'Notifications on this device' }).isChecked())
      .toBe(true);
  });
});

describe('note lists (FR-124 – FR-131)', () => {
  it('creates a note list, keeps its notes apart and counts them', async () => {
    const page = await newPage(await newDevice(browser, app));
    await signUp(page, uniqueEmail('lists'));
    await openNotes(page);
    await addNote(page, 'Mine');

    await page.getByLabel('New list name').fill('Work');
    await page.getByRole('button', { name: 'Add list' }).click();
    await heading(page, 'Work').waitFor();
    await expect.poll(() => noteTexts(page)).toEqual([]);
    await addNote(page, 'Meeting');
    expect(await countOf(page, 'Work')).toBe('1');
    expect(await countOf(page, 'My notes')).toBe('1');

    await nav(page)
      .getByRole('link', { name: /My notes/ })
      .click();
    await heading(page, 'My notes').waitFor();
    await expect.poll(() => noteTexts(page)).toEqual(['Mine']);
  });

  it('manage note lists: rename My notes, Public notes is locked, delete a list', async () => {
    const context = await newDevice(browser, app);
    const page = await newPage(context);
    const email = uniqueEmail('manage');
    await signUp(page, email);
    await openNotes(page);
    await page.getByLabel('New list name').fill('Trash me');
    await page.getByRole('button', { name: 'Add list' }).click();
    await heading(page, 'Trash me').waitFor();
    await addNote(page, 'Gone soon');

    await nav(page).getByRole('link', { name: 'Manage lists' }).click();
    await heading(page, 'Manage note lists').waitFor();

    // My notes: rename only.
    await page.getByRole('button', { name: 'Actions: My notes' }).click();
    expect(await page.getByRole('menuitem', { name: 'Delete list' }).count()).toBe(0);
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('List name', { exact: true }).fill('Personal');
    await page.getByRole('button', { name: 'Save' }).click();
    await nav(page)
      .getByRole('link', { name: /Personal/ })
      .waitFor();

    // Public notes: no menu, no handle, a lock.
    const locked = page.locator('.manage-row.locked');
    await locked.getByText('Public notes', { exact: true }).waitFor();
    expect(await locked.getByRole('button').count()).toBe(0);
    await locked.getByRole('img', { name: 'Locked' }).waitFor();

    // Another list: delete with its notes.
    await page.getByRole('button', { name: 'Actions: Trash me' }).click();
    await page.getByRole('menuitem', { name: 'Delete list' }).click();
    await page.getByText('The note list "Trash me" and its 1 note will be deleted.').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect
      .poll(() =>
        nav(page)
          .getByRole('link', { name: /Trash me/ })
          .count(),
      )
      .toBe(0);

    // The round back button goes back to notes.
    const back = page.getByRole('link', { name: 'Back to notes' });
    expect(await back.getAttribute('class')).toMatch(/\bicon-btn\b/);
    await back.click();
    await heading(page, 'Personal').waitFor();

    // Another device of the user gets the renamed list.
    await waitSaved(page);
    const phone = await newPage(await newDevice(browser, app));
    await phone.goto('/');
    await phone.getByLabel('E-mail').fill(email);
    await phone.getByLabel('Password').fill('correct horse');
    await phone.getByRole('button', { name: 'Log in', exact: true }).click();
    await heading(phone, 'Inbox').waitFor();
    await openNotes(phone).catch(() => undefined);
    await syncNow(phone);
    await nav(phone)
      .getByRole('link', { name: /Personal/ })
      .waitFor({ timeout: 20_000 });
  });
});

describe('sidebar task counts (FR-132)', () => {
  it('shows the number of open tasks next to each list', async () => {
    const page = await newPage(await newDevice(browser, app));
    await signUp(page, uniqueEmail('counts'));
    await addTask(page, 'One');
    await addTask(page, 'Two');
    await expect.poll(() => countOf(page, 'Inbox')).toBe('2');
    await page.getByRole('checkbox', { name: 'Mark "One" as done' }).click();
    await expect.poll(() => countOf(page, 'Inbox')).toBe('1');
    void task;
  });
});
