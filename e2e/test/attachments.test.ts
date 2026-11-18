/** Attachments on notes (details page) and events (docs/attachments/PRD.md). */
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch, newDevice, newPage, signUp, startApp, uniqueEmail, type App } from './harness';

let app: App;
let browser: Browser;

beforeAll(async () => {
  app = await startApp({ MAX_ATTACHMENT_MB: '1' });
  browser = await launch();
  await signUp(await newPage(await newDevice(browser, app)), uniqueEmail('admin'));
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

async function newUser(name: string) {
  const page = await newPage(await newDevice(browser, app));
  await signUp(page, uniqueEmail(name));
  return page;
}

async function attachAndRemove(page: Page) {
  await page.getByRole('region', { name: 'Attachments' }).waitFor();
  await page.getByTestId('attachment-input').setInputFiles({
    name: 'hello.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello attachment'),
  });
  const link = page.getByRole('link', { name: 'hello.txt' });
  await link.waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toBe('hello.txt');
  await page.getByRole('button', { name: 'Remove hello.txt' }).click();
  await page.getByText('No attachments.').waitFor();
}

describe('attachments of notes and events', () => {
  it('a note has them on its details page only', async () => {
    const page = await newUser('note-files');
    await page.getByRole('group', { name: 'Modules' }).getByRole('link', { name: 'Notes' }).click();
    await page.getByRole('heading', { level: 2, name: 'My notes' }).waitFor();
    const box = page.getByRole('textbox', { name: 'New note' });
    await box.fill('Receipt');
    await box.press('Control+Enter');
    await page.getByRole('link', { name: 'Open details of note 1' }).waitFor();
    expect(await page.getByRole('region', { name: 'Attachments' }).count()).toBe(0);

    await page
      .getByRole('link', { name: /details/i })
      .first()
      .click();
    await page.waitForURL(/\/notes\/n\//);
    await attachAndRemove(page);
  });

  it('an existing event has them, a new one does not', async () => {
    const page = await newUser('event-files');
    await page.getByRole('navigation').getByRole('link', { name: 'Calendar' }).first().click();
    await page.waitForURL(/\/calendar/);
    await page.goto(new URL('/calendar/new', page.url()).href);
    expect(await page.getByRole('region', { name: 'Attachments' }).count()).toBe(0);
    await page.getByLabel('Title').fill('Party');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL(/\/calendar(\?|$)/);
    await page
      .getByRole('link', { name: /^Party,/ })
      .first()
      .click();
    await page.waitForURL(/\/calendar\/e\//);
    await attachAndRemove(page);
  });
});
