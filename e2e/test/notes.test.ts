/** The Notes module in the real app (docs/notes/PRD.md, section 7). */
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  badge,
  freePort,
  launch,
  logIn,
  newDevice,
  newPage,
  PASSWORD,
  signUp,
  startApp,
  syncNow,
  uniqueEmail,
  waitForOfflineReady,
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
const inbox = (page: Page) => page.getByRole('heading', { level: 2, name: 'Inbox' });
const noteBox = (page: Page, n: number) => page.getByRole('textbox', { name: `Note ${n}` });

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

describe('module switch (FR-83 – FR-87)', () => {
  it('is visible on a computer, switches modules, and the app reopens in the last one', async () => {
    const { page } = await newUser('switch');
    await expect(modules(page).isVisible()).resolves.toBe(true);
    await expect(
      modules(page).getByRole('link', { name: 'Tasks' }).getAttribute('aria-current'),
    ).resolves.toBe('page');

    await openNotes(page);
    expect(page.url()).toMatch(/\/notes$/);
    // The sidebar shows the notes navigation now.
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /My notes/ })
      .waitFor();
    // …and not the task lists.
    expect(
      await page
        .getByRole('navigation')
        .getByRole('link', { name: /^Inbox/ })
        .count(),
    ).toBe(0);

    // Reopening the app at the start address shows Notes.
    await page.goto('/');
    await myNotesHeading(page).waitFor();
    await page.reload();
    await myNotesHeading(page).waitFor();

    // Settings keep the Notes sidebar; Tasks bring back the Inbox and are remembered too.
    await page.getByRole('link', { name: 'Settings' }).click();
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /Public notes/ })
      .waitFor();
    await modules(page).getByRole('link', { name: 'Tasks' }).click();
    await inbox(page).waitFor();
    await page.goto('/');
    await inbox(page).waitFor();
  });

  it('without public notes on the device yet, the hint is a tooltip, not a line of text', async () => {
    const email = uniqueEmail('tooltip');
    const context = await newDevice(browser, app);
    // The server never answers for the public notes on this device.
    await context.route('**/api/public/notes*', (route) => route.abort());
    const page = await newPage(context);
    await signUp(page, email);
    await openNotes(page);
    const link = page.getByRole('navigation').getByRole('link', { name: /Public notes/ });
    await page.waitForFunction(() =>
      [...document.querySelectorAll('nav a')].some((a) =>
        a.getAttribute('title')?.includes('Public notes need a connection the first time.'),
      ),
    );
    expect(await link.getAttribute('title')).toBe('Public notes need a connection the first time.');
    expect(await page.getByText('Public notes need a connection the first time.').count()).toBe(0);
    await context.close();
  });

  it('is in the top bar on a phone, without opening the menu', async () => {
    const { page } = await newUser('phone', { width: 390, height: 800 });
    const sw = modules(page);
    await expect(sw.isVisible()).resolves.toBe(true);
    // It is the top bar's switch (the sidebar is closed).
    await expect(page.locator('.topbar .module-switch').isVisible()).resolves.toBe(true);
    await expect(page.getByRole('navigation').isVisible()).resolves.toBe(false);
    const box = (await sw.getByRole('link', { name: 'Notes' }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await sw.getByRole('link', { name: 'Notes' }).click();
    await myNotesHeading(page).waitFor();
  });
});

