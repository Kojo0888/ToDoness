import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addTask,
  badge,
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
});

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

describe('accounts', () => {
  it('needs a login; the first account becomes admin and later ones do not', async () => {
    const admin = await newPage(await newDevice(browser, app));
    await admin.goto('/');
    await admin.getByRole('heading', { name: 'Log in' }).waitFor();
    await signUp(admin, uniqueEmail('admin'));
    await admin.getByRole('link', { name: 'Admin' }).waitFor();

    const other = await newPage(await newDevice(browser, app));
    await signUp(other, uniqueEmail('plain'));
    expect(await other.getByRole('link', { name: 'Admin' }).count()).toBe(0);
  });

  it('shows clear errors for a wrong password and for a taken e-mail', async () => {
    const email = uniqueEmail();
    const first = await newPage(await newDevice(browser, app));
    await signUp(first, email);

    const page = await newPage(await newDevice(browser, app));
    await page.goto('/');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'wrong' }).waitFor();

    await page.getByRole('button', { name: 'No account yet? Sign up' }).click();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.getByRole('alert').filter({ hasText: 'already registered' }).waitFor();
  });

  it('stays logged in after a reload', async () => {
    const page = await newPage(await newDevice(browser, app));
    await signUp(page, uniqueEmail());
    await page.reload();
    await page.getByRole('heading', { level: 2, name: 'Inbox' }).waitFor();
  });
});

