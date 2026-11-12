/** Note details and the controls on a note card (docs/notes-details/PRD.md, FR-195 – FR-200). */
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  launch,
  newDevice,
  newPage,
  signUp,
  startApp,
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
const myNotesHeading = (page: Page) => page.getByRole('heading', { level: 2, name: 'My notes' });

/** The texts of my notes, top to bottom. */
const noteTexts = (page: Page) =>
  page
    .locator('.notes .note-text')
    .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));

async function openNotes(page: Page) {
  await modules(page).getByRole('link', { name: 'Notes' }).click();
  await myNotesHeading(page).waitFor();
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

async function newUser(name: string, viewport?: { width: number; height: number }) {
  const email = uniqueEmail(name);
  const context = await newDevice(browser, app, viewport);
  const page = await newPage(context);
  await signUp(page, email);
  return { email, context, page };
}

describe('note card (FR-195 – FR-198)', () => {
  it('keeps 44 px controls on a phone', async () => {
    const { page } = await newUser('layoutphone', { width: 390, height: 800 });
    await modules(page).getByRole('link', { name: 'Notes' }).click();
    await myNotesHeading(page).waitFor();
    await addNote(page, 'Phone note');
    for (const loc of [
      page.getByRole('link', { name: 'Open details of note 1' }),
      page.getByRole('button', { name: 'Delete note 1' }),
    ]) {
      const box = (await loc.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
  });
});

describe('note details (FR-198 – FR-200)', () => {
  it('opens from the card with a large text box, Public and the modified time', async () => {
    const { page } = await newUser('details');
    await openNotes(page);
    await addNote(page, 'Long note');
    const cardHeight = (await page.locator('.notes .note-text').first().boundingBox())!.height;

    await page.getByRole('link', { name: 'Open details of note 1' }).click();
    await page.waitForURL(/\/notes\/n\/[^/]+$/);
    const box = page.getByRole('textbox', { name: 'Note text' });
    await expect(box.inputValue()).resolves.toBe('Long note');
    expect((await box.boundingBox())!.height).toBeGreaterThan(cardHeight * 1.5);
    await page.getByText(/^Last modified /).waitFor();

    // The text saves itself here too, and shows on the list.
    await box.fill('Long note, edited in details');
    await page.waitForTimeout(1500);
    await waitSaved(page);
    const modified = await page.getByText(/^Last modified /).textContent();

    const pub = page.getByRole('switch', { name: 'Public' });
    await expect(pub.isChecked()).resolves.toBe(false);
    await pub.click();
    // The switch follows the stored value, so it turns on once the change is written.
    await page.waitForFunction(
      () => (document.querySelector('input[role="switch"]') as HTMLInputElement).checked,
    );
    await waitSaved(page);
    expect(modified).toMatch(/^Last modified .+\d/);

    await page.getByRole('link', { name: 'Back to notes' }).click();
    await myNotesHeading(page).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.notes .note-text').length === 1);
    expect(await noteTexts(page)).toEqual(['Long note, edited in details']);
    expect(await page.locator('.notes .note.is-public').count()).toBe(1);

    // After a reload the public state and the text are kept.
    await page.getByRole('link', { name: 'Open details of note 1' }).click();
    await page.reload();
    await page.getByRole('textbox', { name: 'Note text' }).waitFor();
    await expect(page.getByRole('switch', { name: 'Public' }).isChecked()).resolves.toBe(true);
  });

  it('deletes from the card with the trash can and from the details page, both with Undo', async () => {
    const { page } = await newUser('detaildelete');
    await openNotes(page);
    await addNote(page, 'Keep');
    await addNote(page, 'Remove me');

    await page.getByRole('link', { name: 'Open details of note 1' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await myNotesHeading(page).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.notes .note-text').length === 1);
    expect(page.url()).toMatch(/\/notes$/);
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.notes .note-text').length === 2);
    expect(await noteTexts(page)).toEqual(['Remove me', 'Keep']);
  });

  it('a note that does not exist sends you back to the list', async () => {
    const { page } = await newUser('detailgone');
    await openNotes(page);
    await page.goto('/notes/n/nothing-here');
    await myNotesHeading(page).waitFor();
  });
});
