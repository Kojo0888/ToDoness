import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addTask,
  launch,
  logIn,
  newDevice,
  newPage,
  openTask,
  PASSWORD,
  signUp,
  startApp,
  syncNow,
  task,
  titlesOnPage,
  uniqueEmail,
  type App,
} from './harness';

let app: App;
let browser: Browser;

let admin: { email: string; page: Page };

beforeAll(async () => {
  // A small attachment limit and a short "online" window keep the tests quick.
  app = await startApp({ MAX_ATTACHMENT_MB: '1', ONLINE_WINDOW_SECONDS: '10' });
  browser = await launch();
  // The first account created in a fresh app is the admin.
  admin = await newUser('admin');
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

const newUser = async (name: string) => {
  const email = uniqueEmail(name);
  const context = await newDevice(browser, app);
  const page = await newPage(context);
  await signUp(page, email);
  return { email, context, page };
};

/** The switch is saved to the local database first, so wait until it shows the new state. */
async function setPublic(page: Page, on: boolean) {
  const toggle = page.getByRole('switch', { name: /Public list/ });
  if ((await toggle.isChecked()) !== on) await toggle.click();
  await page.waitForFunction(
    (expected) =>
      (document.querySelector('input[role="switch"]') as HTMLInputElement | null)?.checked ===
      expected,
    on,
  );
}

/** Sign-up is rate limited (20 per hour per address), so two users are shared by several tests. */
let pair:
  | Promise<{ ann: Awaited<ReturnType<typeof newUser>>; bob: Awaited<ReturnType<typeof newUser>> }>
  | undefined;
const getPair = () =>
  (pair ??= Promise.all([newUser('ann'), newUser('bob')]).then(([ann, bob]) => ({ ann, bob })));

async function addList(page: Page, name: string) {
  await page.getByPlaceholder('New list name').fill(name);
  await page.getByRole('button', { name: 'Add list' }).click();
  await page.getByRole('heading', { level: 2, name }).waitFor();
}

describe('v1: change password (FR-29 – FR-31)', () => {
  it('needs the current password, keeps this device logged in, logs the others out', async () => {
    const { email, page } = await newUser('pw');
    const phone = await newPage(await newDevice(browser, app));
    await logIn(phone, email);

    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Current password').fill('wrong password!');
    await page.getByLabel('New password', { exact: true }).fill('brand new password');
    await page.getByLabel('Repeat the new password').fill('brand new password');
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByRole('alert').filter({ hasText: 'current password is wrong' }).waitFor();

    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByRole('status').filter({ hasText: 'Password changed' }).waitFor();
    await page.getByRole('heading', { level: 2, name: 'Settings' }).waitFor(); // still logged in

    // The phone's login is gone: it notices at its next sync and asks to log in again.
    await syncNow(phone);
    await phone.getByRole('heading', { name: 'Log in' }).waitFor();

    // The old password no longer works, the new one does.
    await phone.getByLabel('E-mail').fill(email);
    await phone.getByLabel('Password').fill(PASSWORD);
    await phone.getByRole('button', { name: 'Log in', exact: true }).click();
    await phone.getByRole('alert').filter({ hasText: 'wrong' }).waitFor();
    await phone.getByLabel('Password').fill('brand new password');
    await phone.getByRole('button', { name: 'Log in', exact: true }).click();
    await phone.getByRole('heading', { level: 2, name: 'Inbox' }).waitFor();
  });

  it('refuses two different new passwords', async () => {
    const { page } = await newUser('pw2');
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password', { exact: true }).fill('brand new password');
    await page.getByLabel('Repeat the new password').fill('another new password');
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByRole('alert').filter({ hasText: 'not the same' }).waitFor();
  });
});

describe('v1: public lists (FR-32 – FR-36)', () => {
  it('another user can read a public list, but not change it, until it is made private', async () => {
    const { ann, bob } = await getPair();

    await addList(ann.page, 'Recipes');
    await addTask(ann.page, 'Soup');
    await setPublic(ann.page, true);

    await syncNow(bob.page);
    const link = bob.page.getByRole('navigation').getByRole('link', { name: /Recipes/ });
    await link.waitFor();
    await link.click();
    await bob.page.getByRole('heading', { level: 2, name: 'Recipes' }).waitFor();
    await bob.page.getByText('Soup').waitFor();
    await bob.page.getByText('Read-only').waitFor();
    expect(await bob.page.getByLabel('Add a task').count()).toBe(0);
    expect(await bob.page.getByRole('link', { name: 'Soup' }).count()).toBe(0);

    await setPublic(ann.page, false);
    await syncNow(bob.page);
    await bob.page.getByText('not public any more').waitFor({ timeout: 20_000 });
    await bob.page
      .getByRole('navigation')
      .getByRole('link', { name: /Recipes/ })
      .waitFor({
        state: 'detached',
      });
  });

  it('a list is private by default', async () => {
    const { ann, bob } = await getPair();
    await addList(ann.page, 'Secret');
    await ann.page.getByRole('switch', { name: /Public list/ }).waitFor();
    expect(await ann.page.getByRole('switch', { name: /Public list/ }).isChecked()).toBe(false);
    await syncNow(bob.page);
    await bob.page.waitForTimeout(500);
    expect(await bob.page.getByRole('link', { name: /Secret/ }).count()).toBe(0);
  });
});

describe('v1: drag and drop (FR-37 – FR-41)', () => {
  it('reorders with the keyboard and keeps the order after a reload', async () => {
    const { page } = await newUser('kb');
    for (const title of ['A', 'B', 'C']) await addTask(page, title);
    expect(await titlesOnPage(page)).toEqual(['C', 'B', 'A']);

    const handle = page.getByRole('button', { name: 'Drag to reorder: A' });
    await handle.focus();
    // dnd-kit starts listening for the arrow keys a moment after the pick-up.
    for (const key of ['Space', 'ArrowUp', 'ArrowUp', 'Space']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
    }
    await page.waitForFunction(
      () => document.querySelector('.todos .todo .todo-title')?.textContent === 'A',
    );
    expect(await titlesOnPage(page)).toEqual(['A', 'C', 'B']);

    await page.reload();
    await task(page, 'A').waitFor();
    expect(await titlesOnPage(page)).toEqual(['A', 'C', 'B']);
  });

  it('reorders with the mouse', async () => {
    const { page } = await newUser('mouse');
    for (const title of ['A', 'B', 'C']) await addTask(page, title);
    const from = await page.getByRole('button', { name: 'Drag to reorder: C' }).boundingBox();
    const to = await page.getByRole('button', { name: 'Drag to reorder: A' }).boundingBox();
    await page.mouse.move(from!.x + 10, from!.y + 10);
    await page.mouse.down();
    await page.mouse.move(from!.x + 10, from!.y + 30, { steps: 5 });
    await page.mouse.move(to!.x + 10, to!.y + 20, { steps: 15 });
    await page.mouse.up();
    await page.waitForFunction(
      () => document.querySelector('.todos .todo .todo-title')?.textContent !== 'C',
    );
    expect(await titlesOnPage(page)).toEqual(['B', 'A', 'C']);
  });

  it('dropping a task on a list in the sidebar moves it there', async () => {
    const { page } = await newUser('move');
    await addList(page, 'Work');
    await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
    await addTask(page, 'Report');
    await addTask(page, 'Stay');

    const handle = await page
      .getByRole('button', { name: 'Drag to reorder: Report' })
      .boundingBox();
    const target = await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Work' })
      .boundingBox();
    await page.mouse.move(handle!.x + 10, handle!.y + 10);
    await page.mouse.down();
    await page.mouse.move(handle!.x + 30, handle!.y + 10, { steps: 5 });
    await page.mouse.move(target!.x + 20, target!.y + 10, { steps: 20 });
    await page.mouse.up();

    await page.getByText('Moved to Work.').waitFor();
    expect(await titlesOnPage(page)).toEqual(['Stay']);
    await page.getByRole('navigation').getByRole('link', { name: 'Work' }).click();
    await task(page, 'Report').waitFor();
  });
});

describe('v1: attachments (FR-48 – FR-55)', () => {
  it('uploads, lists, downloads and removes a file', async () => {
    const { page } = await newUser('files');
    await addTask(page, 'With file');
    await openTask(page, 'With file');

    await page.getByTestId('attachment-input').setInputFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello attachment'),
    });
    const link = page.getByRole('link', { name: 'hello.txt' });
    await link.waitFor();
    await page.getByText('16 B').waitFor();

    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toBe('hello.txt');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello attachment');

    await page.getByRole('button', { name: 'Remove hello.txt' }).click();
    await page.getByText('No attachments.').waitFor();
  });

  it('refuses a file above the configured limit before uploading it', async () => {
    const { page } = await newUser('big');
    await addTask(page, 'Big file');
    await openTask(page, 'Big file');
    await page.getByText('Up to 1.0 MB per file.').waitFor();

    let uploads = 0;
    await page.route('**/attachments?name=*', (route) => {
      uploads++;
      return route.continue();
    });
    await page.getByTestId('attachment-input').setInputFiles({
      name: 'huge.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(1024 * 1024 + 1),
    });
    await page.getByRole('alert').filter({ hasText: 'larger than the limit' }).waitFor();
    expect(uploads).toBe(0);
    expect(await page.getByRole('link', { name: 'huge.bin' }).count()).toBe(0);
  });

  it('a task created offline is sent first, then the file goes up', async () => {
    const { page } = await newUser('late');
    await page.waitForTimeout(500);
    await addTask(page, 'Brand new');
    await openTask(page, 'Brand new');
    await page.getByTestId('attachment-input').setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('x'),
    });
    await page.getByRole('link', { name: 'note.txt' }).waitFor();
  });

  it('another user can download from a public list but cannot add files', async () => {
    const { ann, bob } = await getPair();
    await addList(ann.page, 'Docs');
    await addTask(ann.page, 'Manual');
    await openTask(ann.page, 'Manual');
    await ann.page.getByTestId('attachment-input').setInputFiles({
      name: 'manual.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('rtfm'),
    });
    await ann.page.getByRole('link', { name: 'manual.txt' }).waitFor();
    await ann.page.getByRole('button', { name: 'Close' }).click();
    await setPublic(ann.page, true);

    await syncNow(bob.page);
    await bob.page.getByRole('navigation').getByRole('link', { name: /Docs/ }).click();
    const link = bob.page.getByRole('link', { name: 'manual.txt' });
    await link.waitFor();
    const [download] = await Promise.all([bob.page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toBe('manual.txt');
    expect(await bob.page.getByRole('button', { name: 'Add files' }).count()).toBe(0);
  });
});

