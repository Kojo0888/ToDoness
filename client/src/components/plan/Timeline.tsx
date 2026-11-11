import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  brokenLinks,
  daysBetween,
  earliestStart,
  endDay,
  addDays,
  liveLinks,
  localDay,
  schedulePlan,
  type Activity,
} from '@todoness/shared';
import { formatDay, formatMonth, weekdayOf } from '../../lib/dates';
import type { NameMode } from '../../lib/planNames';
import {
  DAY_WIDTH,
  ROW_HEIGHT,
  arrowPath,
  arrowTip,
  blockBox,
  dragResult,
  monthSpans,
  timelineRange,
  type DragKind,
  type Span,
} from '../../lib/timeline';
import { repo } from '../../app/container';
import { t } from '../../app/strings';

interface Props {
  activities: Activity[];
  nameMode: NameMode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  /**
   * Runs a change of dates or links so that it can be undone (PlanPage). Resolves to the
   * result, or to `undefined` when it was refused (the page then shows why).
   */
  change: <T>(run: () => Promise<T>) => Promise<T | undefined>;
}

/** A block being dragged: what it was, and what it would become if released now. */
interface Drag {
  id: string;
  kind: DragKind;
  /** Grabbed by one of its ends (not the block itself): it can also be dropped on a block. */
  grip: 'start' | 'end' | null;
  startX: number;
  origin: Span;
  /** The first day the predecessors allow (moves only). */
  earliest: string | null;
  preview: Span;
  moved: boolean;
  /** The activity whose block the end is over: releasing links the two (FR-133). */
  linkTo: string | null;
  /** Where the pointer is on the rows, for the line to it while linking. */
  pointer: { x: number; y: number } | null;
  /** Released: the preview stays until the saved activity shows up, so nothing jumps back. */
  settling: boolean;
}

const sameSpan = (a: Span, b: Span) => a.start === b.start && a.days === b.days;

/**
 * The timeline of a plan (docs/plan/PRD.md FR-125 – FR-139): a day grid, one row and one
 * block per activity, arrows for dependencies. Blocks are dragged with pointer events
 * (mouse and touch alike); the geometry is in lib/timeline.ts.
 *
 * An end of a block does two things, by where it is dragged: along its own row it changes
 * the activity (start or duration), onto the block of another row it links the two.
 */
