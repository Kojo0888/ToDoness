# ToDoness – Tech Stack

> Offline-first to-do web app. Every change is saved locally first. When the
> connection comes back, the app sends all queued changes to the server and
> pulls changes made on other devices.

---

## 1. Requirements

| # | Requirement | How the stack covers it |
|---|-------------|-------------------------|
| R1 | The app loads with no network | PWA + Service Worker precaches the app shell |
| R2 | Create, edit, complete and delete tasks offline | All reads and writes go to IndexedDB (local database) |
| R3 | Changes survive reloads, closed tabs and restarts | Data and the outbox queue are stored in IndexedDB |
| R4 | Queued changes are re-sent when the connection returns | Outbox pattern + sync engine (Background Sync, `online` event, polling) |
| R5 | Re-sending never creates duplicates | Client-generated IDs (UUIDv7) + idempotent server endpoints |
| R6 | Conflicts between devices are resolved predictably | Per-field Last-Write-Wins with Hybrid Logical Clocks (CRDT later if needed) |
| R7 | Works on desktop and mobile, installable | Responsive UI + Web App Manifest |

---

## 2. Recommended stack (summary)

| Layer | Choice | Why |
|-------|--------|-----|
| Language | **TypeScript** (strict) | Shared types between client and server |
| UI framework | **React 19** | Large ecosystem, stable, many developers know it |
| Build tool | **Vite** | Fast dev server, first-class PWA plugin |
| Routing | **TanStack Router** | Type-safe, works fully on the client |
| Styling | **Tailwind CSS v4** + **shadcn/ui** | Fast to build, accessible components you own |
| PWA / Service Worker | **vite-plugin-pwa** (Workbox) | Precaching, runtime caching, update prompts |
| Local database | **IndexedDB** via **Dexie.js** | Reliable, async, large storage limits, reactive queries (`useLiveQuery`) |
| Client state | Dexie live queries (+ **Zustand** for UI-only state) | The local DB is the single source of truth |
| Sync | **Custom outbox + push/pull sync** (see §4) | Simple, no vendor lock-in, fits a to-do domain well |
| Validation | **Zod** | One schema used by client, server and DB layer |
| Backend runtime | **Node.js 22 LTS** (or Bun) | Same language as the client |
| API framework | **Hono** | Small, fast, typed, runs on Node / Bun / edge |
| Server database | **PostgreSQL 17** | Reliable, transactional, good JSON support |
| ORM / migrations | **Drizzle ORM** + drizzle-kit | Type-safe SQL, simple migrations |
| Auth | **Better Auth** (or Auth.js) with refresh tokens | Sessions that keep working offline until the next sync |
| Monorepo | **pnpm workspaces** + **Turborepo** | Shared packages, cached builds |
| Unit / integration tests | **Vitest** + **fake-indexeddb** | Test sync logic without a browser |
| E2E tests | **Playwright** (`context.setOffline(true)`) | Real offline → online scenarios |
| Lint / format | **ESLint (flat config)** + **Prettier** (or **Biome**) | Consistent code |
| CI/CD | **GitHub Actions** | Lint, test, build on every PR |
| Hosting | Static frontend on **Cloudflare Pages / Vercel / Netlify**; API + Postgres on **Fly.io / Railway / Render** (or Neon / Supabase for Postgres) | Cheap, HTTPS by default (required for Service Workers) |
| Monitoring | **Sentry** | Captures errors, including ones raised during sync |

---

## 3. Architecture

```
┌──────────────────────────── Browser (PWA) ────────────────────────────┐
│                                                                        │
│  React UI ──reads──▶  Dexie live queries  ◀──writes── Repository layer │
│                              │                            │            │
│                              ▼                            ▼            │
│                 ┌─────────── IndexedDB ───────────────────────────┐    │
│                 │  todos   │  lists   │  outbox   │  meta (cursor) │    │
│                 └──────────────────────────────────────────────────┘    │
│                              ▲                                          │
│                    Sync Engine (push outbox, pull changes)              │
│                              ▲                                          │
│  Service Worker: app-shell precache · Background Sync · update prompt  │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │ HTTPS (JSON)
                               ▼
               ┌──────────── API (Hono) ────────────┐
               │ POST /sync/push   GET /sync/pull    │
               │ idempotency · conflict resolution   │
               └──────────────┬──────────────────────┘
                              ▼
                        PostgreSQL
           todos · lists · change_log (server_seq) · processed_ops
```

**Main rule:** the UI never waits for the network. It reads from and writes to
IndexedDB only. The sync engine runs in the background.

---

## 4. Offline sync design

### 4.1 Local write (always works, online or offline)

In **one Dexie transaction**:

