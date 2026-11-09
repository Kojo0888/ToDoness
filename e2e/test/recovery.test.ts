/**
 * The server loses its database (a fresh instance on the same address) and the user signs up
 * again on a device that still holds the old data (docs/v1/PRD.md section 4.11).
 */
import type { Browser, Page } from 'playwright';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  addTask,
  freePort,
  launch,
  logIn,
  newDevice,
  newPage,
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
      'Would you like to push all offline data to the server?',
    );
    await expect(dialog(page).textContent()).resolves.toContain('Attachments');

    await page.keyboard.press('Escape');
    await dialog(page).waitFor(); // still there
  });

  it('survives a reload: the question comes back', async () => {
    const { email, page } = await oldDevice();
    await loseServer();
    await signUpAgain(page, email);
    await page.reload();
    await dialog(page).waitFor();
  });

  it('No: discards the offline data, the account stays empty, and it is not asked again', async () => {
    const { email, page } = await oldDevice();
    await loseServer();
    await signUpAgain(page, email);
    await dialog(page).getByRole('button', { name: 'No, discard it' }).click();
    await dialog(page).waitFor({ state: 'hidden' });

    expect(await titlesOnPage(page)).toEqual([]);
    await page.reload();
    await page.getByRole('heading', { level: 2, name: 'Inbox' }).waitFor();
    await expect(dialog(page).isVisible()).resolves.toBe(false);
    await expect(page.getByRole('link', { name: 'Work' }).count()).resolves.toBe(0);
  });

  it('Yes, Append: everything is back, also on a second device', async () => {
    const { email, page } = await oldDevice();
    await loseServer();
    await signUpAgain(page, email);

    await dialog(page).getByRole('button', { name: 'Yes, push it' }).click();
    await expect(dialog(page).textContent()).resolves.toContain('Overwrite or append?');
    await dialog(page).getByRole('button', { name: 'Back' }).click();
    await dialog(page).getByRole('button', { name: 'Yes, push it' }).click();
    await dialog(page).getByRole('button', { name: 'Append' }).click();
    await dialog(page).waitFor({ state: 'hidden' });

    await page.getByRole('heading', { level: 2, name: 'Inbox' }).waitFor();
    await task(page, 'Buy milk').waitFor();
    await page.getByRole('link', { name: 'Work' }).click();
    await task(page, 'Write report').waitFor();
    await waitSaved(page);

    // A second device of the same account gets it from the server.
    const phone = await newPage(await newDevice(browser, app!));
    await logIn(phone, email);
    await task(phone, 'Buy milk').waitFor();
    await phone.getByRole('link', { name: 'Work' }).click();
    await task(phone, 'Write report').waitFor();
  });

  it('Yes, Overwrite: replaces what the account already holds', async () => {
    const { email, page } = await oldDevice();
    await loseServer();
    await signUpAgain(page, email);

    // Meanwhile another device logs in to the new account and adds a task.
    const phone = await newPage(await newDevice(browser, app!));
    await logIn(phone, email);
    await addTask(phone, 'Phone task');
    await waitSaved(phone);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByRole('heading', { level: 2, name: 'Inbox' }).waitFor();

    await page.reload();
    await dialog(page).waitFor();
    // It first shows what is stored locally, then what the first sync brought.
    await page.getByText('already holds 1 task').waitFor();
    await dialog(page).getByRole('button', { name: 'Yes, push it' }).click();
    await dialog(page).getByRole('button', { name: 'Overwrite' }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    await waitSaved(page);

    await task(page, 'Buy milk').waitFor();
    await task(page, 'Phone task').waitFor({ state: 'detached' });
    await phone.reload();
    await task(phone, 'Buy milk').waitFor();
    expect(await titlesOnPage(phone)).toEqual(['Buy milk']);
  });
});
