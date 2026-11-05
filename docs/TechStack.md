# ToDoness – Tech Stack (simplified)

> Offline-first to-do web app for internal (intranet) use. Every change is saved
> on the device first. When the connection comes back, the app sends all queued
> changes to the server and receives changes made on other devices.
>
> **Version 2:** simplified for a small internal app (5 users, a few tasks each).
> The offline sync design is kept; everything else was cut back. Section 3 lists
> what was removed.

---

## 1. Requirements and constraints

| # | Requirement | How the stack covers it |
|---|-------------|-------------------------|
| R1 | The app loads with no network | PWA + Service Worker caches the app |
| R2 | Create, edit, complete and delete tasks offline | All reads and writes go to the local database (IndexedDB) |
| R3 | Changes survive reloads, closed tabs and restarts | Data and the queue of pending changes are stored in IndexedDB |
| R4 | Queued changes are re-sent when the connection returns | Outbox queue + sync engine |
| R5 | Re-sending never creates duplicates | IDs created on the device + the server ignores changes it already applied |
| R6 | Conflicts between devices resolve automatically | Per-field "last write wins" with Hybrid Logical Clocks |
| R7 | Login with e-mail and password, open sign-up, admin can reset a password | Small built-in auth (section 7) |
| R8 | Intranet only, simple to run | One server process, one SQLite file, one container |

---

## 2. Recommended stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | **TypeScript** (strict) | Same language and shared types on client and server |
| UI | **React 19** + **Vite** | Common, stable, fast build |
| Styling | **Plain CSS** with CSS variables (light/dark) | No extra framework for a small UI |
| Navigation | **wouter** (1 KB router) | Only a few views: Inbox, Today, All tasks, lists, settings, admin |
| PWA / offline app | **vite-plugin-pwa** (Workbox) | Caches the app shell, handles updates |
| Local database | **IndexedDB** via **Dexie.js** | Reliable, async, `useLiveQuery` keeps the UI in sync with the data |
| Sync | **Custom outbox + push/pull** (section 6) | Simple and fits a to-do domain |
| Validation | **Zod** (shared package) | One set of rules for client and server |
| Server | **Node.js 22 LTS** + **Hono** | Small API server. It also serves the built web app, so there is one process |
| Server database | **SQLite** (WAL mode) via **better-sqlite3** | One file, no database server to install or run |
| Migrations | Numbered plain `.sql` files, run at server start | No ORM needed |
| Passwords | **argon2id** (`@node-rs/argon2`) | Current best practice |
| Sessions | Random session ID in an `HttpOnly` cookie, stored in SQLite | No auth library needed |
| Tests | **Vitest** + **fake-indexeddb**; one **Playwright** offline→online test | Covers the sync logic and the key scenario |
| Packaging | **pnpm workspaces** (`client`, `server`, `shared`) | Shared code without extra tooling |
| Deployment | One **Docker** container (or a plain Node service) on an internal server, with an **HTTPS** reverse proxy (section 5) | Easy to run and back up |
| Backups | Nightly `sqlite3 todoness.db ".backup ..."` copy | One file to protect |

---

## 3. What was removed compared with version 1

| Removed | Replaced by |
|---------|-------------|
| PostgreSQL + Drizzle ORM | SQLite + plain SQL |
| Better Auth / Auth.js | Small built-in login (about 150 lines) |
| Tailwind CSS + shadcn/ui | Plain CSS |
| TanStack Router | wouter |
| Zustand | Not needed (Dexie live queries hold the state) |
| Turborepo | pnpm workspaces only |
| Background Sync API | Sync while the app is open (works in all browsers) |
| Web Locks API | Not needed (the server ignores repeated changes) |
| Cleanup jobs, change-log compaction, full resync | Not needed at this size; the data stays tiny |
| Sentry, cloud hosting, CI deployment | Server logs on the intranet host |

---

## 4. Architecture