1. Insert or update the row in `todos` (the UI updates at once).
2. Append an operation to the `outbox` table:

```ts
type OutboxOp = {
  opId: string;          // UUIDv7, used as the idempotency key
  entity: 'todo' | 'list';
  entityId: string;      // UUIDv7 generated on the client
  type: 'create' | 'update' | 'delete';
  patch: Partial<Todo>;  // only the fields that changed
  hlc: string;           // Hybrid Logical Clock timestamp
  attempts: number;
  createdAt: number;
};
```

Because the IDs are generated on the client, a task created offline already has
its final ID. There is no remapping of temporary IDs later.

### 4.2 When does sync run?

The sync engine runs on any of these triggers (each one is optional; together
they cover all browsers):

| Trigger | Notes |
|---------|-------|
| App start | Sync right after the app loads |
| `window` `online` event | Fired when the browser regains a connection |
| `visibilitychange` → visible | The user returns to the tab |
| **Background Sync API** (`registration.sync.register('outbox')`) | Re-sends even after the tab is closed. **Chromium only** – Safari and Firefox fall back to the triggers above |
| After each local write (debounced ~1 s) | Near real-time when online |
| Interval (e.g. every 30–60 s) while online | Picks up changes from other devices |
| Optional: WebSocket / SSE "poke" | Server tells clients that new data is available |

`navigator.onLine` is only a hint. The real check is whether the HTTP request
succeeds.

Use the **Web Locks API** (`navigator.locks.request('sync', …)`) so that only
one tab syncs at a time.

### 4.3 Push (re-send all queued changes)

1. Read the oldest N operations from `outbox`, in order.
2. `POST /sync/push` with `{ clientId, ops: [...] }`.
3. The server, in one transaction for each operation:
   - skips any `opId` already in `processed_ops` (**idempotent** – safe to retry),
   - resolves conflicts (see 4.5),
   - writes the row and appends to `change_log` with a growing `server_seq`.
4. The server replies with the accepted `opId`s (and rejected ones with reasons).
5. The client deletes the accepted operations from `outbox`.
6. On a network error or 5xx: keep the operations and retry with **exponential
   backoff + jitter** (1 s, 2 s, 4 s … up to ~5 min).
   On 4xx validation errors: move the operation to a `dead_letter` table and
   show the user a notice.

### 4.4 Pull (receive changes from other devices)

1. `GET /sync/pull?since=<lastServerSeq>`
2. The server returns the changes with `server_seq > since` (paged).
3. The client applies them in a transaction, **skipping fields that still
   have pending local operations** in the outbox. This keeps local edits from
   being overwritten.
4. Save the new `lastServerSeq` in the `meta` table.

Order: **push first, then pull**.

### 4.5 Conflict resolution

| Situation | Rule |
|-----------|------|
| Two devices edit **different fields** of the same task | Both changes are kept (merge per field) |
| Two devices edit the **same field** | **Last-Write-Wins** by HLC timestamp (ties broken by `clientId`) |
| One device edits, another deletes | Delete wins (soft delete with a `deletedAt` tombstone); optional "restore" in the UI |
| Ordering tasks in a list | Fractional indexing (`fractional-indexing` package) so reordering never conflicts |

Hybrid Logical Clocks avoid trusting device clocks that are wrong.

> **Upgrade path:** if you later need collaborative editing of long text (e.g.
> task notes edited by several people at once), store that field as a CRDT with
> **Yjs** or **Automerge**. For plain to-do fields, per-field LWW is enough and
> much simpler.

### 4.6 Data model

**Client (Dexie):**

```ts
db.version(1).stores({
  todos:  'id, listId, updatedAt, deletedAt, [listId+order]',
  lists:  'id, updatedAt, deletedAt',
  outbox: 'opId, createdAt, entityId',
  meta:   'key',            // lastServerSeq, clientId, schemaVersion
});
```

**Server (Postgres):**

- `todos (id uuid pk, user_id, list_id, title, notes, done, order_key, due_at, field_hlc jsonb, deleted_at, updated_at)`
- `lists (id uuid pk, user_id, name, ...)`
- `change_log (server_seq bigserial pk, user_id, entity, entity_id, patch jsonb, hlc)`
- `processed_ops (op_id uuid pk, user_id, processed_at)` – removed after ~30 days

---

## 5. PWA / Service Worker details

- `vite-plugin-pwa` with `registerType: 'prompt'` – shows "New version
  available, reload?" instead of switching versions silently.
- **Precache** the app shell (HTML, JS, CSS, fonts, icons).
- **Runtime caching:** `StaleWhileRevalidate` for static assets.
  API calls are **not** cached by the Service Worker – data comes from IndexedDB.
