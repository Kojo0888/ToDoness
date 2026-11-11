# ToDoness UI refresh – Product Requirements Document (PRD)

| | |
|---|---|
| **Status** | v1.0 – built (see [ImplementationPlan.md](./ImplementationPlan.md)) |
| **Builds on** | v1 ([`../v1/PRD.md`](../v1/PRD.md)), Notes ([`../notes/PRD.md`](../notes/PRD.md)) |
| **Rules** | [`../../UI_GUIDELINES.md`](../../UI_GUIDELINES.md) |

> Everything in the earlier PRDs still applies unless this document says otherwise.
> Requirement numbers continue at FR-112.

## 1. Summary

1. A task can have **several reminders** (1 week, 1 day and/or 1 hour before), chosen with
   toggle chips instead of a dropdown. This replaces v1 decision D2 ("one choice per task").
2. The **Manage lists** entry in the sidebar becomes a modern button.
3. The **Manage lists** screen loses its instruction paragraph and gets a modern back button.
4. A repository-wide rule ([`UI_GUIDELINES.md`](../../UI_GUIDELINES.md)) makes the modern
   look the default for every control.

## 2. Goals and non-goals

**Goals:** several reminders per task, everywhere reminders work today (in-app, system
notification, web push, ntfy); a consistent, touch-friendly look for navigation actions.

**Non-goals:** new reminder offsets or custom offsets (stay 1 week / 1 day / 1 hour);
redesigning other screens in this update (they follow the guidelines when next touched).

## 3. Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-112 | "Remind me" offers **1 week before, 1 day before, 1 hour before** as independent toggle chips; any combination (including none) can be selected. Replaces FR-42's single choice. | Must |
| FR-113 | Each selected reminder fires on its own, once per device / once by the server per task + due date + choice (FR-45, FR-61 unchanged per choice). | Must |
| FR-114 | **[Decision]** When several selected reminders are already due at the same moment (e.g. the due date was set to tomorrow with "1 week" and "1 day" selected), only the **latest** one fires, so the user does not get a burst of notifications. | Must |
| FR-115 | Existing data keeps working: a task with a single v1 reminder shows that one chip selected after the update; older app versions that still send a single value are accepted. | Must |
| FR-116 | The sidebar's **Manage lists** is a full-width button (icon + label) and shows when it is the current page. | Must |
| FR-117 | The Manage lists screen shows **no instruction paragraph**; the drag instructions stay available to screen readers. The **back** control is a pill button with an arrow. | Must |
| FR-118 | `UI_GUIDELINES.md` and `IMPLEMENTATION_WORKFLOW.md` exist at the repository root and are linked from `AGENTS.md` / `CLAUDE.md`. | Must |

## 4. Decisions

- **Field kept, type widened.** The synced field stays `remindBefore` but is now a list
  (`[]` = no reminder). Keeping the name keeps per-field merge history (`fieldHlc`) intact;
  `null` and a single string are read as `[]` / `[value]`.
- **Burst protection (FR-114)** is applied the same way by the app and the server.
