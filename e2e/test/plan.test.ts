/** The Plan module in the real app (docs/plan/PRD.md, section 7). */
import type { Browser, Locator, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  launch,
  logIn,
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

/** Width of one day on the timeline (client/src/lib/timeline.ts). */
const DAY = 36;

const modules = (page: Page) => page.getByRole('group', { name: 'Modules' });
const heading = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });
const block = (page: Page, name: string) => page.locator(`.plan-block[aria-label^="${name}, "]`);
const arrows = (page: Page) => page.locator('.plan-arrow');
const chip = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Activity names' }).getByRole('button', { name, exact: true });

/** Today on the page's own calendar, and days counted from it. */
const today = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
const plus = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** [start, end] of a block. */
const days = async (page: Page, name: string) => [
  await block(page, name).getAttribute('data-start'),
  await block(page, name).getAttribute('data-end'),
];
const waitDays = (page: Page, name: string, start: string, end: string) =>
  page
    .locator(`.plan-block[aria-label^="${name}, "][data-start="${start}"][data-end="${end}"]`)
    .waitFor();

async function newUser(name: string, viewport?: { width: number; height: number }) {
  const email = uniqueEmail(name);
  const context = await newDevice(browser, app, viewport);
  const page = await newPage(context);
  await signUp(page, email);
  return { email, context, page };
}

async function openPlanModule(page: Page) {
  await modules(page).getByRole('link', { name: 'Plan' }).click();
  await page.waitForURL(/\/plans?(\/|$)/);
}

async function addPlan(page: Page, name: string) {
  const input = page.getByLabel('New plan name');
  await input.fill(name);
  await input.press('Enter');
  await heading(page, name).waitFor();
}

const endGrip = (page: Page, name: string) =>
  page.getByRole('button', { name: `Change the end of ${name}` });
const startGrip = (page: Page, name: string) => page.getByRole('button', { name: `Move ${name}` });
const arrow = (page: Page, from: string, to: string) =>
  page.getByRole('button', { name: `${from} → ${to}, remove link` });
const undo = (page: Page) => page.getByRole('button', { name: 'Undo last change' });

/** Drops the end of `from` on the block of `to`: `from → to` (FR-133). */
async function link(page: Page, from: string, to: string) {
  await drag(page, endGrip(page, from), { onto: block(page, to) });
  await arrow(page, from, to).waitFor({ state: 'attached' });
}

async function addActivity(page: Page, name: string) {
  const input = page.getByLabel('Add an activity');
  await input.fill(name);
  await input.press('Enter');
  await block(page, name).waitFor();
}

/** A user with one open plan. */
async function withPlan(name: string, plan = 'Launch') {
  const user = await newUser(name);
  await openPlanModule(user.page);
  await addPlan(user.page, plan);
  return { ...user, t0: await today(user.page) };
}

