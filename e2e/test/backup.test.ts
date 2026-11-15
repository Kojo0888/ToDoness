/** Automatic backups in the Admin screen of the real app (docs/backup/PRD.md). */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addTask,
  launch,
  logIn,
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
let backupDir: string;
let admin: Page;
let adminEmail: string;

const zips = () =>
  existsSync(backupDir) ? readdirSync(backupDir).filter((f) => f.endsWith('.zip')) : [];
const section = (page: Page) => page.getByRole('region', { name: 'Backup data' });

beforeAll(async () => {
  backupDir = join(mkdtempSync(join(tmpdir(), 'todoness-e2e-backup-')), 'backups');
  app = await startApp({ BACKUP_DIR: backupDir });
  browser = await launch();
  // The first account is the administrator.
  admin = await newPage(await newDevice(browser, app));
  adminEmail = uniqueEmail('admin');
  await signUp(admin, adminEmail);
  await addTask(admin, 'Something to back up');
  await waitSaved(admin);
  await admin.getByRole('link', { name: 'Admin' }).click();
  await section(admin).waitFor();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

describe('Backup data (Admin screen)', () => {
  it('is off by default: weekly, keeping 3, with the folder shown and no backup yet', async () => {
    const box = section(admin);
    await expect.poll(() => box.getByRole('switch').isChecked()).toBe(false);
    await expect
      .poll(() =>
        box.getByRole('button', { name: 'Weekly', exact: true }).getAttribute('aria-pressed'),
      )
      .toBe('true');
    await expect.poll(() => box.getByLabel('Backups to keep').inputValue()).toBe('3');
    await expect.poll(() => box.textContent()).toContain(backupDir);
    expect(zips()).toEqual([]);
  });

  it('switching it on makes the first backup at once; it is listed, with the next one planned', async () => {
    const box = section(admin);
    await box.getByRole('button', { name: 'Monthly', exact: true }).click();
    await box.getByRole('switch').check();
    await expect.poll(() => zips().length, { timeout: 15_000 }).toBe(1);
    await expect.poll(() => box.getByRole('listitem').count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => box.textContent()).toMatch(/todoness-backup-\d{8}-\d{6}\.zip/);
    await expect.poll(() => box.textContent()).toContain('Next backup');
  });

  it('the choices are kept when the page is opened again', async () => {
    await admin.reload();
    const box = section(admin);
    await box.waitFor();
    await expect.poll(() => box.getByRole('switch').isChecked()).toBe(true);
    await expect
      .poll(() =>
        box.getByRole('button', { name: 'Monthly', exact: true }).getAttribute('aria-pressed'),
      )
      .toBe('true');
  });

  it('only the newest backups are kept; the number is set in the screen', async () => {
    const box = section(admin);
    const keep = box.getByLabel('Backups to keep');
    await keep.fill('2');
    await keep.press('Enter');
    for (let i = 0; i < 3; i++) {
      await box.getByRole('button', { name: 'Back up now' }).click();
      await expect
        .poll(() => box.getByRole('button', { name: 'Back up now' }).isEnabled(), {
          timeout: 15_000,
        })
        .toBe(true);
    }
    await expect.poll(() => zips().length, { timeout: 15_000 }).toBe(2);
    await expect.poll(() => box.getByRole('listitem').count(), { timeout: 15_000 }).toBe(2);
  });

  it('refuses a number outside 1 – 100 and keeps the old one', async () => {
    const box = section(admin);
    const keep = box.getByLabel('Backups to keep');
    await keep.fill('0');
    await keep.press('Enter');
    await admin.reload();
    await section(admin).waitFor();
    await expect.poll(() => section(admin).getByLabel('Backups to keep').inputValue()).toBe('2');
  });

  it('works on a phone: no sideways scrolling and 44 px targets', async () => {
    const phone = await newPage(await newDevice(browser, app, { width: 390, height: 800 }));
    await logIn(phone, adminEmail);
    await phone.goto('/admin');
    const box = section(phone);
    await box.waitFor();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    for (const target of [
      box.getByRole('button', { name: 'Back up now' }),
      box.getByRole('button', { name: 'Daily', exact: true }),
      box.getByLabel('Backups to keep'),
    ]) {
      const b = (await target.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
  });
});

describe('who can see it', () => {
  it('an ordinary user has no Admin screen', async () => {
    const page = await newPage(await newDevice(browser, app));
    await signUp(page, uniqueEmail('plain'));
    await page.getByRole('link', { name: 'Settings' }).waitFor();
    expect(await page.getByRole('link', { name: 'Admin' }).count()).toBe(0);
    const status = await page.evaluate(async () => (await fetch('/api/admin/backup')).status);
    expect(status).toBe(403);
  });
});