describe('my notes (FR-88 – FR-93)', () => {
  it('adds on top, saves after a pause, survives a reload; delete with Undo', async () => {
    const { page } = await newUser('writer');
    await openNotes(page);
    await page.getByText('No notes yet').waitFor();
    // An empty note cannot be added.
    await expect(page.getByRole('button', { name: 'Add note' }).isDisabled()).resolves.toBe(true);

    await addNote(page, 'Shopping: milk');
    await addNote(page, 'Second note');
    expect(await noteTexts(page)).toEqual(['Second note', 'Shopping: milk']);

    // Typing, then waiting (no leaving the box) saves.
    await noteBox(page, 2).fill('Shopping: milk, eggs');
    await page.waitForTimeout(1500);
    await waitSaved(page);
    await page.reload();
    await myNotesHeading(page).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.notes .note-text').length === 2);
    expect(await noteTexts(page)).toEqual(['Second note', 'Shopping: milk, eggs']);

    await page.getByRole('button', { name: 'Delete note 1' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.notes .note-text').length === 1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.notes .note-text').length === 2);
    expect(await noteTexts(page)).toEqual(['Second note', 'Shopping: milk, eggs']);
  });

  it('works offline and reaches a second device once the connection is back', async () => {
    const { email, context, page } = await newUser('offline');
    await openNotes(page);
    await addNote(page, 'Keep me');
    await waitSaved(page);
    await waitForOfflineReady(page);

    await context.setOffline(true);
    await addNote(page, 'Written offline');
    await noteBox(page, 2).fill('Keep me, edited offline');
    await noteBox(page, 2).blur();
    // Leaving the box saves; the create and the edit are queued.
    await badge(page).filter({ hasText: '2 changes pending' }).waitFor();
    await page.reload();
    await myNotesHeading(page).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.notes .note-text').length === 2);
    expect(await noteTexts(page)).toEqual(['Written offline', 'Keep me, edited offline']);

    await context.setOffline(false);
    await waitSaved(page);

    const phone = await newPage(await newDevice(browser, app));
    await logIn(phone, email);
    await openNotes(phone);
    await phone.waitForFunction(() => document.querySelectorAll('.notes .note-text').length === 2);
    expect(await noteTexts(phone)).toEqual(['Written offline', 'Keep me, edited offline']);
  });
});

describe('public notes (FR-94 – FR-97)', () => {
  it('another user edits a public note; the owner gets it; private hides it again', async () => {
    const ann = await newUser('ann');
    const bob = await newUser('bob');

    await openNotes(ann.page);
    await addNote(ann.page, 'Team lunch: Friday');
    await ann.page.getByRole('switch', { name: 'Public' }).click();
    await waitSaved(ann.page);

    await openNotes(bob.page);
    await bob.page
      .getByRole('navigation')
      .getByRole('link', { name: /Public notes/ })
      .click();
    const shared = bob.page.getByRole('textbox', { name: `Public note by ${ann.email}` });
    await shared.waitFor();
    await expect(shared.inputValue()).resolves.toBe('Team lunch: Friday');
    // Bob can change the text, but cannot delete it or make it private.
    expect(await bob.page.getByRole('button', { name: /Delete/ }).count()).toBe(0);
    expect(await bob.page.getByRole('switch').count()).toBe(0);
    await shared.fill('Team lunch: Friday 12:30');
    await shared.blur();

    // Ann's device gets Bob's edit through the normal sync.
    await ann.page.waitForFunction(
      async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        const box = document.querySelector('.notes .note-text') as HTMLTextAreaElement | null;
        return box?.value === 'Team lunch: Friday 12:30';
      },
      undefined,
      { polling: 500, timeout: 20_000 },
    );

    // Private again: gone for Bob at the next refresh.
    await ann.page.getByRole('switch', { name: 'Public' }).click();
    await waitSaved(ann.page);
    await bob.page.getByText('Nobody has made a note public yet.').waitFor({ timeout: 15_000 });
  });
});