/** Presses on the middle of `from` and releases `dx` pixels to the right (or on `onto`). */
async function drag(page: Page, from: Locator, to: { dx: number } | { onto: Locator }) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const x = a.x + a.width / 2;
  const y = a.y + a.height / 2;
  let tx: number;
  let ty = y;
  if ('dx' in to) tx = x + to.dx;
  else {
    const b = (await to.onto.boundingBox())!;
    tx = b.x + b.width / 2;
    ty = b.y + b.height / 2;
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move((x + tx) / 2, (y + ty) / 2, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}

describe('the Plan module and plans (FR-119 – FR-122)', () => {
  it('is in the module switch; a plan is created from the sidebar; the app reopens in Plan', async () => {
    const { page } = await newUser('plans');
    const links = await modules(page).getByRole('link').allTextContents();
    expect(links).toEqual(['Tasks', 'Notes', 'Plan']);

    await openPlanModule(page);
    await page.getByText('No plans yet').waitFor();
    await addPlan(page, 'Launch');
    await addPlan(page, 'Move house');
    const nav = page.getByRole('list', { name: 'Plans' });
    expect(await nav.getByRole('link').allTextContents()).toEqual(['Launch', 'Move house']);
    await expect(
      nav.getByRole('link', { name: 'Move house' }).getAttribute('aria-current'),
    ).resolves.toBe('page');

    await page.goto('/');
    await heading(page, 'Launch').waitFor();
    await expect(
      modules(page).getByRole('link', { name: 'Plan' }).getAttribute('aria-current'),
    ).resolves.toBe('page');
  });

  it('Manage plans renames, reorders and deletes plans (FR-121)', async () => {
    const { page } = await withPlan('manage');
    await addActivity(page, 'Design');
    await addPlan(page, 'Second');
    const nav = page.getByRole('list', { name: 'Plans' });
    await page.getByRole('link', { name: 'Manage plans' }).click();
    await heading(page, 'Manage plans').waitFor();
    const rows = () => page.locator('.manage-row .manage-name').allTextContents();
    expect(await rows()).toEqual(['Launch', 'Second']);

    await page.getByRole('button', { name: 'Actions: Launch' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const name = page.getByLabel('Plan name', { exact: true });
    await name.fill('Launch 2');
    await name.press('Enter');
    await nav.getByRole('link', { name: 'Launch 2' }).waitFor();

    // Keyboard drag: Second above Launch 2.
    const handle = page.getByRole('button', { name: 'Drag to reorder plan: Second' });
    await handle.focus();
    for (const key of ['Space', 'ArrowUp', 'Space']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(150); // the drag library moves the row in steps
    }
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.manage-row .manage-name')]
          .map((e) => e.textContent)
          .join() === 'Second,Launch 2',
    );
    expect(await nav.getByRole('link').allTextContents()).toEqual(['Second', 'Launch 2']);

    await page.getByRole('button', { name: 'Actions: Launch 2' }).click();
    await page.getByRole('menuitem', { name: 'Delete plan' }).click();
    await page.getByRole('dialog').getByText('1 activity').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.manage-row').length === 1);
    expect(await nav.getByRole('link').allTextContents()).toEqual(['Second']);

    await page.getByRole('link', { name: 'Back to plans' }).click();
    await heading(page, 'Second').waitFor();
    // The plan page itself has no rename or delete buttons any more.
    expect(await page.getByRole('button', { name: 'Delete plan' }).count()).toBe(0);
  });

  it('the module switch is as wide as the other sidebar controls (it does not stretch the panel)', async () => {
    const { page } = await withPlan('width');
    const sizes = await page.evaluate(() => {
      const sw = document.querySelector('.sidebar .module-switch') as HTMLElement;
      const form = document.querySelector('.sidebar .new-list') as HTMLElement;
      const side = document.querySelector('.sidebar') as HTMLElement;
      return {
        fits: sw.scrollWidth <= sw.clientWidth,
        sw: [sw.getBoundingClientRect().left, sw.getBoundingClientRect().right],
        form: [form.getBoundingClientRect().left, form.getBoundingClientRect().right],
        sideScroll: side.scrollLeft,
        sideFits: side.scrollWidth <= side.clientWidth,
      };
    });
    expect(sizes.fits).toBe(true);
    expect(sizes.sideFits).toBe(true);
    expect(sizes.sideScroll).toBe(0);
    expect(sizes.sw).toEqual(sizes.form);
  });

  it('shows the switch with Plan on a phone', async () => {
    const { page } = await newUser('phone', { width: 390, height: 780 });
    const link = modules(page).getByRole('link', { name: 'Plan' });
    await expect(link.isVisible()).resolves.toBe(true);
    await link.click();
    await page.getByText('No plans yet').waitFor();
    const first = page.getByLabel('Name of your first plan');
    await first.fill('On the go');
    await first.press('Enter');
    await heading(page, 'On the go').waitFor();
    await addActivity(page, 'Pack');
    const box = (await block(page, 'Pack').boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(30);
    const handle = (await endGrip(page, 'Pack').boundingBox())!;
    expect(handle.height).toBeGreaterThanOrEqual(44);
  });
});

describe('activities on the timeline (FR-123 – FR-131)', () => {
  it('adds activities one after the other as blocks of 3 days', async () => {
    const { page, t0 } = await withPlan('add');
    await addActivity(page, 'Design');
    await addActivity(page, 'Build');
    expect(await days(page, 'Design')).toEqual([t0, plus(t0, 2)]);
    expect(await days(page, 'Build')).toEqual([plus(t0, 3), plus(t0, 5)]);
    const d = (await block(page, 'Design').boundingBox())!;
    const b = (await block(page, 'Build').boundingBox())!;
    expect(Math.round(d.width)).toBe(3 * DAY);
    expect(Math.round(b.x - d.x)).toBe(3 * DAY);
    expect(b.y).toBeGreaterThan(d.y);
  });

  it('dragging the end changes the duration; dragging the start or the block moves it', async () => {
    const { page, t0 } = await withPlan('drag');
    await addActivity(page, 'Design');

    await drag(page, endGrip(page, 'Design'), {
      dx: 2 * DAY,
    });
    await waitDays(page, 'Design', t0, plus(t0, 4));

    await drag(page, startGrip(page, 'Design'), { dx: 3 * DAY });
    await waitDays(page, 'Design', plus(t0, 3), plus(t0, 7));

    await drag(page, block(page, 'Design'), { dx: -1 * DAY });
    await waitDays(page, 'Design', plus(t0, 2), plus(t0, 6));

    // The end never goes before the start.
    await drag(page, endGrip(page, 'Design'), {
      dx: -9 * DAY,
    });
    await waitDays(page, 'Design', plus(t0, 2), plus(t0, 2));

    await waitSaved(page);
    await page.reload();
    await waitDays(page, 'Design', plus(t0, 2), plus(t0, 2));
  });

  it('Escape cancels a drag', async () => {
    const { page, t0 } = await withPlan('escape');
    await addActivity(page, 'Design');
    const b = (await block(page, 'Design').boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 4 * DAY, b.y + b.height / 2, { steps: 5 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await waitDays(page, 'Design', t0, plus(t0, 2));
  });

  it('the edit bar renames, sets dates and deletes with Undo; the keyboard moves a block', async () => {
    const { page, t0 } = await withPlan('bar');
    await addActivity(page, 'Design');
    await block(page, 'Design').click();
    const bar = page.getByRole('group', { name: 'Selected activity' });
    await bar.getByLabel('Activity name').fill('Sketch');
    await bar.getByLabel('Activity name').press('Enter');
    await block(page, 'Sketch').waitFor();

    await bar.getByLabel('Start', { exact: true }).fill(plus(t0, 5));
    await waitDays(page, 'Sketch', plus(t0, 5), plus(t0, 7));
    await bar.getByLabel('End').fill(plus(t0, 5));
    await waitDays(page, 'Sketch', plus(t0, 5), plus(t0, 5));

    await block(page, 'Sketch').focus();
    await page.keyboard.press('ArrowRight');
    await waitDays(page, 'Sketch', plus(t0, 6), plus(t0, 6));
    await page.keyboard.press('Shift+ArrowRight');
    await waitDays(page, 'Sketch', plus(t0, 6), plus(t0, 7));

    await bar.getByRole('button', { name: 'Delete activity' }).click();
    await block(page, 'Sketch').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await waitDays(page, 'Sketch', plus(t0, 6), plus(t0, 7));
  });
});

describe('dependencies (FR-133 – FR-138) and undo (FR-147)', () => {
  it('dropping an end on another block links them, draws an arrow and pushes', async () => {
    const { page, t0 } = await withPlan('link');
    await addActivity(page, 'Design'); // 0 – 2
    await addActivity(page, 'Build'); // 3 – 5
    await addActivity(page, 'Test'); // 6 – 8
    expect(await page.locator('.plan-link').count()).toBe(0); // no link circles
    // Put Build on top of Design in time, then link: it is pushed behind Design.
    await drag(page, block(page, 'Build'), { dx: -2 * DAY });
    await waitDays(page, 'Build', plus(t0, 1), plus(t0, 3));

    await link(page, 'Design', 'Build');
    expect(await arrows(page).count()).toBe(1);
    await waitDays(page, 'Build', plus(t0, 3), plus(t0, 5));
    // Linking did not change Design itself.
    expect(await days(page, 'Design')).toEqual([t0, plus(t0, 2)]);

    // The beginning of Test dropped on Build: Build → Test.
    await drag(page, startGrip(page, 'Test'), { onto: block(page, 'Build') });
    await arrow(page, 'Build', 'Test').waitFor({ state: 'attached' });
    expect(await days(page, 'Test')).toEqual([plus(t0, 6), plus(t0, 8)]);

    // Design gets 4 days longer: Build and Test move with it.
    await drag(page, endGrip(page, 'Design'), { dx: 4 * DAY });
    await waitDays(page, 'Design', t0, plus(t0, 6));
    await waitDays(page, 'Build', plus(t0, 7), plus(t0, 9));
    await waitDays(page, 'Test', plus(t0, 10), plus(t0, 12));

    // Build cannot be dragged before the end of Design.
    await drag(page, block(page, 'Build'), { dx: -5 * DAY });
    await waitDays(page, 'Build', plus(t0, 7), plus(t0, 9));
    expect(await days(page, 'Test')).toEqual([plus(t0, 10), plus(t0, 12)]);
  });

  it('an activity that follows directly is joined by one straight vertical line', async () => {
    const { page } = await withPlan('straight');
    await addActivity(page, 'Design');
    await addActivity(page, 'Build');
    await addActivity(page, 'Test');
    await link(page, 'Design', 'Build');
    const line = (from: string, to: string) =>
      arrow(page, from, to).locator('.plan-arrow-line').getAttribute('d');
    expect(await line('Design', 'Build')).toMatch(/^M [\d.]+ [\d.]+ V [\d.]+$/);

    // With a gap it runs along its own row, then straight down into the start of the block.
    await drag(page, block(page, 'Test'), { dx: 3 * DAY });
    await link(page, 'Design', 'Test');
    expect(await line('Design', 'Test')).toMatch(/^M [\d.]+ [\d.]+ H [\d.]+ V [\d.]+$/);
    const d = (await block(page, 'Design').boundingBox())!;
    const t = (await block(page, 'Test').boundingBox())!;
    const box = (await arrow(page, 'Design', 'Test').locator('.plan-arrow-line').boundingBox())!;
    expect(Math.abs(box.x - (d.x + d.width))).toBeLessThanOrEqual(2);
    expect(Math.abs(box.x + box.width - t.x)).toBeLessThanOrEqual(2);
    expect(box.y + box.height).toBeLessThanOrEqual(t.y + 2);
  });

  it('Undo last change reverts a drag with what it pushed, a link and a removed link', async () => {
    const { page, t0 } = await withPlan('undo');
    await addActivity(page, 'Design'); // 0 – 2
    await addActivity(page, 'Build'); // 3 – 5
    await expect(undo(page).isDisabled()).resolves.toBe(true);

    await link(page, 'Design', 'Build');
    await drag(page, endGrip(page, 'Design'), { dx: 3 * DAY });
    await waitDays(page, 'Build', plus(t0, 6), plus(t0, 8));
    await undo(page).click();
    await waitDays(page, 'Design', t0, plus(t0, 2));
    await waitDays(page, 'Build', plus(t0, 3), plus(t0, 5));
    await expect(undo(page).isDisabled()).resolves.toBe(true); // one step
    expect(await arrows(page).count()).toBe(1);

    // A removed link comes back (keyboard: focus the arrow, Enter; then Ctrl+Z).
    await arrow(page, 'Design', 'Build').focus();
    await page.keyboard.press('Enter');
    await arrows(page).first().waitFor({ state: 'detached' });
    await block(page, 'Design').focus();
    await page.keyboard.press('Control+z');
    await arrow(page, 'Design', 'Build').waitFor({ state: 'attached' });

    // A link made by mistake goes away again, and what it pushed goes back.
    await addActivity(page, 'Test'); // 6 – 8
    await drag(page, block(page, 'Test'), { dx: -4 * DAY });
    await waitDays(page, 'Test', plus(t0, 2), plus(t0, 4));
    await link(page, 'Build', 'Test');
    await waitDays(page, 'Test', plus(t0, 6), plus(t0, 8));
    await undo(page).click();
    await arrow(page, 'Build', 'Test').waitFor({ state: 'detached' });
    await waitDays(page, 'Test', plus(t0, 2), plus(t0, 4));
  });

  it('refuses a loop; the edit bar links without dragging', async () => {
    const { page, t0 } = await withPlan('loop');
    await addActivity(page, 'Design');
    await addActivity(page, 'Build');
    await addActivity(page, 'Test');
    await link(page, 'Design', 'Build');

    await drag(page, endGrip(page, 'Build'), { onto: block(page, 'Design') });
    await page.getByRole('alert').filter({ hasText: 'loop' }).waitFor();
    expect(await arrows(page).count()).toBe(1);
    expect(await days(page, 'Build')).toEqual([plus(t0, 3), plus(t0, 5)]);

    await block(page, 'Test').click();
    const after = page.getByRole('group', { name: 'Selected activity' }).getByLabel('Starts after');
    await after.selectOption({ label: 'Build' });
    await arrow(page, 'Build', 'Test').waitFor({ state: 'attached' });
    // Activities that would close a loop, or are linked already, are not offered.
    await block(page, 'Design').click();
    expect(await after.locator('option').allTextContents()).toEqual(['Add…']);
  });
});

describe('where the name is shown (FR-140, FR-141)', () => {
  it('on the block, after the block or in a column; the choice survives a reload', async () => {
    const { page } = await withPlan('names');
    await addActivity(page, 'Design');
    const timeline = page.locator('.plan-timeline');

    await expect(chip(page, 'On block').getAttribute('aria-pressed')).resolves.toBe('true');
    expect(await block(page, 'Design').locator('.plan-block-name').textContent()).toBe('Design');
    expect(await page.locator('.plan-after-name').count()).toBe(0);
    expect(await page.locator('.plan-name-col').count()).toBe(0);

    await chip(page, 'After block').click();
    await expect(timeline.getAttribute('data-names')).resolves.toBe('after');
    expect(await page.locator('.plan-after-name').textContent()).toBe('Design');
    expect(await block(page, 'Design').locator('.plan-block-name').count()).toBe(0);
    const b = (await block(page, 'Design').boundingBox())!;
    const label = (await page.locator('.plan-after-name').boundingBox())!;
    expect(label.x).toBeGreaterThanOrEqual(b.x + b.width);

    await chip(page, 'Column').click();
    const col = page.locator('.plan-name-col');
    await col.getByRole('button', { name: 'Design' }).waitFor();
    expect(await page.locator('.plan-after-name').count()).toBe(0);
    const c = (await col.boundingBox())!;
    expect((await block(page, 'Design').boundingBox())!.x).toBeGreaterThanOrEqual(c.x + c.width);

    await page.reload();
    await block(page, 'Design').waitFor();
    await expect(chip(page, 'Column').getAttribute('aria-pressed')).resolves.toBe('true');
    await page.locator('.plan-name-col').getByRole('button', { name: 'Design' }).waitFor();
  });
});

describe('offline and sync (FR-142)', () => {
  it('a plan made offline reaches a second device once the connection is back', async () => {
    const { email, context, page } = await newUser('sync');
    await waitSaved(page);
    await openPlanModule(page);
    await context.setOffline(true);
    await addPlan(page, 'Offline plan');
    await addActivity(page, 'Design');
    await addActivity(page, 'Build');
    await link(page, 'Design', 'Build');
    const design = await days(page, 'Design');

    await context.setOffline(false);
    await syncNow(page);
    await waitSaved(page);

    const phone = await newPage(await newDevice(browser, app));
    await logIn(phone, email);
    await openPlanModule(phone);
    await heading(phone, 'Offline plan').waitFor();
    await block(phone, 'Build').waitFor();
    expect(await days(phone, 'Design')).toEqual(design);
    expect(await arrows(phone).count()).toBe(1);

    // And a change travels back.
    await drag(phone, endGrip(phone, 'Design'), {
      dx: 2 * DAY,
    });
    await waitSaved(phone);
    await syncNow(page);
    await waitDays(page, 'Design', design[0]!, plus(design[1]!, 2));
    await waitDays(page, 'Build', plus(design[1]!, 3), plus(design[1]!, 5));
  });
});
