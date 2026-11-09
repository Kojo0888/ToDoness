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
  waitForOfflineReady,
  waitSaved,
  type App,
} from './harness';

let app: App;
let browser: Browser;

let admin: Awaited<ReturnType<typeof newUser>>;

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
    const { ann } = await getPair();
    const page = ann.page;
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password', { exact: true }).fill('brand new password');
    await page.getByLabel('Repeat the new password').fill('another new password');
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByRole('alert').filter({ hasText: 'not the same' }).waitFor();
  });
});

describe('v1: public lists (FR-32 – FR-36)', () => {
  it('another user can read and edit a public list, and it reaches the owner, until it is made private', async () => {
    const { ann, bob } = await getPair();

    await addList(ann.page, 'Recipes');
    await addTask(ann.page, 'Soup');
    await setPublic(ann.page, true);

    await syncNow(bob.page);
    const link = bob.page.getByRole('navigation').getByRole('link', { name: /Recipes/ });
    await link.waitFor();
    await link.click();
    await bob.page.getByRole('heading', { level: 2, name: 'Recipes' }).waitFor();
    await bob.page.getByRole('link', { name: 'Soup' }).waitFor();
    await bob.page.getByText('Everyone can edit').waitFor();

    // Bob adds a task and completes the existing one...
    const input = bob.page.getByLabel('Add a task');
    await input.fill('Bread from Bob');
    await input.press('Enter');
    await bob.page.getByRole('link', { name: 'Bread from Bob' }).waitFor();
    await bob.page.getByRole('checkbox', { name: 'Mark "Soup" as done' }).click();
    await bob.page.getByRole('button', { name: /Completed \(1\)/ }).waitFor();

    // ...renames the new one in its detail panel...
    await bob.page.getByRole('link', { name: 'Bread from Bob' }).click();
    const title = bob.page.getByRole('complementary', { name: 'Task details' }).getByLabel('Title');
    await title.fill('Bread, edited');
    await title.press('Enter');
    await bob.page.getByRole('link', { name: 'Bread, edited' }).first().waitFor();

    // ...and Ann sees all of it after her next sync.
    await syncNow(ann.page);
    await ann.page.getByRole('link', { name: 'Bread, edited' }).waitFor({ timeout: 20_000 });
    await ann.page.getByRole('button', { name: /Completed \(1\)/ }).waitFor();
    expect(await ann.page.getByRole('switch', { name: /Public list/ }).isChecked()).toBe(true);

    // Bob cannot rename or delete the list.
    expect(await bob.page.getByRole('button', { name: 'Delete list' }).count()).toBe(0);
    expect(await bob.page.getByRole('button', { name: 'Rename' }).count()).toBe(0);

    // Private again: Bob is told, and his edits are refused.
    await setPublic(ann.page, false);
    await syncNow(bob.page);
    await bob.page.getByText('not public any more').waitFor({ timeout: 20_000 });
    await bob.page
      .getByRole('navigation')
      .getByRole('link', { name: /Recipes/ })
      .waitFor({ state: 'detached' });
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

  it('a released task stays where it was dropped: it never jumps back to its old place', async () => {
    const { page } = await newUser('smooth');
    for (const title of ['A', 'B', 'C', 'D']) await addTask(page, title);
    expect(await titlesOnPage(page)).toEqual(['D', 'C', 'B', 'A']);
    const from = await page.getByRole('button', { name: 'Drag to reorder: A' }).boundingBox();
    const to = await page.getByRole('button', { name: 'Drag to reorder: D' }).boundingBox();
    await page.mouse.move(from!.x + 10, from!.y + 10);
    await page.mouse.down();
    await page.mouse.move(from!.x + 10, from!.y - 10, { steps: 5 });
    await page.mouse.move(to!.x + 10, to!.y + 5, { steps: 20 });
    await page.waitForTimeout(400); // the other rows have made room

    // From the release on, note where the row of A and the dragged copy are drawn in every frame.
    await page.evaluate(() => {
      const w = window as unknown as { tops: number[]; copy: number[] };
      w.tops = [];
      w.copy = [];
      const rowOf = () =>
        [...document.querySelectorAll('.todos .todo')].find(
          (r) => r.querySelector('.todo-title')?.textContent === 'A',
        );
      const start = performance.now();
      const frame = () => {
        const row = rowOf();
        if (row) w.tops.push(row.getBoundingClientRect().top);
        const copy = document.querySelector('.drag-overlay');
        if (copy) w.copy.push(copy.getBoundingClientRect().top);
        if (performance.now() - start < 1000) requestAnimationFrame(frame);
      };
      window.addEventListener('pointerup', () => requestAnimationFrame(frame), {
        once: true,
        capture: true,
      });
    });
    await page.mouse.up();
    await page.waitForTimeout(1200);

    expect(await titlesOnPage(page)).toEqual(['A', 'D', 'C', 'B']);
    const { tops, copy } = await page.evaluate(() => {
      const w = window as unknown as { tops: number[]; copy: number[] };
      return { tops: w.tops, copy: w.copy };
    });
    expect(tops.length).toBeGreaterThan(10);
    const final = tops[tops.length - 1]!;
    // Neither the row nor the dragged copy goes anywhere near its old place (three rows down).
    for (const top of [...tops, ...copy]) expect(Math.abs(top - final)).toBeLessThan(15);
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
    const { ann } = await getPair();
    const page = ann.page;
    await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
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
    const { ann } = await getPair();
    const page = ann.page;
    await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
    await addTask(page, 'Brand new');
    await openTask(page, 'Brand new');
    await page.getByTestId('attachment-input').setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('x'),
    });
    await page.getByRole('link', { name: 'note.txt' }).waitFor();
  });

  it('another user can download from a public list and add files too', async () => {
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
    // everyone may edit a public list, so Bob can add a file himself
    await bob.page.getByRole('link', { name: 'Manual', exact: true }).click();
    await bob.page.getByTestId('attachment-input').setInputFiles({
      name: 'extra.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('more'),
    });
    await bob.page.getByRole('link', { name: 'extra.txt' }).first().waitFor();
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

  /** The time control has an hour and a minute list; the minute list has steps of 5. */
  async function pickTime(page: Page, time: string) {
    const [h, m] = time.split(':') as [string, string];
    await page.getByRole('combobox', { name: 'Hour' }).selectOption(h);
    const minute = page.getByRole('combobox', { name: 'Minute' });
    // not every minute is a choice: use the exact one if offered, else the closest earlier step
    const offered = await minute
      .locator('option')
      .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
    await minute.selectOption(
      offered.includes(m) ? m : String(Math.floor(Number(m) / 5) * 5).padStart(2, '0'),
    );
  }

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
    await pickTime(page, time);
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
    await message.getByText(/Due in (3[5-9]|40) minutes/).waitFor();
    await page.waitForFunction(
      () => (window as unknown as { __shown: string[] }).__shown.length > 0,
    );
    expect((await shown(page))[0]).toMatch(/^Dentist\|Due in (3[5-9]|40) minutes/);

    // Once only: after a reload the same reminder does not come back.
    await page.reload();
    await task(page, 'Dentist').waitFor();
    await page.waitForTimeout(1500);
    expect(await page.getByRole('region', { name: 'Reminders' }).count()).toBe(0);
    expect(await shown(page)).toEqual([]); // (the recorder restarts with the page)

    // Changing the due time re-arms it.
    await openTask(page, 'Dentist');
    await setDue(page, 15); // a different time: re-armed
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

describe('v1: web push in the service worker (FR-62, FR-66)', () => {
  /**
   * Real push delivery needs the browser vendor's push service, which a test cannot reach.
   * Chromium lets us hand a push message straight to the worker, so the worker's own
   * code (parse, show, tag, click) is exercised for real.
   */
  async function deliverPush(
    page: Page,
    context: Awaited<ReturnType<typeof newDevice>>,
    data: unknown,
  ) {
    const cdp = await context.newCDPSession(page);
    const registrations: string[] = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
      for (const r of e.registrations) registrations.push(r.registrationId);
    });
    await cdp.send('ServiceWorker.enable');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null || true);
    await expect.poll(() => registrations.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: new URL(page.url()).origin,
      registrationId: registrations[0]!,
      data: typeof data === 'string' ? data : JSON.stringify(data),
    });
  }

  // The default headless shell always denies notifications; the full Chromium in headless
  // mode lets a test grant the permission.
  let pushBrowser: Browser;
  beforeAll(async () => {
    pushBrowser = await launch({ channel: 'chromium' });
  });
  afterAll(async () => {
    await pushBrowser?.close();
  });

  const shownNotifications = (page: Page) =>
    page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return (await reg.getNotifications()).map((n) => ({
        title: n.title,
        body: n.body,
        tag: n.tag,
        url: (n.data as { url?: string } | null)?.url,
      }));
    });

  it('a pushed reminder becomes a notification with the reminder tag and link', async () => {
    const context = await newDevice(pushBrowser, app, undefined, {
      permissions: ['notifications'],
    });
    const page = await newPage(context);
    await signUp(page, uniqueEmail('push'));
    await waitForOfflineReady(page);

    await deliverPush(page, context, {
      title: 'Dentist',
      body: 'Due in 1 hour',
      tag: 'task-1:123:hour',
      url: '/l/abc/t/def',
    });
    await expect
      .poll(() => shownNotifications(page), { timeout: 10_000 })
      .toEqual([
        { title: 'Dentist', body: 'Due in 1 hour', tag: 'task-1:123:hour', url: '/l/abc/t/def' },
      ]);

    // The same reminder pushed twice replaces the first notification (one tag, one notification).
    await deliverPush(page, context, {
      title: 'Dentist',
      body: 'Due in 59 minutes',
      tag: 'task-1:123:hour',
      url: '/l/abc/t/def',
    });
    await expect
      .poll(async () => (await shownNotifications(page)).map((n) => n.body), { timeout: 10_000 })
      .toEqual(['Due in 59 minutes']);
  });

  it('a broken push still shows a generic notification, never a silent one', async () => {
    const context = await newDevice(pushBrowser, app, undefined, {
      permissions: ['notifications'],
    });
    const page = await newPage(context);
    await signUp(page, uniqueEmail('pushbad'));
    await waitForOfflineReady(page);
    await deliverPush(page, context, 'this is not json');
    await expect
      .poll(async () => (await shownNotifications(page)).map((n) => n.title), { timeout: 10_000 })
      .toEqual(['ToDoness']);
  });

  it('Settings explains the push state of this device', async () => {
    const { bob } = await getPair();
    const page = bob.page;
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('heading', { name: 'Push notifications' }).waitFor();
    // headless Chromium has no push service, so it is never "on" here; it must say something clear
    await page
      .getByRole('status')
      .filter({ hasText: /Off on this device|Blocked in your browser|Not available/ })
      .first()
      .waitFor();
  });
});

