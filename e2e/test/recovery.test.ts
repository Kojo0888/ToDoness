/**
 * The server loses its database (a fresh instance on the same address) and the user signs up
 * again on a device that still holds the old data (docs/v1/PRD.md section 4.11).
 */
import type { Browser, Page } from 'playwright';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  addTask,
  badge,
  freePort,
  launch,
  logIn,
  newDevice,
  newPage,
  openTask,
  PASSWORD,
  signUp,
  startApp,
  task,
  titlesOnPage,
  uniqueEmail,
  waitSaved,
  type App,
} from './harness';

let browser: Browser;
let port: number;
let app: App | undefined;

beforeAll(async () => {
  browser = await launch();
  port = await freePort();
}, 60_000);

afterEach(async () => {
  await app?.stop();
  app = undefined;
});

afterAll(async () => {
  await browser?.close();
});

/** The popup; its name changes with the step (question, then overwrite or append). */
const dialog = (page: Page) => page.getByRole('dialog');

/** An old device with an Inbox task and a list with a task, all saved on the old server. */
async function oldDevice() {
  app = await startApp({}, { port });
  const email = uniqueEmail('ann');
  const context = await newDevice(browser, app);
  const page = await newPage(context);
  await signUp(page, email);
  await addTask(page, 'Buy milk');
  await page.getByPlaceholder('New list name').fill('Work');
  await page.getByRole('button', { name: 'Add list' }).click();
  await page.getByRole('heading', { level: 2, name: 'Work' }).waitFor();
  await addTask(page, 'Write report');
  await waitSaved(page);
  return { email, context, page };
}

/** Opens the Plan module and makes a plan with one activity (docs/plan). */
async function addPlanWithActivity(page: Page, plan: string, activity: string) {
  await page.getByRole('group', { name: 'Modules' }).getByRole('link', { name: 'Plan' }).click();
  await page.waitForURL(/\/plans?(\/|$)/);
  const name = page.getByLabel('New plan name');
  await name.fill(plan);
  await name.press('Enter');
  await page.getByRole('heading', { level: 2, name: plan }).waitFor();
  const input = page.getByLabel('Add an activity');
  await input.fill(activity);
  await input.press('Enter');
  await page.locator(`.plan-block[aria-label^="${activity}, "]`).waitFor();
}

/** Writes the notes of a task in its detail panel (saved when the field loses focus). */
async function writeTaskNote(page: Page, title: string, text: string) {
  await openTask(page, title);
  const field = page.getByRole('complementary', { name: 'Task details' }).getByLabel('Notes');
  await field.fill(text);
  await field.blur();
}

/** The server's database is lost: another server with an empty database takes its place. */
async function loseServer() {
  await app!.stop();
  app = await startApp({}, { port });
}