```
┌──────────────────────────── Browser (PWA) ────────────────────────────┐
│                                                                        │
│  React UI ──reads──▶  Dexie live queries  ◀──writes── Repository layer │
│                              │                            │            │
│                              ▼                            ▼            │
│                 ┌─────────── IndexedDB ───────────────────────────┐    │
│                 │  todos │ lists │ outbox │ deadLetter │ meta      │    │
│                 └──────────────────────────────────────────────────┘    │
│                              ▲                                          │
│                    Sync engine (push outbox, then pull)                 │
│                              ▲                                          │
│        Service Worker: caches the app · asks the user to reload        │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │ HTTPS (JSON)
                               ▼
        ┌──────── One Node.js process (Hono) ────────┐
        │  serves the web app   ·   /api/* endpoints  │
        └──────────────────────┬──────────────────────┘
                               ▼
                   SQLite file (todoness.db)
```

**Main rule:** the UI never waits for the network. It reads from and writes to
IndexedDB only. The sync engine runs in the background.

---

## 5. HTTPS on the intranet (important)

Browsers only allow **Service Workers** (and therefore offline mode and
installing the app) on a **secure origin**: `https://…` or `http://localhost`.
A plain `http://todo.company.local` address will load the app online, but
**offline mode will silently not work**.

The certificate must also be trusted by the devices. A self-signed certificate
with a browser warning is not enough, because the Service Worker fails to
register.

