# ToDoness

Simple to-do list app for internal use that keeps working offline.
Design documents are in [`docs/`](docs/).

## Development

Requires Node.js 22 and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev        # client on http://localhost:5173, API on http://localhost:3000
pnpm test       # unit tests
pnpm typecheck
pnpm lint
pnpm build
```

| Package   | Contents                                                           |
| --------- | ------------------------------------------------------------------ |
| `client/` | React web app (Vite)                                               |
| `server/` | API server (Hono on Node.js)                                       |
| `shared/` | Code used by both: IDs, Hybrid Logical Clock, schemas, merge rules |