/** The app notices the login is gone and shows the login screen; then the user signs up. */
async function signUpAgain(page: Page, email: string) {
  await page.reload();
  await page.getByRole('button', { name: 'No account yet? Sign up' }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await dialog(page).waitFor();
}

describe('recovery after the server lost its database (FR-77 – FR-82)', () => {
  it('asks after sign-up, says the account is empty, and does not answer on Escape', async () => {
    const { email, page } = await oldDevice();
    await loseServer();
    await signUpAgain(page, email);

    await expect(dialog(page).textContent()).resolves.toContain('Your new account is empty');
    await expect(dialog(page).textContent()).resolves.toContain('2 tasks and 1 list');
    await expect(dialog(page).textContent()).resolves.toContain(email);
    await expect(dialog(page).textContent()).resolves.toContain(
      'Upload all data from this device to the server?',
    );
    await expect(dialog(page).textContent()).resolves.toContain('Attachments');
    await dialog(page).getByRole('button', { name: 'Upload my data' }).waitFor();
    await dialog(page).getByRole('button', { name: 'Keep it empty' }).waitFor();

    await page.keyboard.press('Escape');
    await dialog(page).waitFor(); // still there

    // The sync status says so, in its own colour (FR-172).
    await expect(badge(page).textContent()).resolves.toBe('Data comparison');
    await expect(badge(page).getAttribute('class')).resolves.toContain('sync-compare');
  });

  it('survives a reload: the question comes back', async () => {
    const { email, page } = await oldDevice();
    await loseServer();
    await signUpAgain(page, email);
    await page.reload();
    await dialog(page).waitFor();
  });

  it('Keep it empty: discards the offline data, the account stays empty, and it is not asked again', async () => {
    const { email, page } = await oldDevice();
    await loseServer();
    await signUpAgain(page, email);
    await dialog(page).getByRole('button', { name: 'Keep it empty' }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="sync-status"]')?.textContent?.includes('comparison'),
    );

    expect(await titlesOnPage(page)).toEqual([]);
    await page.reload();
    await page.getByRole('heading', { level: 2, name: 'Inbox' }).waitFor();
    await expect(dialog(page).isVisible()).resolves.toBe(false);
    await expect(page.getByRole('link', { name: 'Work' }).count()).resolves.toBe(0);
  });

  it('Upload my data on an empty account: uploads at once, also task notes and plans, and a second device gets it', async () => {
    const { email, page } = await oldDevice();
    await writeTaskNote(page, 'Write report', 'Two pages with a chart');
    await addPlanWithActivity(page, 'Launch', 'Design');
    await waitSaved(page);
    await loseServer();
    await signUpAgain(page, email);
    await expect(dialog(page).textContent()).resolves.toContain('1 plan');

    // Nothing to overwrite on an empty account: no "Overwrite or append?" step (FR-164).
    await dialog(page).getByRole('button', { name: 'Upload my data' }).click();
    await dialog(page).waitFor({ state: 'hidden' });

    // The device was last in the Plan module.
    await page.getByRole('heading', { level: 2, name: 'Launch' }).waitFor();
    await page.getByRole('group', { name: 'Modules' }).getByRole('link', { name: 'Tasks' }).click();
    await task(page, 'Buy milk').waitFor();
    await waitSaved(page);

    // A second device of the same account gets it from the server.
    const phone = await newPage(await newDevice(browser, app!));
    await logIn(phone, email);
    await task(phone, 'Buy milk').waitFor();
    await phone.getByRole('link', { name: 'Work' }).click();
    await openTask(phone, 'Write report');
    await expect(
      phone.getByRole('complementary', { name: 'Task details' }).getByLabel('Notes').inputValue(),
    ).resolves.toBe('Two pages with a chart');
    await phone.getByRole('group', { name: 'Modules' }).getByRole('link', { name: 'Plan' }).click();
    await phone.getByRole('heading', { level: 2, name: 'Launch' }).waitFor(); // the first plan opens
    await phone.locator('.plan-block[aria-label^="Design, "]').waitFor();
  });

  it('a failed login with the device e-mail offers Sign up again, which leads to the question', async () => {
    const { email, page } = await oldDevice();
    await loseServer();
    await page.reload();
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('alert').getByText('set up again').waitFor();
    await page.getByRole('button', { name: 'Sign up again' }).click();
    await dialog(page).waitFor();
    await expect(dialog(page).textContent()).resolves.toContain('Your new account is empty');
    await dialog(page).getByRole('button', { name: 'Upload my data' }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    await task(page, 'Buy milk').waitFor();
  });

  /**
   * The old device signs up again; meanwhile a phone logs in to the new account and adds a
   * task, so the account holds other data than the device. The popup asks which is newer.
   */
  async function differentDataOnServer() {
    const { email, page } = await oldDevice();
    await loseServer();
    await signUpAgain(page, email);
    const phone = await newPage(await newDevice(browser, app!));
    await logIn(phone, email);
    await addTask(phone, 'Phone task');
    await waitSaved(phone);
    await page.reload();
    await dialog(page).waitFor();
    // It first shows what is stored locally, then what the first sync brought.
    await page.getByText('Which data is newer?').waitFor();
    await expect(dialog(page).textContent()).resolves.toContain('The server already holds 1 task');
    await expect(dialog(page).getByRole('button', { name: 'Keep it empty' }).count()).resolves.toBe(
      0,
    );
    await page.keyboard.press('Escape');
    await dialog(page).waitFor(); // still there (FR-165)
    await expect(badge(page).textContent()).resolves.toBe('Data comparison');
    return { page, phone };
  }

  it('different data on the server, "Data on this device is newer": replaces it on the server (FR-169)', async () => {
    const { page, phone } = await differentDataOnServer();
    await dialog(page).getByRole('button', { name: 'Data on this device is newer' }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    await waitSaved(page);

    await task(page, 'Buy milk').waitFor();
    await task(page, 'Phone task').waitFor({ state: 'detached' });
    await phone.reload();
    await task(phone, 'Buy milk').waitFor();
    expect(await titlesOnPage(phone)).toEqual(['Buy milk']);
  });

  it('different data on the server, "Server data is newer": keeps the server data (FR-169)', async () => {
    const { page } = await differentDataOnServer();
    await dialog(page).getByRole('button', { name: 'Server data is newer' }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    await task(page, 'Phone task').waitFor();
    expect(await titlesOnPage(page)).toEqual(['Phone task']);
    await expect(page.getByRole('link', { name: 'Work' }).count()).resolves.toBe(0);
    await page.reload();
    await task(page, 'Phone task').waitFor();
    await expect(dialog(page).isVisible()).resolves.toBe(false);
  });
});
