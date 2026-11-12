/** Activity groups in the real app (docs/plan/PRD.md section 11.3). */
import type { Browser, Locator, Page } from 'playwright';
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

/** Width of one day on the timeline (client/src/lib/timeline.ts). */
const DAY = 36;

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });
const block = (page: Page, name: string) => page.locator(`.plan-block[aria-label^="${name}, "]`);
/** The header of an expanded group's box. */
const groupHead = (page: Page, name: string) =>
  page.locator(`.plan-group-head[aria-label^="${name}, "]`);
const groupBox = (page: Page, name: string) =>
  page.locator('.plan-group-box').filter({ has: groupHead(page, name) });
const expandButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Expand ${name}`, exact: true }).first();
const collapseButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Collapse ${name}`, exact: true }).first();
const undo = (page: Page) => page.getByRole('button', { name: 'Undo last change' });
const endGrip = (page: Page, name: string) =>
  page.getByRole('button', { name: `Change the end of ${name}` });
const detailsLink = (page: Page, name: string) =>
  page.getByRole('link', { name: `Details of ${name}` });
const optionsButton = (page: Page) => page.getByRole('button', { name: 'Timeline options' });

const today = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
const plus = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const waitDays = (page: Page, name: string, start: string, end: string) =>
  page
    .locator(`.plan-block[aria-label^="${name}, "][data-start="${start}"][data-end="${end}"]`)
    .waitFor();
const waitGroupDays = (page: Page, name: string, start: string, end: string) =>
  page
    .locator(`.plan-group-head[aria-label^="${name}, "][data-start="${start}"][data-end="${end}"]`)
    .waitFor();

/** Names of the rows (details buttons) in order. */
const rowNames = (page: Page) =>
  page
    .locator('.plan-details-btn')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace('Details of ', '')));

async function withPlan(name: string) {
  const context = await newDevice(browser, app);
  const page = await newPage(context);
  await signUp(page, uniqueEmail(name));
  await page.getByRole('group', { name: 'Modules' }).getByRole('link', { name: 'Plan' }).click();
  await page.waitForURL(/\/plans?(\/|$)/);
  const input = page.getByLabel('New plan name');
  await input.fill('Launch');
  await input.press('Enter');
  await heading(page, 'Launch').waitFor();
  return { page, t0: await today(page) };
}

async function addActivity(page: Page, name: string) {
  const input = page.getByLabel('Add an activity');
  await input.fill(name);
  await input.press('Enter');
  await block(page, name).waitFor();
}