describe('tasks and lists', () => {
  it('adds, completes, edits, deletes with undo, and organises tasks in lists', async () => {
    const page = await newPage(await newDevice(browser, app));
    await signUp(page, uniqueEmail());

    // Newest on top
    await addTask(page, 'first');
    await addTask(page, 'second');
    expect(await page.locator('.todos .todo-title').allTextContents()).toEqual(['second', 'first']);

    // Complete
    await page.getByRole('checkbox', { name: 'Mark "first" as done' }).click();
    await task(page, 'first').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: /Completed \(1\)/ }).click();
    await task(page, 'first').waitFor();
    await page.getByRole('checkbox', { name: 'Mark "first" as not done' }).click();
    await task(page, 'first').waitFor();
    await page.locator('.todos .todo-title').nth(1).waitFor();
    expect(await page.locator('.todos .todo-title').allTextContents()).toEqual(['second', 'first']);

    // Edit in the detail panel
    await openTask(page, 'second');
    await page.getByLabel('Title').fill('second (edited)');
    await page.getByLabel('Title').press('Enter');
    await task(page, 'second (edited)').waitFor();
    await page.getByLabel('Notes').fill('some notes');
    await page.getByLabel('Due date').fill('2030-01-15');
    await page.getByLabel('Priority').selectOption('Medium');
    await page.getByRole('button', { name: 'Close' }).click();
    await page.locator('.priority.p2').waitFor();
    await page.locator('.due').waitFor();

    // Delete with undo
    await openTask(page, 'second (edited)');
    expect(await page.getByLabel('Notes').inputValue()).toBe('some notes');
    await page.getByRole('button', { name: 'Delete task' }).click();
    await task(page, 'second (edited)').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Undo' }).click();
    await task(page, 'second (edited)').waitFor();

    // Lists: create, add a task, move a task, rename, delete with confirmation
    await page.getByLabel('New list name').fill('Work');
    await page.getByRole('button', { name: 'Add list' }).click();
    await page.getByRole('heading', { level: 2, name: 'Work' }).waitFor();
    await addTask(page, 'work task');
    await page.getByRole('link', { name: 'Inbox' }).click();
    await openTask(page, 'first');
    await page.getByRole('complementary').getByLabel('List').selectOption({ label: 'Work' });
    await page.getByRole('link', { name: 'Work' }).click();
    await task(page, 'first').waitFor();

    // Reorder lists
    await page.getByLabel('New list name').fill('Home');
    await page.getByRole('button', { name: 'Add list' }).click();
    await page.getByRole('heading', { level: 2, name: 'Home' }).waitFor();
    expect(await page.locator('.nav-lists a').allTextContents()).toEqual(['Inbox', 'Work', 'Home']);
    await page.getByRole('link', { name: 'Manage lists' }).click();
    await page.getByRole('heading', { level: 2, name: 'Manage lists' }).waitFor();
    // Drag Home above Work with the mouse (one handle per list, no up/down buttons).
    expect(await page.getByRole('button', { name: /^Move list/ }).count()).toBe(0);
    const from = await page
      .getByRole('button', { name: 'Drag to reorder list: Home' })
      .boundingBox();
    const to = await page.getByRole('button', { name: 'Drag to reorder list: Work' }).boundingBox();
    await page.mouse.move(from!.x + 10, from!.y + 10);
    await page.mouse.down();
    await page.mouse.move(from!.x + 10, from!.y - 5, { steps: 5 });
    await page.mouse.move(to!.x + 10, to!.y + 2, { steps: 15 });
    await page.mouse.up();
    await expect
      .poll(() => page.locator('.nav-lists a').allTextContents())
      .toEqual(['Inbox', 'Home', 'Work']);
    await expect
      .poll(() => page.locator('.manage-name').allTextContents())
      .toEqual(['Home', 'Work']);

    // Rename and delete are in the "⋯" menu of the list.
    await page.getByRole('button', { name: 'Actions: Work' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('List name', { exact: true }).fill('Job');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.locator('.manage-name', { hasText: 'Job' }).waitFor();

    await page.getByRole('button', { name: 'Actions: Job' }).click();
    await page.getByRole('menuitem', { name: 'Delete list' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('2 open and completed tasks').waitFor();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.locator('.manage-name', { hasText: 'Job' }).waitFor({ state: 'detached' });
    expect(await page.getByRole('link', { name: 'Job' }).count()).toBe(0);
  });

  it('does not allow deleting or renaming the Inbox', async () => {
    const page = await newPage(await newDevice(browser, app));
    await signUp(page, uniqueEmail());
    await page.getByRole('link', { name: 'Manage lists' }).click();
    await page.getByRole('heading', { level: 2, name: 'Manage lists' }).waitFor();
    expect(await page.getByRole('button', { name: /^Actions/ }).count()).toBe(0);
    expect(await page.getByRole('button', { name: /^Drag to reorder list/ }).count()).toBe(0);
  });

  it('the ⋯ menu works with the keyboard and a click outside closes it', async () => {
    const page = await newPage(await newDevice(browser, app));
    await signUp(page, uniqueEmail());
    await page.getByLabel('New list name').fill('Work');
    await page.getByRole('button', { name: 'Add list' }).click();
    await page.getByRole('heading', { level: 2, name: 'Work' }).waitFor();
    await page.getByRole('link', { name: 'Manage lists' }).click();

    const button = page.getByRole('button', { name: 'Actions: Work' });
    await button.focus();
    await page.keyboard.press('Enter');
    const rename = page.getByRole('menuitem', { name: 'Rename' });
    await rename.waitFor();
    expect(await rename.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press('ArrowDown');
    expect(
      await page
        .getByRole('menuitem', { name: 'Delete list' })
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);

    await page.keyboard.press('Escape');
    await rename.waitFor({ state: 'detached' });
    expect(await button.evaluate((el) => el === document.activeElement)).toBe(true);

    await button.click();
    await rename.waitFor();
    await page.getByRole('heading', { level: 2, name: 'Manage lists' }).click(); // outside
    await rename.waitFor({ state: 'detached' });
  });
});

describe('PRD acceptance scenarios (section 11)', () => {
  it('1+2: offline create survives a reload; reconnecting sends it, also to a second device', async () => {
    const email = uniqueEmail();
    const context = await newDevice(browser, app);
    const page = await newPage(context);
    await signUp(page, email);
    await waitSaved(page);
    await waitForOfflineReady(page);

    await context.setOffline(true);
    await addTask(page, 'written offline');
    await badge(page).filter({ hasText: '1 change pending' }).waitFor();
    await page.reload();
    await task(page, 'written offline').waitFor();
    await badge(page)
      .filter({ hasText: /Offline.*1 change pending/ })
      .waitFor();

    await context.setOffline(false);
    await waitSaved(page);

    const phone = await newPage(await newDevice(browser, app));
    await logIn(phone, email);
    await task(phone, 'written offline').waitFor();
  });

  it('3: a connection that drops during sync creates no duplicate', async () => {
    const email = uniqueEmail();
    const page = await newPage(await newDevice(browser, app));
    await signUp(page, email);
    await waitSaved(page);

    let dropped = 0;
    await page.route('**/api/sync/push', async (route) => {
      if (dropped++ === 0) {
        await route.fetch(); // the server applies it...
        await route.abort('failed'); // ...but the browser never hears back
      } else {
        await route.continue();
      }
    });
    await addTask(page, 'only once');
    await waitSaved(page);
    expect(dropped).toBeGreaterThanOrEqual(2); // it did try again

    const phone = await newPage(await newDevice(browser, app));
    await logIn(phone, email);
    await task(phone, 'only once').waitFor();
    expect(await task(phone, 'only once').count()).toBe(1);
    expect(await task(page, 'only once').count()).toBe(1);
  });

  it('4: different fields edited on two devices offline are merged', async () => {
    const email = uniqueEmail();
    const ctx1 = await newDevice(browser, app);
    const laptop = await newPage(ctx1);
    await signUp(laptop, email);
    await addTask(laptop, 'Shared task');
    await waitSaved(laptop);

    const ctx2 = await newDevice(browser, app);
    const phone = await newPage(ctx2);
    await logIn(phone, email);
    await task(phone, 'Shared task').waitFor();

    await ctx1.setOffline(true);
    await ctx2.setOffline(true);

    await openTask(laptop, 'Shared task');
    await laptop.getByLabel('Title').fill('Shared task (laptop)');
    await laptop.getByLabel('Title').press('Enter');

    await openTask(phone, 'Shared task');
    await phone.getByLabel('Due date').fill('2030-01-15');
    await phone.getByLabel('Priority').selectOption('High');

    await ctx1.setOffline(false);
    await waitSaved(laptop);
    await ctx2.setOffline(false);
    await waitSaved(phone);
    await syncNow(laptop);
    await syncNow(phone);

    for (const page of [laptop, phone]) {
      await task(page, 'Shared task (laptop)').waitFor();
      await page.locator('.priority.p3').waitFor();
      await page.locator('.due').waitFor();
    }
  });

  it('5: delete on one device and edit on another: the task ends up deleted on both', async () => {
    const email = uniqueEmail();
    const ctx1 = await newDevice(browser, app);
    const laptop = await newPage(ctx1);
    await signUp(laptop, email);
    await addTask(laptop, 'Doomed');
    await waitSaved(laptop);
    const ctx2 = await newDevice(browser, app);
    const phone = await newPage(ctx2);
    await logIn(phone, email);
    await task(phone, 'Doomed').waitFor();

    await ctx1.setOffline(true);
    await ctx2.setOffline(true);
    await openTask(laptop, 'Doomed');
    await laptop.getByRole('button', { name: 'Delete task' }).click();
    await openTask(phone, 'Doomed');
    await phone.getByLabel('Title').fill('Doomed but edited');
    await phone.getByLabel('Title').press('Enter');

    await ctx1.setOffline(false);
    await waitSaved(laptop);
    await ctx2.setOffline(false);
    await waitSaved(phone);
    await syncNow(laptop);

    await task(laptop, 'Doomed').waitFor({ state: 'detached' });
    await task(phone, 'Doomed but edited').waitFor({ state: 'detached' });
  });

  it('6: after one online visit, the installed app opens with no connection and shows the tasks', async () => {
    const context = await newDevice(browser, app);
    const page = await newPage(context);
    await signUp(page, uniqueEmail());
    await addTask(page, 'still here');
    await waitSaved(page);
    await waitForOfflineReady(page);
    await page.close();

    await context.setOffline(true);
    const reopened = await newPage(context);
    await reopened.goto('/');
    await task(reopened, 'still here').waitFor();
    await badge(reopened).filter({ hasText: 'Offline' }).waitFor();
  });

  it('7: logging out with unsent changes warns first, and clears the data afterwards', async () => {
    const context = await newDevice(browser, app);
    const page = await newPage(context);
    await signUp(page, uniqueEmail());
    await waitSaved(page);
    await context.setOffline(true);
    await addTask(page, 'not sent yet');

    await page.getByRole('link', { name: 'Settings' }).click();
    const messages: string[] = [];
    page.once('dialog', (d) => {
      messages.push(d.message());
      void d.dismiss();
    });
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toMatch(/1 change/);
    await page.getByRole('button', { name: 'Log out' }).waitFor(); // still logged in

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.getByRole('heading', { name: 'Log in' }).waitFor();
    const left = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      return dbs.map((d) => d.name);
    });
    expect(left.length).toBeGreaterThan(0); // the database exists but is emptied
    await context.setOffline(false);
    await page.reload();
    await page.getByRole('heading', { name: 'Log in' }).waitFor();
  });

  it('8: an admin reset logs the user out; the next login sets a new password and keeps unsent changes', async () => {
    // A dedicated server, so this test controls who is the first (admin) account.
    const adminEmail = uniqueEmail('boss');
    const own = await startApp();
    try {
      const adminCtx = await newDevice(browser, own);
      const admin = await newPage(adminCtx);
      await signUp(admin, adminEmail);

      const userEmail = uniqueEmail('user');
      const userCtx = await newDevice(browser, own);
      const user = await newPage(userCtx);
      await signUp(user, userEmail);
      await addTask(user, 'before reset');
      await waitSaved(user);

      await admin.getByRole('link', { name: 'Admin' }).click();
      await admin.getByRole('button', { name: `Reset password: ${userEmail}` }).click();
      await admin.getByRole('dialog').getByRole('button', { name: 'Reset password' }).click();
      await admin.getByText(`Password of ${userEmail} was reset.`).waitFor();
      await admin.getByText('Password reset, waiting for next login').waitFor();

      // The user keeps working; the browser notices it is logged out.
      await addTask(user, 'written after reset');
      await user.getByRole('heading', { name: 'Log in' }).waitFor({ timeout: 20_000 });
      await user.getByText('no longer valid').waitFor();
      expect(await user.getByLabel('E-mail').inputValue()).toBe(userEmail);

      // A new password is typed at the next login and becomes the password.
      await user.getByLabel('Password').fill('my brand new password');
      await user.getByRole('button', { name: 'Log in', exact: true }).click();
      await task(user, 'written after reset').waitFor();
      await waitSaved(user);

      const other = await newPage(await newDevice(browser, own));
      await logIn(other, userEmail, 'my brand new password');
      await task(other, 'written after reset').waitFor();
      await task(other, 'before reset').waitFor();
    } finally {
      await own.stop();
    }
  });
});

describe('phone layout', () => {
  it('hides the sidebar behind a menu button and keeps the page free of sideways scrolling', async () => {
    const context = await newDevice(browser, app, { width: 375, height: 667 });
    const page = await newPage(context);
    await signUp(page, uniqueEmail());
    await addTask(page, 'on a phone');

    const menu = page.getByRole('button', { name: 'Menu' });
    await menu.waitFor();
    expect(await page.getByRole('link', { name: 'Settings' }).isVisible()).toBe(false);
    await menu.click();
    await page.getByRole('link', { name: 'Settings' }).waitFor({ state: 'visible' });
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('heading', { name: 'Settings' }).waitFor();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
