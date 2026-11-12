# Note details and a calmer note card – PRD

Follows [`../notes/PRD.md`](../notes/PRD.md) (notes FR-88 – FR-93, public notes FR-94 – FR-97,
reorder FR-100) and [`../../UI_GUIDELINES.md`](../../UI_GUIDELINES.md). Requirement numbers
continue from FR-194.

## 1. Problem

A note card in _My notes_ spends its top row on a drag handle, a Public switch and a Delete
button, and its bottom on the change date. The text starts below all of that and the card is
cramped. There is also no place for a long note or for anything besides its text.

## 2. Goals / non-goals

Goals: a card that is mostly text, with every control in one column on its right; a details
page for one note with a large text box, the Public switch and the last-modified time.

Non-goals: any new synced field, server or API change (`isPublic` and `updatedAt` already
exist); changing _Public notes_ of other users (they keep their layout, FR-94 – FR-97);
titles, tags or colours for notes.

## 3. Requirements

| ID     | Requirement                                                                                                                                                                                                                                                                        | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-195 | **Card layout.** In _My notes_ the text box starts at the top of the card. All controls are in one column on the **right**, top to bottom: the **drag handle** (FR-100), a **Details** button, and, at the bottom of the column, a red **trash can** that deletes the note.        | Must     |
| FR-196 | **Nothing else on the card.** The Public switch and the "Changed …" date are no longer on the card. A public note is still recognisable by its accent border.                                                                                                                     | Must     |
| FR-197 | **Delete from the card** works as before (with Undo, FR-93). The trash can is an icon button with the accessible name "Delete note N", at least 44 × 44 px on a phone.                                                                                                              | Must     |
| FR-198 | **Details button.** An icon button named "Open details of note N" opens the note's own page, `/notes/n/<id>`. It is at least 44 × 44 px on a phone.                                                                                                                                | Must     |
| FR-199 | **Details page.** A sub-page with a back button (to the list the note is in), a **large** text box that saves itself like the card's (FR-90), a **Public** switch with its "i" info tip (same meaning as FR-94), the **last modified** date and time, and a red **Delete** button. | Must     |
| FR-200 | **Delete on the details page** deletes the note, returns to its list and offers Undo. A note that does not exist (or was deleted on another device) sends the user back to the list. Edits made on another device appear in the open text box, as on the card.                      | Must     |

## 4. Decisions

| #   | Topic                           | Decision                                                                                                                                                                                         |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ND1 | Where does Public go?           | Only to the details page, as the request says. The accent border keeps public notes visible on the list.                                                                                         |
| ND2 | Is this a major change?         | It adds a screen and a route, so it follows the major order of work, but it has **no data, sync, API or migration change**.                                                                      |
| ND3 | Details as a link or a button   | A link to a page (`a.icon-btn`), because it navigates (UI_GUIDELINES "Navigation that looks like an action").                                                                                    |
