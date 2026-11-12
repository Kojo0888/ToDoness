/** Sort activities and Auto sort in the real app (docs/plan-sort/PRD.md section 5). */
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch, newDevice, newPage, signUp, startApp, uniqueEmail, type App } from './harness';

let app: App;
let browser: Browser;

beforeAll(async () => {
  app = await startApp();
  browser = await launch();
  await signUp(await newPage(await newDevice(browser, app)), uniqueEmail('admin'));
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });
const optionsButton = (page: Page) => page.getByRole('button', { name: 'Timeline options' });
const sortButton = (page: Page) => page.getByRole('button', { name: 'Sort activities' });
const autoSort = (page: Page) => page.getByRole('switch', { name: 'Auto sort' });
const undo = (page: Page) => page.getByRole('button', { name: 'Undo last change' });
const rowNames = (page: Page) =>
  page
    .locator('.plan-details-btn')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace('Details of ', '')));

async function withPlan(name: string) {
  const page = await newPage(await newDevice(browser, app));
  await signUp(page, uniqueEmail(name));
  await page.getByRole('group', { name: 'Modules' }).getByRole('link', { name: 'Plan' }).click();
  await page.waitForURL(/\/plans?(\/|$)/);
  const input = page.getByLabel('New plan name');
  await input.fill('Launch');
  await input.press('Enter');
  await heading(page, 'Launch').waitFor();
  return page;
}

async function addActivity(page: Page, name: string) {
  const input = page.getByLabel('Add an activity');
  await input.fill(name);
  await input.press('Enter');
  await page.locator(`.plan-block[aria-label^="${name}, "]`).waitFor();
}

/** Pushes `name` later with the arrow key on its block: it then starts after the others. */
async function later(page: Page, name: string, days: number) {
  const b = page.locator(`.plan-block[aria-label^="${name}, "]`);
  await b.focus();
  for (let i = 0; i < days; i++) await b.press('ArrowRight');
}

describe('plan sort', () => {
  it('sorts once on demand, undoes in one step, and remembers Auto sort', async () => {
    const page = await withPlan('sort');
    await addActivity(page, 'A'); // day 0
    await addActivity(page, 'B'); // day 3
    await addActivity(page, 'C'); // day 6
    await later(page, 'A', 12); // A now starts last
    expect(await rowNames(page)).toEqual(['A', 'B', 'C']);

    await optionsButton(page).click();
    await sortButton(page).click();
    await expect.poll(() => rowNames(page)).toEqual(['B', 'C', 'A']);

    await undo(page).click();
    await expect.poll(() => rowNames(page)).toEqual(['A', 'B', 'C']);

    // Auto sort: off by default, on sorts at once and after every change.
    await optionsButton(page).click();
    expect(await autoSort(page).isChecked()).toBe(false);
    await autoSort(page).check();
    await expect.poll(() => rowNames(page)).toEqual(['B', 'C', 'A']);
    await later(page, 'B', 20);
    await expect.poll(() => rowNames(page)).toEqual(['C', 'A', 'B']);

    await page.reload();
    await heading(page, 'Launch').waitFor();
    await optionsButton(page).click();
    expect(await autoSort(page).isChecked()).toBe(true);
  }, 60_000);
});
