# Implementation workflow (required order of work)

Every change starts by deciding whether it is **minor** or **major**, then produces the
files below **in this order**. Do not write implementation code before the earlier steps
exist and are committed (or at least written in the same change).

## Minor change

A bug fix, a copy change, a small UI tweak, or a change that touches one module and does
**not** change the data model, the sync protocol, the API or a migration.

1. **Tests first.** Add or change the unit / e2e tests that describe the new behaviour.
   Run them and see them fail for the right reason.
2. **Implementation.** Make the smallest change that makes the tests pass.
3. Run the checks: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`
   (and the affected e2e test when the UI changed).

## Major change

A new feature, anything that changes the **data model, sync, API, database migrations,
permissions**, or touches several modules.

1. **PRD** – `docs/<feature>/PRD.md`: problem, goals / non-goals, numbered requirements
   (continue the FR numbering), decisions taken where the request left room.
2. **Implementation steps** – `docs/<feature>/ImplementationPlan.md`: the files and
   modules to change, migration and compatibility notes, the order of steps.
3. **Tests** – unit tests (shared / server / client) and e2e tests for every requirement,
   written before the code. They are expected to fail at this point.
4. **Implementation** – step by step following the plan, until all tests pass.
5. Update `docs/v1/Decisions.md` (or the feature's plan) with anything that changed on the way,
   and run all checks as for a minor change.

## Always

- UI work follows [`UI_GUIDELINES.md`](./UI_GUIDELINES.md).
- When unsure whether a change is minor or major, treat it as **major**.
