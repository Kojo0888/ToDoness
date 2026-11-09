# ToDoness

Simple to-do list app for internal use that keeps working offline. Changes made
without a connection are saved on the device and sent automatically when the
connection returns.

## Features

- Tasks and lists that keep working **offline**; changes sync automatically.
- Change your **password** in Settings; the admin can still reset a forgotten one.
- Make a list **public**: every user can read **and edit** its tasks under "Public lists"
  (add, change, complete, delete, reorder, attach files). Only the owner can rename or
  delete the list or make it private again.
- Reorder tasks by **drag and drop** (mouse, touch or keyboard), or drop a task on a
  list in the sidebar to move it there.
- **Reminders**: 1 week, 1 day or 1 hour before a task is due, as a notification, also
  when the app is closed (**web push**, needs HTTPS, see below).
- **Attachments** on tasks, up to a configurable size per file.
- The admin screen shows **who is online**, and admins see **sync diagnostics** (flags and a
  log of the last 100 sync events with timings) above the "All changes saved" indicator, to
  find out why a reconnect was slow.

## Documentation

| Folder                   | Contents                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/v1/`](docs/v1/)   | Version 1: [PRD](docs/v1/PRD.md), [implementation plan with status](docs/v1/ImplementationPlan.md), [tech stack changes](docs/v1/TechStack.md)                |
| [`docs/mvp/`](docs/mvp/) | The MVP: [PRD](docs/mvp/PRD.md), [tech stack](docs/mvp/TechStack.md), [database model](docs/mvp/DBModel.md), [build plan](docs/mvp/MVPImplementationSteps.md) |

## Development

Requires Node.js 22 and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev          # web app on http://localhost:5173, API on http://localhost:3000
pnpm test         # unit and integration tests (fast, no browser)
pnpm e2e          # builds the app, then runs the browser tests (needs Chromium)
pnpm typecheck
pnpm lint
pnpm build
```

The first account you create becomes the admin.

## Launching the client

Run `pnpm install` once first. There are two ways to open the client. Pick one.

### A. Development: client and server separately

Use this while changing the code (the page reloads when you save).

```sh
pnpm --filter @todoness/server dev    # terminal 1: API on http://localhost:3000
pnpm --filter @todoness/client dev    # terminal 2: client on http://localhost:5173
```

If the server is already running, only start the client (terminal 2), then open
**http://localhost:5173**. `pnpm dev` starts both together.

The client forwards every `/api` request to `http://localhost:3000`, so the
server has to listen on port 3000 (the default). If it uses another port, change
`proxy` in `client/vite.config.ts`.

In this mode the service worker is off, so **offline mode does not work**.

### B. The built app, served by the server

Use this to try the real thing, including offline mode and installing the app.

```sh
pnpm build
CLIENT_DIR=client/dist node server/dist/index.js    # open http://localhost:3000
```

