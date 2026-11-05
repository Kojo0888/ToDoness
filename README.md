# ToDoness

Simple to-do list app for internal use that keeps working offline. Changes made
without a connection are saved on the device and sent automatically when the
connection returns.

Design documents are in [`docs/`](docs/): requirements ([PRD](docs/PRD.md)),
[tech stack](docs/TechStack.md), [database model](docs/DBModel.md) and the
[build plan with implementation status](docs/MVPImplementationSteps.md).

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

`pnpm e2e` uses Playwright 1.63 with Chromium. If the browser is not installed:
`pnpm --filter @todoness/e2e exec playwright install chromium`.

| Package        | Contents                                                                   |
| -------------- | -------------------------------------------------------------------------- |
| `client/`      | React web app (Vite, installable PWA), local database (Dexie), sync engine |
| `server/`      | API server (Hono on Node.js, SQLite) that also serves the web app          |
| `shared/`      | Code used by both: IDs, Hybrid Logical Clock, schemas, merge rules         |
| `integration/` | Tests with simulated browsers against the real server                      |
| `e2e/`         | Browser tests against the built app                                        |

## Deployment

One container behind Caddy on the intranet. See
[`docs/TechStack.md`](docs/TechStack.md#13-deployment-example-docker-compose--caddy)
section 13 (HTTPS is required for offline mode to work).

```sh
# set the server name in Caddyfile, then:
docker compose up -d --build
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt  # install on devices
```

Update: `git pull && docker compose up -d --build`. Back up the `todoness-data`
volume (the optional `backup` service copies the database daily to `./backups`).
Note: the Docker setup has not been run end to end yet (see the status section
of the build plan).