**Decision for ToDoness: Caddy with `tls internal`** (full example in
[section 13](#13-deployment-example-docker-compose--caddy)). The other options
are kept below for reference.

Options:

| Option | Notes |
|--------|-------|
| **Certificate from the company's internal CA** | Best choice if IT already runs one. Devices already trust it. |
| **Caddy reverse proxy with `tls internal`** | Caddy creates its own CA. Its root certificate must be installed on every device (IT can push it). |
| **Public certificate for an internal name** | For example `todo.yourcompany.com` pointing to an internal IP, using a DNS-challenge certificate (Let's Encrypt). No device setup needed. |

Test early: open the app on a phone and a laptop, go offline, and reload.

---

## 6. Offline sync design

### 6.1 Local write (works online and offline)

In **one Dexie transaction**:

1. Insert or update the row in `todos` or `lists`. The UI updates at once.
2. Append an operation to the `outbox` table:

```ts
type OutboxOp = {
  opId: string;          // UUIDv7, used as the idempotency key
  entity: 'todo' | 'list';
  entityId: string;      // UUIDv7 created on the device
  type: 'create' | 'update' | 'delete' | 'restore';
  patch: Partial<Todo | List>;  // only the fields that changed
  hlc: string;           // Hybrid Logical Clock timestamp
  attempts: number;
  createdAt: number;
};
```

Because IDs are created on the device, a task created offline already has its
final ID. There is no renaming of temporary IDs later.

### 6.2 When does sync run?

| Trigger | Notes |
|---------|-------|
| App start | Right after the app loads |
| `window` `online` event | The browser regained a connection |
| Tab becomes visible | The user returns to the app |
| After each local change (wait about 1 s) | Near real time when online |
| Every 60 s while online | Picks up changes from other devices |

`navigator.onLine` is only a hint. The real check is whether the request
succeeds. If two tabs sync at once, nothing breaks, because the server ignores
operations it has already applied.

### 6.3 Push, then pull

**Push**

1. Read the oldest pending operations from `outbox`, in order.
2. `POST /api/sync/push` with `{ clientId, ops: [...] }`.
3. The server applies them in **one SQLite transaction** (`BEGIN IMMEDIATE`, so
   only one writer at a time):
   - skip any `opId` already in `processed_ops`,
   - apply each field with the conflict rules below,
   - add a row to `change_log` for each accepted operation.
4. The server replies with accepted and rejected `opId`s.
5. The client deletes accepted operations from `outbox`.
6. On a network error or server error (5xx): keep the operations and retry with
   growing delays (1 s, 2 s, 4 s … up to 5 minutes).
   On a validation error (4xx): move the operation to `deadLetter` and show a
   notice. On `401` (not logged in): show the login screen and **keep** the
   local data and the outbox.

**Pull**

1. `GET /api/sync/pull?since=<lastServerSeq>`
2. The server returns changes with a higher `server_seq` (in pages).
3. The client applies them in one transaction with the same per-field "last write
   wins" rule as the server. Every local row remembers the clock of each field,
   so a pending local edit that is newer than the incoming change stays, and an
   older one gives way. (Skipping fields that have pending operations would be
   wrong: if the remote value later wins on the server, this browser would keep
   a stale value.)
4. The client moves its own clock past the newest timestamp it received, then
   saves the new `lastServerSeq`.

A new device starts with `since=0` and so receives all data.

### 6.4 Conflict rules

| Situation | Rule |
|-----------|------|
| Two devices edit **different fields** of one task | Both changes are kept |
| Two devices edit the **same field** | The later change wins (by HLC; ties broken by client ID) |
| One device edits, another deletes | The delete wins (the row stays as a "deleted" marker) |
| Reordering tasks | Fractional ordering keys (`fractional-indexing` package), so a reorder rewrites one row |

Hybrid Logical Clocks avoid trusting device clocks that are set wrongly.

---

## 7. Authentication and admin

| Topic | Design |
|-------|--------|
| Sign-up | Open: anyone who can reach the app can register with e-mail and password. |
| Admin | The **first account created becomes admin** (`users.role = 'admin'`). Admin can promote others later in the database if needed. |
| Login | E-mail + password. The server sets a session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) valid for 90 days. |
| Passwords | argon2id hashes. Minimum 8 characters. |
| **Admin password reset** | Admin clicks "Reset password" for a user. The server clears that user's password hash (`password_hash = NULL`) and deletes their sessions. The next time that user logs in, the password they type is saved as their **new password** and they are logged in. |
| Offline | The app works offline with no session check. When the connection returns and the session has expired or been reset, the server answers `401`, the app shows the login screen, and pending changes are kept and sent after login. |
| Logout | Clears local data. Warns first if changes are still pending. |
| Rate limiting | A small limit on login attempts per IP and e-mail. |

> **Trade-off of the reset design:** between the admin's reset and the user's
> next login, anyone who knows that e-mail could set the password. On a closed
> intranet this is acceptable. If you want it stricter, the admin can type a
> temporary password instead. It is a small change to one function.

### API endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Health check for Docker (no login needed) |
| `POST /api/auth/register` | Create account |
| `POST /api/auth/login` | Log in (or set a new password after an admin reset) |
| `POST /api/auth/logout` | Log out |
| `GET /api/me` | Current user and role |
| `POST /api/sync/push` | Send queued changes |
| `GET /api/sync/pull` | Receive changes since a cursor |
| `GET /api/admin/users` | List users (admin) |
| `POST /api/admin/users/:id/reset-password` | Reset a password (admin) |
| `DELETE /api/admin/users/:id` | Delete a user and their data (admin) |

The server checks user ownership on every query, validates every request with
the shared Zod schemas, and allows only whitelisted fields in sync patches.

---

## 8. PWA details

- `vite-plugin-pwa` with `registerType: 'prompt'`: shows "New version
  available, reload?" instead of switching versions silently.
- Cache the app shell (HTML, JS, CSS, icons). API calls are **not** cached by
  the Service Worker, because data comes from IndexedDB.
- Call `navigator.storage.persist()` so the browser does not clear the data when
  space is low (important on Safari and iOS).
- Web App Manifest with icons and `display: "standalone"`, so the app can be
  installed.
- The UI shows the sync state: *Offline*, *Syncing…*, *All changes saved*, or
  *N changes pending*.

---

## 9. Project structure

```
todoness/
├── client/                    # React PWA
│   ├── public/                # icons (generated by scripts/make-icons.cjs)
│   └── src/
│       ├── app/               # screens, session handling, services
│       │   └── components/
│       ├── data/              # Dexie schema (db.ts), repository, queries
│       ├── sync/              # engine.ts, apply-changes.ts, runner.ts, backoff.ts
│       └── styles.css
├── server/
│   ├── scripts/postbuild.mjs  # copies migrations, writes dist/package.json
│   └── src/
│       ├── auth/              # passwords, sessions, rate limit, users
│       ├── routes/            # auth.ts, sync.ts, admin.ts
│       ├── sync/              # apply-ops.ts (conflict rules), rows.ts
│       ├── db/                # connection, migrate, migrations/*.sql
│       ├── static.ts          # serves client/dist
│       └── index.ts
├── shared/                    # ids, Hybrid Logical Clock, Zod schemas, merge rules
├── integration/               # simulated browsers against the real server (Vitest)
├── e2e/                       # Playwright against the built app
├── docs/
│   ├── PRD.md
│   ├── TechStack.md
│   ├── DBModel.md
│   └── MVPImplementationSteps.md
├── Dockerfile                 # see section 13
├── docker-compose.yml         # app + Caddy + backup
├── Caddyfile
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

## 10. Implementation roadmap

1. **Setup:** pnpm workspace, Vite + React + TypeScript, Hono server, SQLite with migrations.
2. **Local-only version:** Dexie schema, tasks and lists, PWA app shell, fully usable offline.
3. **Outbox:** write operations to the outbox in the same transaction as each local change.
4. **Sync:** `/sync/push` (repeat-safe) and `/sync/pull` (cursor), triggers, retry delays.
5. **Conflicts:** HLC, per-field rules, deleted markers, fractional ordering.
6. **Accounts:** register, login, sessions, first user is admin, admin password reset.
7. **Intranet deployment:** Docker, HTTPS certificate (section 5), nightly backup.
8. **Polish:** sync status indicator, update prompt, `storage.persist()`.

---

## 11. Testing

| Level | Tool | Must cover |
|-------|------|------------|
| Unit | Vitest | HLC ordering, per-field merge, outbox order, retry delays |
| Integration | Vitest + fake-indexeddb + in-memory SQLite | Push/pull round trip, repeated push, conflict cases, admin reset login |
| End to end | Playwright (`context.setOffline(true)`) | Go offline → add, edit, delete → reload → data is still there → go online → data reaches the server and a second browser |
| Manual | Phone and laptop on the real intranet address | HTTPS works, app installs, offline reload works |

---

## 12. When to reconsider

Keep this stack while the app stays small. Consider changes if:

| Situation | Change |
|-----------|--------|
| Many more users or heavy write load | Move SQLite to PostgreSQL (the SQL is simple to port) |
| Several people edit the same long text | Use a CRDT (Yjs or Automerge) for that field |
| The company wants single sign-on | Replace the built-in login with the company's identity provider |
| Sync after the app is closed is needed | Add the Background Sync API (Chromium only) |

---

## 13. Deployment example (Docker Compose + Caddy)

Three containers on one internal server:

| Service | Purpose |
|---------|---------|
| `app` | The Node.js server. Serves the web app and `/api/*`. Stores data in a volume. Not reachable from outside. |
| `caddy` | HTTPS reverse proxy in front of `app`. Uses its own internal certificate authority (`tls internal`). |
| `backup` | Optional. Copies the SQLite file once a day and keeps 14 days. |

> **Status:** the files below are the real ones at the repository root. What has
> been checked: the compose file is valid (`docker compose config`); the build
> stage's commands (frozen install without scripts, both builds) and the run
> stage's steps (copy bundle, `npm install --omit=dev`, start with the image's
> environment) were run by hand in clean folders and the app answered correctly.
> **Not yet done:** an actual `docker build`, and Caddy itself (no Docker daemon
> was available where this was developed). Do both on the server before relying
> on it.

### 13.1 `docker-compose.yml`

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      COOKIE_SECURE: 'true' # cookies only over HTTPS (Caddy provides it)
      TRUST_PROXY: 'true' # use the client IP that Caddy forwards (login rate limit)
    volumes:
      - todoness-data:/data
    expose:
      - '3000' # only visible to other containers, not published
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on:
      app:
        condition: service_healthy
    ports:
      - '80:80' # redirects to HTTPS
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data # keeps the internal CA and certificates
      - caddy-config:/config

  backup: # optional: a copy of the database once a day, kept for 14 days
    image: alpine:3.20
    restart: unless-stopped
    entrypoint: ['/bin/sh', '-c']
    command:
      - |
        apk add --no-cache sqlite
        while true; do
          sqlite3 /data/todoness.db ".backup '/backups/todoness-$$(date +%F).db'"
          find /backups -name 'todoness-*.db' -mtime +14 -delete
          sleep 86400
        done
    volumes:
      - todoness-data:/data
      - ./backups:/backups

volumes:
  todoness-data:
  caddy-data:
  caddy-config:
```

### 13.2 `Caddyfile`

```caddyfile
# Use the internal DNS name of the server. Avoid ".local": it clashes with mDNS
# on some devices. A name like todo.company.internal works well.
todo.company.internal {
	tls internal
	encode zstd gzip

	# The service worker file must never be cached for long, or app updates stall.
	@sw path /sw.js
	header @sw Cache-Control "no-cache"

	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "same-origin"
	}

	reverse_proxy app:3000
}
```

### 13.3 `Dockerfile`

```dockerfile
# ---- build: compile the web app and bundle the server ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable

# Manifests first, so installing dependencies is cached until they change.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
COPY integration/package.json integration/
COPY e2e/package.json e2e/
# Install scripts are skipped: nothing is run here, so native modules need no compiling.
RUN pnpm install --frozen-lockfile --ignore-scripts \
    --filter "@todoness/client..." --filter "@todoness/server..."

COPY . .
RUN pnpm --filter @todoness/client build && pnpm --filter @todoness/server build

# ---- run: only what the server needs ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/todoness.db \
    CLIENT_DIR=/app/public
WORKDIR /app

# The server bundle, its SQL migrations and a package.json that lists only the
# two native modules (better-sqlite3, @node-rs/argon2).
COPY --from=build /app/server/dist/ ./
RUN npm install --omit=dev --no-audit --no-fund \
    && mkdir -p /data && chown node:node /data
COPY --from=build /app/client/dist/ ./public/

USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "index.js"]
```

### 13.4 Server settings (environment variables)

| Variable | Meaning |
|----------|---------|
| `PORT` | Port the server listens on inside the container (`3000`) |
| `DATABASE_PATH` | Location of the SQLite file (on the `todoness-data` volume) |
| `CLIENT_DIR` | Folder with the built web app that the server serves (`/app/public` in the image) |
| `COOKIE_SECURE` | `true` in production, so the session cookie is only sent over HTTPS |
| `TRUST_PROXY` | `true` when running behind Caddy, so the real client IP is used |

The server must answer `GET /api/health` with status 200 when it can open the
database (used by the health check).

### 13.5 First start and daily use

1. Point the internal DNS name (for example `todo.company.internal`) at the server.
2. Put the name in the `Caddyfile`, then run `docker compose up -d --build`.
3. Export Caddy's root certificate:
   `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt`
4. Install `caddy-root.crt` as a trusted root certificate on every device
   (company policy for laptops; on iPhone also switch on full trust for it in
   Settings → General → About → Certificate Trust Settings).
5. Open `https://todo.company.internal`, register the **first account** (it
   becomes the admin), then let the others register.
6. Check offline mode: install the app, switch the network off, reload.

Keep the `caddy-data` volume. If it is lost, Caddy creates a **new** root
certificate and every device has to trust it again.

**Update the app:** `git pull && docker compose up -d --build`. Users see the
"New version available, reload?" prompt.

**Restore a backup:** stop the app (`docker compose stop app`), copy the backup
file over `/data/todoness.db` in the volume, delete `todoness.db-wal` and
`todoness.db-shm` there, and start the app again.