The server serves the built client itself, so there is no separate client to
start. Settings are environment variables, see [Configuration](#configuration).
Offline mode, installing and notifications need `http://localhost` or HTTPS; a plain
`http://` address on another machine will not work (see [Deployment](#deployment)).

`pnpm e2e` uses Playwright 1.63 with Chromium. If the browser is not installed:
`pnpm --filter @todoness/e2e exec playwright install chromium`.

| Package        | Contents                                                                   |
| -------------- | -------------------------------------------------------------------------- |
| `client/`      | React web app (Vite, installable PWA), local database (Dexie), sync engine |
| `server/`      | API server (Hono on Node.js, SQLite) that also serves the web app          |
| `shared/`      | Code used by both: IDs, Hybrid Logical Clock, schemas, merge rules         |
| `integration/` | Tests with simulated browsers against the real server                      |
| `e2e/`         | Browser tests against the built app                                        |

## Configuration

The server reads these environment variables. All are optional except
`DATABASE_PATH` in production.

| Variable                                | Default                                           | Meaning                                                                                                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                  | `3000`                                            | Port the server listens on.                                                                                                                                                                                                                                            |
| `DATABASE_PATH`                         | `./data/todoness.db` (required in production)     | SQLite database file.                                                                                                                                                                                                                                                  |
| `CLIENT_DIR`                            | _(unset)_                                         | Folder with the built web app. Unset = API only.                                                                                                                                                                                                                       |
| `COOKIE_SECURE`                         | `true` in production, otherwise `false`           | Send the login cookie over HTTPS only.                                                                                                                                                                                                                                 |
| `TRUST_PROXY`                           | `false`                                           | Use the client IP from `X-Forwarded-For` (set to `true` behind Caddy).                                                                                                                                                                                                 |
| **`MAX_ATTACHMENT_MB`**                 | `100`                                             | **Largest allowed attachment, in megabytes per file** (whole number, at least 1). The app reads it from the server (`GET /api/config`), refuses larger files before uploading, and the server enforces it again while receiving. Restart the server after changing it. |
| `ATTACHMENTS_DIR`                       | `attachments` folder next to the database         | Where uploaded files are stored (one sub-folder per user, files named by id).                                                                                                                                                                                          |
| `ONLINE_WINDOW_SECONDS`                 | `30`                                              | A user counts as **online** in the admin screen if the server heard from them this recently (whole number, 10 – 3600).                                                                                                                                                 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | generated on first start and kept in the database | Identity of the server for **web push**. Leave both unset unless you want your own keys (set both or neither). Changing them later invalidates all existing push subscriptions; users then have to switch push off and on again in Settings.                           |
| `VAPID_SUBJECT`                         | `mailto:todoness@localhost`                       | Contact address (`mailto:` or `https://`) sent to push services. Apple's service wants a real-looking address, so set e.g. `mailto:it@company.example` if you have iPhone users.                                                                                       |

Example: allow files up to 250 MB:

```sh
MAX_ATTACHMENT_MB=250 CLIENT_DIR=client/dist node server/dist/index.js
```

Behind a reverse proxy, make sure it does not limit the request size below
`MAX_ATTACHMENT_MB` (Caddy does not by default; nginx needs `client_max_body_size`).

**What to back up:** the database file **and** the attachments folder. In the Docker
setup both are in the `todoness-data` volume (`/data`); the optional `backup` service
copies the database daily and mirrors `/data/attachments` to `./backups/attachments`.

**Notifications and web push** (reminders) use the browser's notification feature, which
only works on **HTTPS** (or `http://localhost`). Without it, reminders still appear inside
the app while it is open.

With **web push** the _server_ checks the reminders every 30 seconds and sends a push, so
the notification also appears when the app is closed. Users allow notifications once (in
Settings, or when they set their first reminder); push is then switched on for that device
automatically and can be switched off in Settings. Logging out removes the device from the
user's pushes. What the server needs for this:

- **Outbound HTTPS from the server** to the browser vendors' push services
  (`fcm.googleapis.com` for Chrome/Edge/Android, `*.push.services.mozilla.com` for Firefox,
  `*.push.apple.com` for Safari/iPhone). On a closed intranet, allow these hosts for the
  server. Without access, pushes fail (logged as `Push to … failed`) and reminders still
  work while the app is open and are caught up when it is next opened.
- iPhones and iPads only support push for the app **installed to the home screen**.
- The push content is encrypted for the device; the vendor's service only sees that a push
  was sent.

## Deployment

One container behind Caddy on the intranet. See
[`docs/mvp/TechStack.md`](docs/mvp/TechStack.md#13-deployment-example-docker-compose--caddy)
section 13 (HTTPS is required for offline mode and notifications to work).

```sh
# set the server name in Caddyfile, then:
docker compose up -d --build
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt  # install on devices
```

Update: `git pull && docker compose up -d --build`. Back up the `todoness-data`
volume (the optional `backup` service copies the database daily to `./backups`).

### Folder-based variant (no image build for the app)

`docker-compose.folder.yml` runs a stock `node:22-bookworm-slim` container on
the built app in `./release`. `./update.sh` builds into that folder (using the
Dockerfile's build stage) and restarts the app; `./update.sh --pull` runs
`git pull` first. Dependencies are installed inside the container on start,
so the native modules always match it. To roll back, keep a copy of `release/`.

If the server is a separate machine, build locally and upload instead:
`./deploy.sh user@server:/path/to/todoness/release` builds the app, then
copies `release/` over with rsync (keeping the server's `node_modules`). The
target must end in `/release`; anything else is refused, because the upload
makes the target an exact copy and would delete everything else in it. It
does not touch Docker; restart the `app` container on the server, or let it
restart itself, to load the new files.

Note: the Docker setup has not been run end to end yet (see the status section
of the build plan).
