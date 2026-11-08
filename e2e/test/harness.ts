/**
 * Starts the REAL built app (server serving client/dist, SQLite file) and drives
 * it with Chromium. Build first: `pnpm build`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PASSWORD = 'correct horse';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface App {
  url: string;
  stop(): Promise<void>;
}

export async function startApp(extraEnv: Record<string, string> = {}): Promise<App> {
  if (
    !existsSync(join(root, 'server/dist/index.js')) ||
    !existsSync(join(root, 'client/dist/index.html'))
  ) {
    throw new Error('Build the app first: pnpm build');
  }
  const dir = mkdtempSync(join(tmpdir(), 'todoness-e2e-'));
  const port = await freePort();
  const child: ChildProcess = spawn('node', ['server/dist/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_PATH: join(dir, 'todoness.db'),
      CLIENT_DIR: join(root, 'client/dist'),
      COOKIE_SECURE: 'false', // plain http://localhost in tests
      ...extraEnv,
    },
    stdio: 'ignore',
  });

  const url = `http://localhost:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (i > 100) throw new Error('The server did not start');
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    url,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function launch(): Promise<Browser> {
  return chromium.launch();
}

/** A "device": its own storage, cookies, service worker and network switch. */
export function newDevice(browser: Browser, app: App, viewport = { width: 1100, height: 800 }) {
  return browser.newContext({ baseURL: app.url, viewport });
}

let counter = 0;
export const uniqueEmail = (name = 'user') => `${name}${++counter}@corp.test`;

// ---------------------------------------------------------------------------
// Things a user does
// ---------------------------------------------------------------------------

export async function signUp(page: Page, email: string, password = PASSWORD) {
  await page.goto('/');
  await page.getByRole('button', { name: 'No account yet? Sign up' }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.getByRole('heading', { level: 2, name: 'Inbox' }).waitFor();
}

export async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('heading', { level: 2, name: 'Inbox' }).waitFor();
}

export async function addTask(page: Page, title: string) {
  const input = page.getByLabel('Add a task');
  await input.fill(title);
  await input.press('Enter');
  await task(page, title).waitFor();
}

export const task = (page: Page, title: string) =>
  page.getByRole('link', { name: title, exact: true });

export const badge = (page: Page) => page.getByTestId('sync-status');

export async function waitSaved(page: Page) {
  await badge(page).filter({ hasText: 'All changes saved' }).waitFor({ timeout: 20_000 });
}

/** Same as switching back to the tab: makes the app sync right now. */
export async function syncNow(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

/** The service worker is installed and the app is cached, so offline reloads work. */
export async function waitForOfflineReady(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(async () => {
    const names = await caches.keys();
    for (const n of names) if ((await (await caches.open(n)).keys()).length > 5) return true;
    return false;
  });
}

export async function openTask(page: Page, title: string) {
  await task(page, title).click();
  await page.getByRole('complementary', { name: 'Task details' }).waitFor();
}

/** The titles of the open tasks, top to bottom. */
export async function titlesOnPage(page: Page): Promise<string[]> {
  return page.locator('.todos:not(.completed .todos) .todo .todo-title').allTextContents();
}

export async function newPage(context: BrowserContext) {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  return page;
}
