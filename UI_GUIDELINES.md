# UI guidelines (required for every control)

> **Rule:** every control in the app uses the _modern_ look described here, **unless a
> PRD, a decision record or the task explicitly says otherwise** (then say so in a code
> comment next to the control). Plain browser-default links, underlined text buttons and
> bare dropdowns are not acceptable for actions.

Applies to: `client/src/**` (components and `styles.css`). AI tools and people changing UI
must read this file first. It is linked from [`AGENTS.md`](./AGENTS.md).

## 1. Principles

1. **Looks like what it does.** An action is a button, navigation is a button-like link,
   a choice is a chip/segmented control/switch. Never a bare text link for an action.
2. **Touch first.** Every tappable target is at least **44 × 44 px** on phones
   (`@media (max-width: 760px)`), with at least 8 px between targets.
3. **Native where the platform does it better.** Use the device's own pickers for date and
   time (`<input type="date">`, `<input type="time">`) so phones show their calendar/clock.
4. **Calm by default.** No explanatory paragraphs on screens whose controls are
   self-explanatory; put help in `aria-describedby`, a tooltip (`title`) or a screen-reader
   only text instead of visible prose.
5. **Accessible.** Real `<button>`/`<a>`/`<input>` elements, visible focus ring
   (`--focus`), state exposed with `aria-pressed` / `aria-checked` / `aria-current`,
   labels for every input, contrast ≥ 4.5:1 in light and dark themes.

## 2. Building blocks (use these classes, do not invent new one-offs)

| Need                                                       | Use                        | Class / element                                   |
| ---------------------------------------------------------- | -------------------------- | ------------------------------------------------- |
| Main action                                                | filled button              | `button.primary`                                  |
| Secondary action                                           | tonal button               | `button` (default) or `.btn` on a link            |
| Destructive action                                         | outlined red               | `button.danger`                                   |
| Navigation that looks like an action (e.g. "Manage lists") | button-like link with icon | `a.btn` (+ `.btn-block` full width)               |
| Back / close                                               | icon + label pill          | `a.btn.btn-back` / `button.btn-back`              |
| Pick one of a few, or several of a few                     | chips (toggle buttons)     | `.chip-group` + `button.chip` with `aria-pressed` |
| On/off                                                     | switch                     | `<input type="checkbox" role="switch">`           |
| Date / time                                                | native inputs              | `input[type=date]`, `input[type=time]`            |
| Long list of options (> 6)                                 | `<select>` styled as field | `select`                                          |

- Icons are inline SVG or a single Unicode glyph with `aria-hidden="true"`; the text label
  stays visible (icon-only buttons need an `aria-label`).
- Colours come only from the CSS variables in `:root` (`--accent`, `--surface`, …) so dark
  mode keeps working. Radius: 8 px controls, 999 px chips/pills, 12 px on phones.
- Selected chip: accent background + `--accent-fg` text; unselected: `--bg` with border.

## 3. Don'ts

- No `button.link` (underlined text) for primary navigation or actions. It is only for
  inline, in-sentence actions such as "Clear".
- No multi-select `<select multiple>`; use a chip group.
- No visible instructional paragraphs on management screens (see principle 4).
- No custom colours, fonts or shadows outside the variables.

## 4. Checklist before merging a UI change

- [ ] Uses the building blocks above (or documents the exception in a comment).
- [ ] 44 px targets on a phone viewport (check at 390 × 780).
- [ ] Works in light and dark theme.
- [ ] Keyboard: reachable with Tab, state announced (`aria-pressed`, `aria-current`).
- [ ] An e2e or component test covers the new control's behaviour.