/** Presses on the middle of `from` and releases on `onto` (or at a point). */
async function drag(
  page: Page,
  from: Locator,
  to: { onto: Locator } | { x: number; y: number } | { dx: number },
) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const x = a.x + a.width / 2;
  const y = a.y + a.height / 2;
  let tx: number;
  let ty: number;
  if ('onto' in to) {
    const b = (await to.onto.boundingBox())!;
    tx = b.x + b.width / 2;
    ty = b.y + b.height / 2;
  } else if ('dx' in to) {
    tx = x + to.dx;
    ty = y;
  } else {
    tx = to.x;
    ty = to.y;
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move((x + tx) / 2, (y + ty) / 2, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}

describe('activity groups', () => {
  it('drags make, fill and leave a group; Undo takes a grouping back; moving the group moves its activities (11.3: 1, 2)', async () => {
    const { page, t0 } = await withPlan('groups-drag');
    await addActivity(page, 'Pages'); // t0 .. t0+2
    await addActivity(page, 'Forms'); // t0+3 .. t0+5
    await addActivity(page, 'Tests'); // t0+6 .. t0+8

    // The middle of Forms onto Pages (another row): a new group with both.
    await drag(page, block(page, 'Forms'), { onto: block(page, 'Pages') });
    await groupHead(page, 'Pages & Forms').waitFor();
    expect(await rowNames(page)).toEqual(['Pages & Forms', 'Pages', 'Forms', 'Tests']);
    // The group covers its children (FR-175).
    await waitGroupDays(page, 'Pages & Forms', t0, plus(t0, 5));
    const box = (await groupBox(page, 'Pages & Forms').boundingBox())!;
    for (const name of ['Pages', 'Forms']) {
      const b = (await block(page, name).boundingBox())!;
      expect(b.x).toBeGreaterThan(box.x);
      expect(b.x + b.width).toBeLessThan(box.x + box.width);
      expect(b.y).toBeGreaterThan(box.y);
      expect(b.y + b.height).toBeLessThan(box.y + box.height);
    }

    // Undo last change takes the grouping back, with the group it made (FR-187).
    await undo(page).click();
    await groupHead(page, 'Pages & Forms').waitFor({ state: 'detached' });
    expect(await rowNames(page)).toEqual(['Pages', 'Forms', 'Tests']);
    await drag(page, block(page, 'Forms'), { onto: block(page, 'Pages') });
    await groupHead(page, 'Pages & Forms').waitFor();

    // Tests onto the group's box: it joins as the last child.
    await drag(page, block(page, 'Tests'), { onto: groupHead(page, 'Pages & Forms') });
    await page.waitForFunction(
      () => document.querySelectorAll('.plan-group-box .plan-bar').length === 3,
    );
    await waitGroupDays(page, 'Pages & Forms', t0, plus(t0, 8));

    // Moving the group moves everything in it (FR-182).
    await drag(page, groupHead(page, 'Pages & Forms'), { dx: 2 * DAY });
    await waitGroupDays(page, 'Pages & Forms', plus(t0, 2), plus(t0, 10));
    await waitDays(page, 'Pages', plus(t0, 2), plus(t0, 4));
    await waitDays(page, 'Tests', plus(t0, 8), plus(t0, 10));

    // Dropped on an empty part of another row, outside the box: out of the group.
    const rows = (await page.locator('.plan-rows').boundingBox())!;
    const tests = (await block(page, 'Tests').boundingBox())!;
    await drag(page, block(page, 'Tests'), {
      x: tests.x + tests.width / 2,
      y: rows.y + rows.height - 10,
    });
    await page.waitForFunction(
      () => document.querySelectorAll('.plan-group-box .plan-bar').length === 2,
    );
    expect(await rowNames(page)).toEqual(['Pages & Forms', 'Pages', 'Forms', 'Tests']);
    await waitGroupDays(page, 'Pages & Forms', plus(t0, 2), plus(t0, 7));
  });

  it('collapses to one { } block, survives a reload, a double click marks it done, hiding done hides it, the name column is a tree (11.3: 3, 5, 7)', async () => {
    const { page } = await withPlan('groups-collapse');
    await addActivity(page, 'Pages');
    await addActivity(page, 'Forms');
    await addActivity(page, 'Tests');
    await drag(page, block(page, 'Forms'), { onto: block(page, 'Pages') });
    await groupHead(page, 'Pages & Forms').waitFor();

    await collapseButton(page, 'Pages & Forms').click();
    const g = block(page, 'Pages & Forms');
    await g.waitFor();
    expect(await rowNames(page)).toEqual(['Pages & Forms', 'Tests']);
    expect(await block(page, 'Pages').count()).toBe(0);
    const bar = page.locator('.plan-bar.is-group');
    expect((await bar.locator('.plan-brace').allTextContents()).join('')).toBe('{}');
    expect(await bar.locator('.plan-group-count').textContent()).toBe('2');

    await waitSaved(page);
    await page.reload();
    await block(page, 'Pages & Forms').waitFor();
    expect(await block(page, 'Pages').count()).toBe(0);

    // A double click marks all its activities done (FR-184).
    await block(page, 'Pages & Forms').dblclick();
    await page.locator('.plan-bar.is-group.is-done').waitFor();
    await expandButton(page, 'Pages & Forms').click();
    await page.locator('.plan-bar.is-done .plan-block[aria-label^="Forms, "]').waitFor();
    expect(await page.locator('.plan-group-box .plan-bar.is-done').count()).toBe(2);

    // Hide done: the whole group goes (FR-162, FR-184).
    await optionsButton(page).click();
    await page.getByRole('switch', { name: 'Hide done activities' }).click();
    await groupHead(page, 'Pages & Forms').waitFor({ state: 'detached' });
    expect(await rowNames(page)).toEqual(['Tests']);
    await page.getByRole('switch', { name: 'Hide done activities' }).click();

    // The Column mode shows a tree (FR-185).
    await page.getByRole('group', { name: 'Activity names' }).getByRole('button', { name: 'Column', exact: true }).click();
    const col = page.locator('.plan-name-col');
    const groupName = col.locator('.plan-side-row.is-group');
    await groupName.getByRole('button', { name: 'Collapse Pages & Forms' }).waitFor();
    const child = (await col.getByRole('button', { name: 'Pages', exact: true }).boundingBox())!;
    const parent = (await groupName.locator('.plan-name').boundingBox())!;
    expect(child.x).toBeGreaterThan(parent.x);
  });

  it('links to and from a group push all its activities; a link into itself is refused (11.3: 4)', async () => {
    const { page, t0 } = await withPlan('groups-links');
    await addActivity(page, 'Design'); // t0 .. t0+2
    await addActivity(page, 'Pages'); // t0+3 .. t0+5
    await addActivity(page, 'Forms'); // t0+6 .. t0+8
    await addActivity(page, 'Launch day'); // t0+9 .. t0+11
    await drag(page, block(page, 'Forms'), { onto: block(page, 'Pages') });
    await groupHead(page, 'Pages & Forms').waitFor();

    // Design → group, then a longer Design pushes both activities of the group.
    await drag(page, endGrip(page, 'Design'), { onto: groupHead(page, 'Pages & Forms') });
    await page.getByRole('button', { name: 'Design → Pages & Forms, remove link' }).waitFor({
      state: 'attached',
    });
    await drag(page, endGrip(page, 'Design'), { dx: 4 * DAY }); // ends t0+6
    // Each activity of the group goes to the first day it may start (FR-136).
    await waitDays(page, 'Pages', plus(t0, 7), plus(t0, 9));
    await waitDays(page, 'Forms', plus(t0, 7), plus(t0, 9));

    // group → Launch day: it waits for the last activity of the group.
    await collapseButton(page, 'Pages & Forms').click();
    await drag(page, page.getByRole('button', { name: 'Link from the end of Pages & Forms' }), {
      onto: block(page, 'Launch day'),
    });
    await waitDays(page, 'Launch day', plus(t0, 10), plus(t0, 12));

    // A group linked to its own activity is a loop.
    await expandButton(page, 'Pages & Forms').click();
    await drag(page, endGrip(page, 'Pages'), { onto: groupHead(page, 'Pages & Forms') });
    await page.getByRole('alert').filter({ hasText: 'loop' }).waitFor();
  });

  it('the details page sets Part of, and ungroups or deletes a group with Undo (11.3: 6)', async () => {
    const { page } = await withPlan('groups-details');
    await addActivity(page, 'Pages');
    await addActivity(page, 'Forms');
    await addActivity(page, 'Tests');

    // Part of: a new group with another activity.
    await detailsLink(page, 'Forms').click();
    await page.getByLabel('Part of').selectOption({ label: 'New group with Pages' });
    await page.getByLabel('Part of').locator('option:checked', { hasText: 'Pages & Forms' }).waitFor();
    await page.getByRole('link', { name: 'Back to Launch' }).click();
    await groupHead(page, 'Pages & Forms').waitFor();

    // Part of: join the group, then none.
    await detailsLink(page, 'Tests').click();
    await page.getByLabel('Part of').selectOption({ label: 'Pages & Forms' });
    await page.getByRole('link', { name: 'Back to Launch' }).click();
    expect(await rowNames(page)).toEqual(['Pages & Forms', 'Pages', 'Forms', 'Tests']);
    await page.waitForFunction(
      () => document.querySelectorAll('.plan-group-box .plan-bar').length === 3,
    );
    await detailsLink(page, 'Tests').click();
    await page.getByLabel('Part of').selectOption({ label: 'None' });
    await page.getByRole('link', { name: 'Back to Launch' }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('.plan-group-box .plan-bar').length === 2,
    );

    // A group's details: dates are read-only; Ungroup with Undo.
    await detailsLink(page, 'Pages & Forms').click();
    expect(await page.getByLabel('Duration (days)').count()).toBe(0);
    await page.getByRole('button', { name: 'Ungroup' }).click();
    await heading(page, 'Launch').waitFor();
    await groupHead(page, 'Pages & Forms').waitFor({ state: 'detached' });
    expect(await rowNames(page)).toEqual(['Pages', 'Forms', 'Tests']);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await groupHead(page, 'Pages & Forms').waitFor();

    // Delete group and its activities, with Undo.
    await detailsLink(page, 'Pages & Forms').click();
    await page.getByRole('button', { name: 'Delete group and 2 activities' }).click();
    await heading(page, 'Launch').waitFor();
    expect(await rowNames(page)).toEqual(['Tests']);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await groupHead(page, 'Pages & Forms').waitFor();
    expect(await rowNames(page)).toEqual(['Pages & Forms', 'Pages', 'Forms', 'Tests']);
  });
});