describe('update 3: toggle, sticky Settings/Admin, sync diagnostics', () => {
  it('the public switch is a toggle with the explanation in a tooltip', async () => {
    const { ann } = await getPair();
    const page = ann.page;
    await addList(page, 'Toggle test');
    const toggle = page.getByRole('switch', { name: 'Public list' });
    await toggle.waitFor();
    // the long text is a tooltip (and a hidden description for screen readers), not on the page
    const label = page.locator('label.switch');
    expect(await label.getAttribute('title')).toMatch(/^Public list: every user .* read and edit/);
    expect((await label.innerText()).trim()).toBe('Public list'); // only the short name is on the page
    // it is drawn as a toggle, not a checkbox
    expect(await toggle.evaluate((el) => getComputedStyle(el).appearance)).toBe('none');
    expect(
      await toggle.evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    ).toBeGreaterThan(30);
    await setPublic(page, true);
    expect(await toggle.isChecked()).toBe(true);
  });

  it('Settings and Admin stay on the screen however long the task list is', async () => {
    const page = admin.page;
    await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
    for (let i = 1; i <= 25; i++) {
      await page.getByLabel('Add a task').fill(`Long list task ${i}`);
      await page.getByLabel('Add a task').press('Enter');
    }
    await task(page, 'Long list task 25').waitFor();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200); // the page really is long

    const viewport = page.viewportSize()!;
    for (const name of ['Settings', 'Admin']) {
      const box = await page.getByRole('navigation').getByRole('link', { name }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.y, name).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, name).toBeLessThanOrEqual(viewport.height);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    const top = await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Settings' })
      .boundingBox();
    expect(top!.y + top!.height).toBeLessThanOrEqual(viewport.height);
  });

  it('only the admin sees the sync diagnostics, folded away above the sync status', async () => {
    const { bob } = await getPair();
    const page = bob.page;
    await page.getByTestId('sync-status').waitFor();
    expect(await page.getByRole('button', { name: 'Sync diagnostics' }).count()).toBe(0);
    expect(await page.getByTestId('sync-diagnostics').count()).toBe(0);

    // Folded away at first: only the button that opens it.
    const toggle = admin.page.getByRole('button', { name: 'Sync diagnostics' });
    await toggle.waitFor();
    expect(await toggle.getAttribute('aria-expanded')).toBe('false');
    expect(await admin.page.getByTestId('sync-diagnostics').count()).toBe(0);
    await toggle.click();
    expect(await toggle.getAttribute('aria-expanded')).toBe('true');

    const flags = admin.page.getByTestId('sync-diagnostics');
    await flags.waitFor();
    for (const name of [
      'Browser says',
      'App found',
      'Last check',
      'Check took',
      'Sync',
      'Request',
      'Next try',
      'Online event → saved',
      'Outage (first failure → saved)',
    ]) {
      await flags.getByText(name, { exact: true }).waitFor();
    }
    // The time of the last check and how long it took are separate rows.
    await flags
      .locator('.flag', { hasText: 'Last check' })
      .getByText(/^\d+(\.\d)? (ms|s) ago$/)
      .waitFor();
    await flags
      .locator('.flag', { hasText: 'Check took' })
      .getByText(/^(answered|no answer) \d+(\.\d)? (ms|s)$/)
      .waitFor();
    const diag = await flags.boundingBox();
    const badge = await admin.page.getByTestId('sync-status').boundingBox();
    expect(diag!.y + diag!.height).toBeLessThanOrEqual(badge!.y + 1); // above

    // It stays open after a reload, and folds away again.
    await admin.page.reload();
    await admin.page.getByTestId('sync-diagnostics').waitFor();
    await admin.page.getByRole('button', { name: 'Sync diagnostics' }).click();
    await admin.page.getByTestId('sync-diagnostics').waitFor({ state: 'detached' });
    await admin.page.getByRole('button', { name: 'Sync diagnostics' }).click();
    await admin.page.getByTestId('sync-diagnostics').waitFor();
  });

  it('the admin sees the queued changes raw', async () => {
    const context = admin.context;
    const page = admin.page;
    await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
    await waitSaved(page);
    await page.getByTestId('sync-diagnostics').waitFor();

    await page.getByRole('button', { name: 'Queued changes' }).click();
    const queue = page.getByRole('region', { name: 'Queued changes (raw)' });
    await queue.waitFor();
    const raw = () => queue.locator('pre').textContent();
    expect(JSON.parse((await raw())!)).toEqual({ outbox: [], publicOutbox: [] });

    await context.setOffline(true);
    await page.getByTestId('sync-status').filter({ hasText: 'Offline' }).waitFor({ timeout: 5000 });
    await addTask(page, 'Queued while offline');
    await queue.getByText(/Queued while offline/).waitFor();
    const queued = JSON.parse((await raw())!) as {
      outbox: { entity: string; type: string; patch: { title: string }; attempts: number }[];
    };
    expect(queued.outbox).toHaveLength(1);
    expect(queued.outbox[0]).toMatchObject({
      entity: 'todo',
      type: 'create',
      patch: { title: 'Queued while offline' },
    });

    await context.setOffline(false);
    await waitSaved(page);
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Queued changes (raw)"] pre')?.textContent ===
        JSON.stringify({ outbox: [], publicOutbox: [] }, null, 2),
    );
    await page.getByRole('button', { name: 'Close queued changes' }).click();
    await queue.waitFor({ state: 'detached' });
  }, 60_000);

  it('offline → online: saved within 5 seconds, also when requests hang and nobody says the connection is back', async () => {
    const page = admin.page;
    await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
    await waitSaved(page);

    // A black hole: the browser thinks it is online, but no request is ever answered.
    await page.route('**/api/sync/**', () => new Promise(() => {}));
    await addTask(page, 'Written in the black hole');
    await page
      .getByTestId('sync-diagnostics')
      .getByText(/waiting/)
      .waitFor({ timeout: 8000 });
    await page.waitForTimeout(4500); // longer than the 3.5 s request time limit: it gives up and retries

    await page.unroute('**/api/sync/**'); // the connection works again, silently
    const t0 = Date.now();
    await waitSaved(page);
    const took = Date.now() - t0;
    expect(took).toBeLessThanOrEqual(5000);

    // the diagnostics explain it: how long the outage was
    await page
      .getByTestId('sync-diagnostics')
      .getByText('Outage (first failure → saved)')
      .waitFor();
    await page.getByRole('button', { name: 'Log' }).click();
    const log = page.getByRole('log');
    await log
      .getByText(/no answer \(timeout\)/)
      .first()
      .waitFor();
    await log
      .getByText(/all changes saved/)
      .first()
      .waitFor();
    await page.getByRole('button', { name: 'Close log' }).click();
  }, 60_000);

  it('offline → online with the browser’s online event: saved at once, and the flags show it', async () => {
    const context = admin.context;
    const page = admin.page;
    await waitSaved(page);
    await context.setOffline(true);
    await page.getByTestId('sync-status').filter({ hasText: 'Offline' }).waitFor({ timeout: 5000 }); // noticed at once
    await addTask(page, 'Written while offline');
    await page.getByTestId('sync-status').filter({ hasText: '1 change pending' }).waitFor();

    const t0 = Date.now();
    await context.setOffline(false);
    await waitSaved(page);
    expect(Date.now() - t0).toBeLessThanOrEqual(3000);
    const reconnect = page
      .getByTestId('sync-diagnostics')
      .locator('.flag', { hasText: 'Online event → saved' });
    await reconnect.getByText(/^\d+(\.\d)? (ms|s)$/).waitFor();
  }, 60_000);
});