export function Timeline({ activities, nameMode, selectedId, onSelect, onDelete, change }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** A drag just ended on this element: the click that follows it is not a click. */
  const suppressClick = useRef(false);
  /** Escape was pressed while the pointer was down: releasing it must not count as a click. */
  const cancelled = useRef(false);
  const pointerDown = useRef(false);

  // The saved activity changed after a drop: the preview has done its job.
  const dragged = drag ? activities.find((a) => a.id === drag.id) : undefined;
  if (drag?.settling && (!dragged || !sameSpan(dragged, drag.origin))) setDrag(null);

  // What is drawn: the dragged block where it would land, and what it would push (FR-136).
  let shown = activities;
  if (drag && !drag.linkTo) {
    shown = activities.map((a) => (a.id === drag.id ? { ...a, ...drag.preview } : a));
    const pushed = schedulePlan(shown);
    if (pushed.size > 0) {
      shown = shown.map((a) => (pushed.has(a.id) ? { ...a, start: pushed.get(a.id)! } : a));
    }
  }

  // Read once: the grid must not shift at midnight in the middle of a drag.
  const [today] = useState(() => localDay(Date.now()));
  // The grid follows the saved days, not the preview: it must not move under the pointer.
  const range = timelineRange(activities, today);
  const gridWidth = range.days * DAY_WIDTH;
  const rowsHeight = (shown.length + 1) * ROW_HEIGHT;

  // When days are added on the left, keep what the user looks at where it is.
  const previousFirst = useRef(range.first);
  useLayoutEffect(() => {
    const added = daysBetween(range.first, previousFirst.current);
    previousFirst.current = range.first;
    if (added !== 0 && scroller.current) scroller.current.scrollLeft += added * DAY_WIDTH;
  }, [range.first]);

  // Escape cancels a drag (FR-129).
  const busy = drag !== null;
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pointerDown.current) cancelled.current = true;
      setDrag((d) => (d?.settling ? d : null));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const nameOf = (id: string) => activities.find((a) => a.id === id)?.name ?? '';

  /** The click that follows a drag on the same element is swallowed. */
  function afterDrag() {
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
  }

  /** The pointer was released; true when Escape had cancelled what it was doing. */
  function released(): boolean {
    pointerDown.current = false;
    if (!cancelled.current) return false;
    cancelled.current = false;
    afterDrag();
    return true;
  }

  // ---- dragging a block or one of its ends (FR-127 – FR-129, FR-133) --------

  function startDrag(e: React.PointerEvent<HTMLElement>, a: Activity, grip: Drag['grip']) {
    if (e.button !== 0 || drag) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerDown.current = true;
    cancelled.current = false;
    const kind: DragKind = grip === 'end' ? 'resize' : 'move';
    const origin = { start: a.start, days: a.days };
    setDrag({
      id: a.id,
      kind,
      grip,
      startX: e.clientX,
      origin,
      earliest: kind === 'move' ? earliestStart(activities, a.id) : null,
      preview: origin,
      moved: false,
      linkTo: null,
      pointer: null,
      settling: false,
    });
  }

  /** The other activity whose block is under the pointer, if any. */
  function blockUnder(e: React.PointerEvent, ownId: string): string | null {
    const id = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest('.plan-bar')
      ?.getAttribute('data-activity-id');
    return id && id !== ownId ? id : null;
  }

  function moveDrag(e: React.PointerEvent) {
    if (!drag || drag.settling) return;
    // An end over the block of another row: a link, and the block itself stays as it is.
    const linkTo = drag.grip ? blockUnder(e, drag.id) : null;
    if (linkTo && rowsRef.current) {
      const box = rowsRef.current.getBoundingClientRect();
      const pointer = { x: e.clientX - box.left, y: e.clientY - box.top };
      return setDrag({ ...drag, linkTo, pointer, preview: drag.origin, moved: true });
    }
    const delta = Math.round((e.clientX - drag.startX) / DAY_WIDTH);
    const preview = dragResult(drag.kind, drag.origin, delta, drag.earliest);
    if (drag.linkTo || !sameSpan(preview, drag.preview)) {
      setDrag({ ...drag, linkTo: null, pointer: null, preview, moved: true });
    }
  }

  function endDrag() {
    if (released() || !drag || drag.settling) return;
    if (drag.moved) afterDrag();
    const { id, kind, grip, preview, origin, linkTo } = drag;
    if (linkTo) {
      setDrag(null);
      // The end of this one on that one: this → that. Its beginning: that → this.
      const [from, to] = grip === 'end' ? [id, linkTo] : [linkTo, id];
      return void change(() => repo.linkActivities(from, to));
    }
    if (sameSpan(preview, origin)) return setDrag(null);
    setDrag({ ...drag, settling: true });
    void change(() =>
      repo.updateActivity(id, kind === 'move' ? { start: preview.start } : { days: preview.days }),
    ).then((saved) =>
      // Refused, or saved somewhere else than shown: show what is stored.
      setDrag((d) =>
        d?.id !== id || !d.settling
          ? d
          : !saved || sameSpan(saved, origin)
            ? null
            : { ...d, preview: saved },
      ),
    );
  }

  const dragHandlers = (a: Activity, grip: Drag['grip']) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => startDrag(e, a, grip),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: () => {
      released();
      setDrag((d) => (d?.settling ? d : null));
    },
  });

  function choose(id: string) {
    if (suppressClick.current) return;
    onSelect(selectedId === id ? null : id);
  }

  function onBlockKey(e: React.KeyboardEvent, a: Activity) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      const patch = e.shiftKey
        ? { days: Math.max(1, a.days + step) }
        : { start: addDays(a.start, step) };
      void change(() => repo.updateActivity(a.id, patch));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete(a.id);
    }
  }

  const removeLink = (from: string, to: string) =>
    void change(() => repo.unlinkActivities(from, to));

  // ---- what to draw --------------------------------------------------------

  const rowOf = new Map(shown.map((a, i) => [a.id, i]));
  const boxOf = new Map(shown.map((a) => [a.id, blockBox(a, range)]));
  const broken = new Set(brokenLinks(shown).map((l) => `${l.from}>${l.to}`));
  const arrows = liveLinks(shown).map((l) => {
    const from = boxOf.get(l.from)!;
    const to = boxOf.get(l.to)!;
    const source = { x: from.left + from.width, row: rowOf.get(l.from)! };
    const target = { x: to.left, row: rowOf.get(l.to)! };
    const tip = arrowTip(source, target);
    return {
      ...l,
      key: `${l.from}>${l.to}`,
      d: arrowPath(source, target),
      // A small triangle on the edge of the target block, pointing into it.
      head: `M ${tip.x} ${tip.y} l -5 ${tip.down ? -8 : 8} h 10 z`,
    };
  });

  const days = Array.from({ length: range.days }, (_, i) => addDays(range.first, i));
  const todayIndex = daysBetween(range.first, today);
  const dragBox = drag ? boxOf.get(drag.id) : undefined;

  return (
    <>
      <span id="plan-block-help" className="sr-only">
        {t.plan.blockHelp}
      </span>
      <div
        className={`plan-timeline${drag?.linkTo ? ' is-linking' : ''}${drag ? ' is-dragging' : ''}`}
        data-names={nameMode}
        ref={scroller}
        role="group"
        aria-label={t.plan.timeline}
      >
        <div className="plan-canvas">
          {nameMode === 'column' && (
            <div className="plan-name-col">
              <div className="plan-name-head">{t.plan.activityColumn}</div>
              {shown.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`plan-name${a.id === selectedId ? ' is-selected' : ''}`}
                  data-activity-id={a.id}
                  title={a.name}
                  onClick={() => choose(a.id)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}

          <div className="plan-grid" style={{ width: gridWidth }}>
            <div className="plan-months" aria-hidden="true">
              {monthSpans(range).map((m) => (
                <div
                  key={m.month}
                  className="plan-month"
                  style={{ left: m.index * DAY_WIDTH, width: m.days * DAY_WIDTH }}
                >
                  <span>{formatMonth(m.month)}</span>
                </div>
              ))}
            </div>
            <div className="plan-days" aria-hidden="true">
              {days.map((day, i) => (
                <div
                  key={day}
                  className={`plan-day${isWeekend(day) ? ' is-weekend' : ''}${i === todayIndex ? ' is-today' : ''}`}
                  title={i === todayIndex ? t.plan.today : undefined}
                >
                  {Number(day.slice(8))}
                </div>
              ))}
            </div>

            <div
              className="plan-rows"
              ref={rowsRef}
              style={{ height: rowsHeight }}
              onClick={(e) => {
                // A click on the empty grid lets go of what was selected.
                if (e.target !== e.currentTarget || suppressClick.current) return;
                onSelect(null);
              }}
            >
              {days.map(
                (day, i) =>
                  isWeekend(day) && (
                    <div key={day} className="plan-shade" style={{ left: i * DAY_WIDTH }} />
                  ),
              )}
              <div className="plan-today" style={{ left: todayIndex * DAY_WIDTH }} />

              <svg className="plan-arrows" width={gridWidth} height={rowsHeight}>
                {arrows.map((arrow) => (
                  <g
                    key={arrow.key}
                    className={`plan-arrow${broken.has(arrow.key) ? ' is-broken' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={t.plan.arrow(nameOf(arrow.from), nameOf(arrow.to))}
                    onClick={() => removeLink(arrow.from, arrow.to)}
                    onKeyDown={(e) => {
                      if (!['Enter', ' ', 'Delete', 'Backspace'].includes(e.key)) return;
                      e.preventDefault();
                      removeLink(arrow.from, arrow.to);
                    }}
                  >
                    <path className="plan-arrow-hit" d={arrow.d} />
                    <path className="plan-arrow-line" d={arrow.d} />
                    <path className="plan-arrow-head" d={arrow.head} />
                  </g>
                ))}
                {drag?.linkTo && drag.pointer && dragBox && (
                  <line
                    className="plan-rubber"
                    x1={dragBox.left + (drag.grip === 'end' ? dragBox.width : 0)}
                    y1={rowOf.get(drag.id)! * ROW_HEIGHT + ROW_HEIGHT / 2}
                    x2={drag.pointer.x}
                    y2={drag.pointer.y}
                  />
                )}
              </svg>

              {shown.map((a, row) => {
                const box = boxOf.get(a.id)!;
                const end = endDay(a.start, a.days);
                const style: CSSProperties = {
                  left: box.left,
                  width: box.width,
                  top: row * ROW_HEIGHT,
                };
                const classes = [
                  'plan-bar',
                  a.id === selectedId && 'is-selected',
                  a.id === drag?.id && 'is-dragged',
                  a.id === drag?.linkTo && 'is-link-target',
                ];
                return (
                  <div
                    key={a.id}
                    className={classes.filter(Boolean).join(' ')}
                    style={style}
                    data-activity-id={a.id}
                  >
                    <button
                      type="button"
                      className="plan-block"
                      data-start={a.start}
                      data-end={end}
                      aria-label={t.plan.block(a.name, formatDay(a.start), formatDay(end))}
                      aria-pressed={a.id === selectedId}
                      aria-describedby="plan-block-help"
                      title={`${a.name}: ${formatDay(a.start)} – ${formatDay(end)}`}
                      onClick={() => choose(a.id)}
                      onKeyDown={(e) => onBlockKey(e, a)}
                      {...dragHandlers(a, null)}
                    >
                      {nameMode === 'on' && <span className="plan-block-name">{a.name}</span>}
                    </button>
                    {/* The two ends: dragged along the row they move the activity or change
                        its duration, dropped on another block they link the two. Mouse and
                        touch only: the keyboard uses the block itself (arrow keys) and the
                        edit bar, so they are not tab stops. */}
                    <button
                      type="button"
                      tabIndex={-1}
                      className="plan-handle plan-handle-start"
                      aria-label={t.plan.moveHandle(a.name)}
                      {...dragHandlers(a, 'start')}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      className="plan-handle plan-handle-end"
                      aria-label={t.plan.endHandle(a.name)}
                      {...dragHandlers(a, 'end')}
                    />
                    {nameMode === 'after' && <span className="plan-after-name">{a.name}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {/* Below the chart, so that it cannot move the blocks while one is being linked. */}
      <p className="hint plan-linking" role="status">
        {drag?.linkTo
          ? drag.grip === 'end'
            ? t.plan.linking(nameOf(drag.id), nameOf(drag.linkTo))
            : t.plan.linking(nameOf(drag.linkTo), nameOf(drag.id))
          : ''}
      </p>
    </>
  );
}

const isWeekend = (day: string) => {
  const weekday = weekdayOf(day);
  return weekday === 0 || weekday === 6;
};
