# Instructions for AI agents and contributors

Read these before changing anything:

1. [`IMPLEMENTATION_WORKFLOW.md`](./IMPLEMENTATION_WORKFLOW.md) – the required order of work
   (minor: tests → implementation; major: PRD → implementation steps → tests → implementation).
2. [`UI_GUIDELINES.md`](./UI_GUIDELINES.md) – every control uses the modern look unless
   explicitly specified otherwise.

Product and design documents live in [`docs/`](./docs) (one folder per feature or release).

Checks: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`; e2e: `pnpm e2e`.