describe('public lists and notes offline (FR-106 – FR-111)', () => {
  /** Ann owns a public list "Recipes" with "Soup" and a public note; Bob has opened both. */
  async function shared() {
    const ann = await newUser('annoff');
    const bob = await newUser('boboff');
    await ann.page.getByPlaceholder('New list name').fill('Recipes');
    await ann.page.getByRole('button', { name: 'Add list' }).click();
    await ann.page.getByRole('heading', { level: 2, name: 'Recipes' }).waitFor();
    const add = ann.page.getByLabel('Add a task');
    await add.fill('Soup');
    await add.press('Enter');
    await ann.page.getByRole('switch', { name: /Public list/ }).click();
    await openNotes(ann.page);
    await addNote(ann.page, 'Shared note');
    await ann.page.getByRole('switch', { name: 'Public' }).click();
    await waitSaved(ann.page);

    await syncNow(bob.page);
    // Earlier tests left public "Recipes" lists of other users: pick Ann's.
    await bob.page
      .getByRole('navigation')
      .getByRole('link', { name: new RegExp(`Recipes.*${ann.email}`) })
      .click();
    await bob.page.getByRole('link', { name: 'Soup' }).waitFor();
    await waitForOfflineReady(bob.page);
    return { ann, bob };
  }

  it('Bob reads and edits a public list offline; Ann gets it when he is back', async () => {
    const { ann, bob } = await shared();
    await bob.context.setOffline(true);
    await bob.page.reload();
    await bob.page.getByRole('link', { name: 'Soup' }).waitFor();
    await bob.page.getByText(/Offline copy from/).waitFor();

    const input = bob.page.getByLabel('Add a task');
    await input.fill('Bread offline');
    await input.press('Enter');
    await bob.page.getByRole('link', { name: 'Bread offline' }).waitFor();
    await bob.page.getByRole('checkbox', { name: 'Mark "Soup" as done' }).click();
    await bob.page.getByRole('button', { name: /Completed \(1\)/ }).waitFor();
    await bob.page.getByText('2 changes waiting to be sent.').waitFor();
    await badge(bob.page).filter({ hasText: '2 changes pending' }).waitFor();

    // Kept across a reload while still offline.
    await bob.page.reload();
    await bob.page.getByRole('link', { name: 'Bread offline' }).waitFor();

    await bob.context.setOffline(false);
    await waitSaved(bob.page);
    await modules(ann.page).getByRole('link', { name: 'Tasks' }).click();
    await ann.page
      .getByRole('navigation')
      .getByRole('link', { name: /^Recipes \d+$/ }) // the name and its open-task count
      .click();
    await syncNow(ann.page);
    await ann.page.getByRole('link', { name: 'Bread offline' }).waitFor({ timeout: 20_000 });
    await ann.page.getByRole('button', { name: /Completed \(1\)/ }).waitFor();
  });

  it('Bob edits a public note offline; Ann gets the text', async () => {
    const { ann, bob } = await shared();
    await openNotes(bob.page);
    await bob.page
      .getByRole('navigation')
      .getByRole('link', { name: /Public notes/ })
      .click();
    const box = bob.page.getByRole('textbox', { name: `Public note by ${ann.email}` });
    await box.waitFor();

    await bob.context.setOffline(true);
    await box.fill('Shared note, edited offline');
    await box.blur();
    await bob.page.getByText('1 change waiting to be sent.').waitFor();
    await bob.context.setOffline(false);
    await waitSaved(bob.page);

    await ann.page.waitForFunction(
      async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        const el = document.querySelector('.notes .note-text') as HTMLTextAreaElement | null;
        return el?.value === 'Shared note, edited offline';
      },
      undefined,
      { polling: 500, timeout: 20_000 },
    );
  });

  it('a change to a list made private meanwhile is refused, and Bob is told', async () => {
    const { ann, bob } = await shared();
    await bob.context.setOffline(true);
    await bob.page.getByRole('checkbox', { name: 'Mark "Soup" as done' }).click();
    await bob.page.getByText('1 change waiting to be sent.').waitFor();

    await modules(ann.page).getByRole('link', { name: 'Tasks' }).click();
    await ann.page
      .getByRole('navigation')
      .getByRole('link', { name: /^Recipes \d+$/ }) // the name and its open-task count
      .click();
    const toggle = ann.page.getByRole('switch', { name: /Public list/ });
    await toggle.click();
    // "All changes saved" may still be on screen from before the click: wait until the
    // change is stored and then sent (the outbox is empty again).
    await ann.page.waitForFunction(
      () => (document.querySelector('input[role="switch"]') as HTMLInputElement).checked === false,
    );
    await ann.page.waitForFunction(
      async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        const open = indexedDB.open('todoness');
        const db: IDBDatabase = await new Promise((ok) => (open.onsuccess = () => ok(open.result)));
        const n: number = await new Promise((ok) => {
          const q = db.transaction('outbox').objectStore('outbox').count();
          q.onsuccess = () => ok(q.result);
        });
        db.close();
        return n === 0;
      },
      undefined,
      { polling: 300, timeout: 20_000 },
    );

    await bob.context.setOffline(false);
    await waitSaved(bob.page);
    await bob.page.getByText('1 of your changes was not saved').waitFor({ timeout: 20_000 });
    await bob.page.getByText('not public any more').first().waitFor();
    await bob.page.getByRole('button', { name: 'Dismiss' }).click();
    await bob.page.getByText('1 of your changes was not saved').waitFor({ state: 'detached' });
    expect(await ann.page.getByRole('checkbox', { name: 'Mark "Soup" as done' }).isChecked()).toBe(
      false,
    );
  });
});