describe('v1: who is online (FR-56 – FR-58)', () => {
  it('the admin sees a user come online and go offline again', async () => {
    const user = await newUser('watched');
    await admin.page.getByRole('link', { name: 'Admin' }).click();
    const row = admin.page.getByRole('row', { name: new RegExp(user.email) });
    await row.getByText('Online', { exact: true }).waitFor();
    expect(await admin.page.getByRole('columnheader', { name: 'Online' }).count()).toBe(1);

    await user.context.close(); // the app is gone: no more requests
    await row.getByText('Offline', { exact: true }).waitFor({ timeout: 30_000 });
  }, 60_000);
});

describe('v1: reminders (FR-42 – FR-47)', () => {
  /**
   * Headless Chromium always reports `denied`, even when the permission is granted, so
   * the tests that need "granted" pretend it; and records every system notification.
   */
  const recordNotifications = async (page: Page) => {
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
      const w = window as unknown as { __shown: string[] };
      w.__shown = [];
      const original = ServiceWorkerRegistration.prototype.showNotification;
      ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
        w.__shown.push(`${title}|${options?.body ?? ''}`);
        return original.call(this, title, options);
      };
    });
  };
  const shown = (page: Page) =>
    page.evaluate(() => (window as unknown as { __shown: string[] }).__shown);

  /** Local `YYYY-MM-DD` and `HH:MM` for a moment `minutes` from now. */
  const inMinutes = (minutes: number) => {
    const d = new Date(Date.now() + minutes * 60_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
      time: `${p(d.getHours())}:${p(d.getMinutes())}`,
    };
  };

  async function setDue(page: Page, minutes: number) {
    const { date, time } = inMinutes(minutes);
    await page.getByLabel('Due date').fill(date);
    await page.getByLabel('Due time').fill(time);
  }

  it('shows a notification and an in-app message once the reminder time has come', async () => {
    const email = uniqueEmail('rem');
    const page = await newPage(await newDevice(browser, app));
    await recordNotifications(page);
    await signUp(page, email);
    await addTask(page, 'Dentist');
    await openTask(page, 'Dentist');

    expect(await page.getByLabel('Remind me').isDisabled()).toBe(true); // needs a due date first
    await setDue(page, 40); // due in 40 minutes: a 1-hour reminder is already due
    await page.getByLabel('Remind me').selectOption('hour');

    const message = page.getByRole('region', { name: 'Reminders' });
    await message.getByText('Reminder: Dentist').waitFor();
    await message.getByText(/Due in (39|40) minutes/).waitFor();
    await page.waitForFunction(
      () => (window as unknown as { __shown: string[] }).__shown.length > 0,
    );
    expect((await shown(page))[0]).toMatch(/^Dentist\|Due in (39|40) minutes/);

    // Once only: after a reload the same reminder does not come back.
    await page.reload();
    await task(page, 'Dentist').waitFor();
    await page.waitForTimeout(1500);
    expect(await page.getByRole('region', { name: 'Reminders' }).count()).toBe(0);
    expect(await shown(page)).toEqual([]); // (the recorder restarts with the page)

    // Changing the due time re-arms it.
    await openTask(page, 'Dentist');
    await setDue(page, 35);
    await page.getByRole('region', { name: 'Reminders' }).getByText('Reminder: Dentist').waitFor();
  });

  it('a reminder that is not due yet stays quiet, and completing the task cancels it', async () => {
    const page = await newPage(await newDevice(browser, app));
    await recordNotifications(page);
    await signUp(page, uniqueEmail('quiet'));
    await addTask(page, 'Far away');
    await openTask(page, 'Far away');
    await setDue(page, 3 * 24 * 60); // in 3 days
    await page.getByLabel('Remind me').selectOption('hour');
    await page.waitForTimeout(1500);
    expect(await page.getByRole('region', { name: 'Reminders' }).count()).toBe(0);

    await addTask(page, 'Done already');
    await openTask(page, 'Done already');
    await setDue(page, 30);
    await page.getByLabel('Remind me').selectOption('hour');
    await page
      .getByRole('region', { name: 'Reminders' })
      .getByText('Reminder: Done already')
      .waitFor();
  });

  it('removing the due date also removes the reminder', async () => {
    const page = await newPage(await newDevice(browser, app));
    await recordNotifications(page);
    await signUp(page, uniqueEmail('clear'));
    await addTask(page, 'Later');
    await openTask(page, 'Later');
    await setDue(page, 5 * 24 * 60);
    await page.getByLabel('Remind me').selectOption('day');
    await page.getByLabel('Due date').fill('');
    await page.waitForFunction(
      () =>
        (document.querySelector('select[aria-describedby="remind-hint"]') as HTMLSelectElement)
          .disabled,
    );
    expect(await page.getByLabel('Remind me').inputValue()).toBe('');
  });

  it('reminders still appear inside the app without notification permission', async () => {
    const page = await newPage(await newDevice(browser, app));
    await signUp(page, uniqueEmail('noperm'));
    await addTask(page, 'No permission');
    await openTask(page, 'No permission');
    await setDue(page, 20);
    await page.getByLabel('Remind me').selectOption('hour');
    await page
      .getByRole('region', { name: 'Reminders' })
      .getByText('Reminder: No permission')
      .waitFor();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    expect(await page.getByRole('region', { name: 'Reminders' }).count()).toBe(0);
  });

  it('Settings shows whether notifications are enabled', async () => {
    const page = await newPage(await newDevice(browser, app));
    await recordNotifications(page);
    await signUp(page, uniqueEmail('settings'));
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByText('Enabled.').waitFor();
  });
});