- Call `navigator.storage.persist()` so the browser does not clear user data
  when disk space is low (important on Safari and iOS).
- Web App Manifest with icons and `display: "standalone"`, so the app can be
  installed.
- The UI shows the sync state: *Offline*, *Syncing…*, *All changes saved*, or
  *N changes pending*.

---

## 6. Security

- HTTPS everywhere (Service Workers require it).
- Short-lived access token + refresh token in an `HttpOnly`, `Secure`,
  `SameSite` cookie. While offline the app keeps working with local data. If the
  token has expired when the connection returns, refresh it first, then sync.
- The server checks every operation: user ownership, Zod schema, field
  whitelist. **Never trust client data.**
- Rate limiting on `/sync/*`.
- When a user logs out, clear IndexedDB (warn first if the outbox still has
  pending changes).

---

## 7. Project structure

Current conventions: a monorepo, **lowercase kebab-case** folder names,
feature-based folders inside each app, and shared code in `packages/`.

```
todoness/
├── .github/
│   └── workflows/
│       └── ci.yml
├── apps/
│   ├── web/                      # React PWA
│   │   ├── public/               # icons, manifest assets
│   │   └── src/
│   │       ├── app/              # router, providers, root layout
│   │       ├── features/
│   │       │   ├── todos/        # components, hooks, todo-repository.ts
│   │       │   ├── lists/
│   │       │   └── auth/
│   │       ├── db/               # dexie schema, migrations
│   │       ├── sync/             # sync-engine.ts, outbox.ts, hlc.ts
│   │       ├── components/ui/    # shadcn/ui components
│   │       ├── lib/
│   │       └── sw.ts             # service worker (injectManifest)
│   └── api/                      # Hono server
│       └── src/
│           ├── routes/           # sync.ts, auth.ts, health.ts
│           ├── db/               # drizzle schema + migrations
│           ├── services/         # conflict-resolver.ts
│           └── index.ts
├── packages/
│   ├── shared/                   # Zod schemas, types, HLC, sync protocol
│   ├── eslint-config/
│   └── tsconfig/
├── docs/
│   └── TechStack.md
├── e2e/                          # Playwright offline/online tests
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

---

## 8. Testing strategy

| Level | Tool | Must cover |
|-------|------|------------|
| Unit | Vitest | HLC ordering, per-field merge, outbox ordering, backoff |
| Integration | Vitest + fake-indexeddb + test Postgres (Testcontainers) | Push/pull round trip, idempotent retry, conflict cases |
| E2E | Playwright | 1) Go offline → add/edit/delete tasks → reload → data still there. 2) Go online → changes reach the server. 3) Two browser contexts edit the same task → both converge to the same result |
| Manual | Chrome DevTools → Network "Offline", Application → Service Workers / IndexedDB | Install the PWA, test on iOS Safari |

---

## 9. Alternatives considered

| Option | When to choose it | Why not by default |
|--------|-------------------|--------------------|
| **RxDB** | You want sync replication built in, on top of IndexedDB | Some features need a paid license; heavier |
| **PowerSync / ElectricSQL** | Large Postgres app, you want managed Postgres ↔ SQLite sync | Extra infrastructure; more than a to-do app needs |
| **Replicache / Zero (Rocicorp)** | Real-time multiplayer with server-authoritative mutations | Different model to learn; check current licensing |
| **Firebase Firestore / Supabase** | Fastest MVP with a hosted backend | Vendor lock-in; Firestore's offline cache is less controllable |
| **Yjs / Automerge (full CRDT)** | Rich collaborative text editing | More complex than per-field LWW for simple fields |
| **SQLite WASM + OPFS** | Complex relational queries on the client | Larger bundle; IndexedDB/Dexie is enough here |
| **Vue 3 / Svelte 5 / SolidJS** | The team prefers them | Equally valid. The sync design above does not depend on the framework |

---

## 10. Implementation roadmap

1. **Setup:** monorepo, Vite + React + TS, Hono API, Postgres + Drizzle, CI.
2. **Local-only MVP:** Dexie schema, CRUD for todos and lists, PWA app shell – fully usable offline.
3. **Outbox:** write operations to the outbox in the same transaction as each local write.
4. **Sync v1:** `/sync/push` (idempotent) + `/sync/pull` (cursor), triggers, backoff, Web Locks.
5. **Conflicts:** HLC, per-field LWW, tombstones, fractional ordering.
6. **Auth:** accounts, token refresh before sync, multi-device.
7. **Polish:** sync status indicator, update prompt, Background Sync, `storage.persist()`.
8. **Hardening:** E2E offline tests, Sentry, rate limiting, cleanup jobs for `processed_ops` and tombstones.