describe('recovery with notes (FR-98, FR-99)', () => {
  it('offers and restores the notes of the old account after the server lost its data', async () => {
    const port = await freePort();
    let old = await startApp({}, { port });
    try {
      const email = uniqueEmail('lost');
      const page = await newPage(await newDevice(browser, old));
      await signUp(page, email);
      await openNotes(page);
      await addNote(page, 'Do not lose me');
      await waitSaved(page);

      // The server's database is lost; the same address comes back empty.
      await old.stop();
      old = await startApp({}, { port });
      await page.reload();
      await page.getByRole('button', { name: 'No account yet? Sign up' }).click();
      await page.getByLabel('E-mail').fill(email);
      await page.getByLabel('Password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign up' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await expect(dialog.textContent()).resolves.toContain('and 1 note of');

      await dialog.getByRole('button', { name: 'Yes, push it' }).click();
      await dialog.getByRole('button', { name: 'Append' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await myNotesHeading(page).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.notes .note-text').length === 1);
      expect(await noteTexts(page)).toEqual(['Do not lose me']);
      await waitSaved(page);

      const phone = await newPage(await newDevice(browser, old));
      await logIn(phone, email);
      await openNotes(phone);
      await phone.waitForFunction(
        () => document.querySelectorAll('.notes .note-text').length === 1,
      );
    } finally {
      await old.stop();
    }
  });
});

describe('reorder notes (FR-100 – FR-102)', () => {
  it('with the keyboard on a phone, kept after a reload', async () => {
    const { page } = await newUser('kbnotes', { width: 390, height: 900 });
    await modules(page).getByRole('link', { name: 'Notes' }).click();
    await myNotesHeading(page).waitFor();
    for (const text of ['A', 'B', 'C']) await addNote(page, text);
    expect(await noteTexts(page)).toEqual(['C', 'B', 'A']);

    await page.getByRole('button', { name: 'Drag to reorder note 3' }).focus();
    for (const key of ['Space', 'ArrowUp', 'ArrowUp', 'Space']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
    }
    await page.waitForFunction(
      () => (document.querySelector('.notes .note-text') as HTMLTextAreaElement)?.value === 'A',
    );
    expect(await noteTexts(page)).toEqual(['A', 'C', 'B']);
    // The sync status is in the closed menu on a phone: it is there, just not visible.
    await badge(page)
      .filter({ hasText: 'All changes saved' })
      .waitFor({ state: 'attached', timeout: 20_000 });
    await page.reload();
    await myNotesHeading(page).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.notes .note-text').length === 3);
    expect(await noteTexts(page)).toEqual(['A', 'C', 'B']);
  });

  it('with the mouse', async () => {
    const { page } = await newUser('mousenotes');
    await openNotes(page);
    for (const text of ['A', 'B', 'C']) await addNote(page, text);
    const from = await page.getByRole('button', { name: 'Drag to reorder note 1' }).boundingBox();
    const to = await page.getByRole('button', { name: 'Drag to reorder note 3' }).boundingBox();
    await page.mouse.move(from!.x + 10, from!.y + 10);
    await page.mouse.down();
    await page.mouse.move(from!.x + 30, from!.y + 10, { steps: 5 });
    await page.mouse.move(to!.x + 20, to!.y + 10, { steps: 15 });
    await page.mouse.up();
    await page.waitForFunction(
      () => (document.querySelector('.notes .note-text') as HTMLTextAreaElement)?.value !== 'C',
    );
    expect(await noteTexts(page)).toEqual(['B', 'A', 'C']);
  });
});

describe('search notes (FR-103 – FR-105)', () => {
  it('filters by every word, ignoring case and accents; Escape clears', async () => {
    const { page } = await newUser('search');
    await openNotes(page);
    for (const text of ['Café menu', 'Team lunch', 'Lunch: café Friday']) await addNote(page, text);
    const search = page.getByRole('searchbox', { name: 'Search notes' });
    await search.fill('cafe LUNCH');
    await page.getByText('1 of 3 notes matches.').waitFor();
    expect(await noteTexts(page)).toEqual(['Lunch: café Friday']);
    // No reordering of a filtered view.
    await expect(
      page.getByRole('button', { name: 'Drag to reorder note 1' }).isDisabled(),
    ).resolves.toBe(true);

    await search.fill('nothing like this');
    await page.getByText('No notes match.').waitFor();
    await search.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('.notes .note-text').length === 3);

    // Adding a note clears the search, so the new note is visible.
    await search.fill('menu');
    await addNote(page, 'Brand new');
    await expect(search.inputValue()).resolves.toBe('');
  });
});