describe('update 4: time control and phone file pickers', () => {
  it('the due time is chosen with hour and minute lists, quick choices, and can be cleared', async () => {
    const { ann } = await getPair();
    const page = ann.page;
    await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
    await addTask(page, 'Time control');
    await openTask(page, 'Time control');

    const group = page.getByRole('group', { name: 'Due time (optional)' });
    expect(await page.locator('input[type="time"]').count()).toBe(0); // the old control is gone
    expect(await group.getByRole('combobox', { name: 'Hour' }).isDisabled()).toBe(true); // needs a date first

    await page.getByLabel('Due date').fill('2031-06-10');
    // a quick choice
    await group.getByRole('button', { name: /Morning/ }).click();
    await expect.poll(() => group.getByRole('combobox', { name: 'Hour' }).inputValue()).toBe('09');
    expect(await group.getByRole('combobox', { name: 'Minute' }).inputValue()).toBe('00');
    expect(await group.getByRole('button', { name: /Morning/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await page
      .locator('.todos .todo', { hasText: 'Time control' })
      .getByText(/09:00|9:00/)
      .waitFor();

    // hour and minute lists
    await group.getByRole('combobox', { name: 'Hour' }).selectOption('17');
    await group.getByRole('combobox', { name: 'Minute' }).selectOption('45');
    await page
      .locator('.todos .todo', { hasText: 'Time control' })
      .getByText(/5:45|17:45/)
      .waitFor();
    // reload: the time is kept
    await page.reload();
    await task(page, 'Time control').waitFor();
    await openTask(page, 'Time control');
    await expect.poll(() => page.getByRole('combobox', { name: 'Hour' }).inputValue()).toBe('17');
    expect(await page.getByRole('combobox', { name: 'Minute' }).inputValue()).toBe('45');

    // clearing the time keeps the date
    await page.getByRole('button', { name: 'Clear time' }).click();
    await expect.poll(() => page.getByRole('combobox', { name: 'Hour' }).inputValue()).toBe('');
    expect(await page.getByLabel('Due date').inputValue()).toBe('2031-06-10');
    expect(await page.getByRole('combobox', { name: 'Minute' }).isDisabled()).toBe(true);
  });

  it('a phone gets separate pickers for photos/videos and documents, never "any file" or audio', async () => {
    const context = await newDevice(
      browser,
      app,
      { width: 390, height: 780 },
      { isMobile: true, hasTouch: true },
    );
    const page = await newPage(context);
    await signUp(page, uniqueEmail('phone'));
    await addTask(page, 'From my phone');
    await page.getByRole('link', { name: 'From my phone' }).click();
    await page.getByRole('complementary', { name: 'Task details' }).waitFor();

    await page.getByText('Add photos or videos').waitFor();
    await page.getByText('Add documents').waitFor();
    expect(await page.getByText('Add files').count()).toBe(0);
    expect(await page.getByTestId('attachment-input-media').getAttribute('accept')).toBe(
      'image/*,video/*',
    );
    const documents = await page.getByTestId('attachment-input-documents').getAttribute('accept');
    expect(documents).toBe('application/*,text/*');
    expect(documents).not.toMatch(/audio|\*\/\*/);

    // and it still uploads
    await page.getByTestId('attachment-input-documents').setInputFiles({
      name: 'from-phone.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hi'),
    });
    await page.getByRole('link', { name: 'from-phone.txt' }).waitFor();
  });

  it('a computer keeps one unrestricted picker', async () => {
    const { ann } = await getPair();
    const page = ann.page;
    await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
    await addTask(page, 'Desktop picker');
    await openTask(page, 'Desktop picker');
    expect(await page.getByTestId('attachment-input').getAttribute('accept')).toBeNull();
    await page.getByText('Add files').waitFor();
  });
});

describe('update 5: connection check, file pickers after a cancel, sticky Close log', () => {
  it('works when the browser wrongly says it is offline: syncs, shows Online, features stay on', async () => {
    const { bob } = await getPair();
    const page = bob.page;
    // The browser flag is stuck on "offline" and no `online` event ever comes.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', {
        get: () => false,
        configurable: true,
      });
    });
    await page.reload();
    await page.getByTestId('sync-status').waitFor();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false); // the lie is in place

    await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
    await addTask(page, 'Browser thinks I am offline');
    await waitSaved(page); // it synced although the browser says offline
    await page.getByTestId('sync-status').filter({ hasText: 'All changes saved' }).waitFor();
    expect(await page.getByTestId('sync-status').innerText()).not.toMatch(/Offline/);

    // features that need a connection are available (they used to follow the browser flag)
    await openTask(page, 'Browser thinks I am offline');
    await expect
      .poll(() => page.getByTestId('attachment-input').isDisabled(), { timeout: 8000 })
      .toBe(false);
  });

  it('the app notices a real loss of connection within about 5 seconds, without any browser event', async () => {
    const { bob } = await getPair();
    const page = bob.page;
    await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
    await waitSaved(page);
    await page.route('**/api/**', () => new Promise(() => {})); // every request hangs
    const t0 = Date.now();
    await page.getByTestId('sync-status').filter({ hasText: 'Offline' }).waitFor({ timeout: 8000 });
    expect(Date.now() - t0).toBeLessThanOrEqual(6000);
    await page.unroute('**/api/**');
    const t1 = Date.now();
    await page
      .getByTestId('sync-status')
      .filter({ hasText: 'All changes saved' })
      .waitFor({ timeout: 8000 });
    expect(Date.now() - t1).toBeLessThanOrEqual(5000);
  }, 40_000);

  it('the file picker opens again after it was cancelled, on a computer and on a phone', async () => {
    for (const phone of [false, true]) {
      const context = phone
        ? await newDevice(
            browser,
            app,
            { width: 390, height: 780 },
            { isMobile: true, hasTouch: true },
          )
        : await newDevice(browser, app);
      const page = await newPage(context);
      if (phone) await signUp(page, uniqueEmail('picker'));
      else {
        const { ann } = await getPair();
        await logIn(page, ann.email);
      }
      await addTask(page, `Picker ${phone ? 'phone' : 'computer'}`);
      await openTask(page, `Picker ${phone ? 'phone' : 'computer'}`);
      const label = page.getByText(phone ? 'Add documents' : 'Add files');

      for (let attempt = 1; attempt <= 3; attempt++) {
        // open the picker and leave it unanswered (cancelled): it must open again each time
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5000 }),
          label.click(),
        ]);
        expect(chooser, `attempt ${attempt}`).toBeTruthy();
        await page.waitForTimeout(150);
      }
      // and a real pick still works afterwards
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), label.click()]);
      await chooser.setFiles({
        name: 'after-cancel.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('ok'),
      });
      await page.getByRole('link', { name: 'after-cancel.txt' }).waitFor();
      await context.close();
    }
  }, 90_000);

  it('the Close log button stays visible while the log is scrolled', async () => {
    const page = admin.page;
    await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
    // many log lines: every "tab became visible" starts a sync
    for (let i = 0; i < 25; i++) {
      await syncNow(page);
      await page.waitForTimeout(40);
    }
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    const log = page.getByRole('log');
    await log.waitFor();
    await log.evaluate((el) => (el.scrollTop = el.scrollHeight)); // read the oldest lines
    expect(await log.evaluate((el) => el.scrollTop)).toBeGreaterThan(100); // it really scrolled

    const close = page.getByRole('button', { name: 'Close log' });
    const box = await close.boundingBox();
    const area = await log.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(area!.y - 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(area!.y + 80); // still at the top of the popup
    await close.click(); // and it can be clicked without scrolling up
    await log.waitFor({ state: 'detached' });
  });
});
