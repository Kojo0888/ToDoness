import { Link } from 'wouter';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  brokenLinks,
  daysBetween,
  earliestStart,
  endDay,
  liveLinks,
  localDay,
  schedulePlan,
  type Activity,
} from '@todoness/shared';
import { formatDay, formatMonth, weekdayOf } from '../../lib/dates';
import { createDoubleTap } from '../../lib/doubleTap';
import type { NameMode } from '../../lib/planNames';
import {
  ROW_HEIGHT,
  arrowPath,
  arrowTip,
  blockBox,
  dayWidth,
  dragResult,
  headerUnits,
  hiddenMark,
  hiddenPredecessors,
  isOverdue,
  nudge,
  timelineRange,
  unitSpans,
  weekShift,
  type DragKind,
  type Scale,
  type Span,
  type Unit,
} from '../../lib/timeline';
import { activityPath } from './ActivityPage';
import { repo } from '../../app/container';
import { t } from '../../app/strings';

interface Props {
  activities: Activity[];
  nameMode: NameMode;
  scale: Scale;
  /** Done activities get no row, block or arrows (FR-162). */
  hideDone: boolean;
  planId: string;
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

/** Narrower than this, a block shows no grip marks and its name goes after it. */
const NARROW_BLOCK = 48;

const sameSpan = (a: Span, b: Span) => a.start === b.start && a.days === b.days;

/**
 * The timeline of a plan (docs/plan/PRD.md FR-125 – FR-139): a day grid, one row and one
 * block per activity, arrows for dependencies. Blocks are dragged with pointer events
 * (mouse and touch alike); the geometry is in lib/timeline.ts.
 *
 * An end of a block does two things, by where it is dragged: along its own row it changes
 * the activity (start or duration), onto the block of another row it links the two.
 */
export function Timeline({
  activities,
  nameMode,
  scale,
  hideDone,
  planId,
  selectedId,
  onSelect,
  onDelete,
  change,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** A drag just ended on this element: the click that follows it is not a click. */
  const suppressClick = useRef(false);
  /** Escape was pressed while the pointer was down: releasing it must not count as a click. */
  const cancelled = useRef(false);
  const pointerDown = useRef(false);
  /** A second click on the same block soon after the first: done / not done (FR-154). */
  const [doubleTap] = useState(() => createDoubleTap());
  const w = dayWidth(scale);

  // The saved activity changed after a drop: the preview has done its job.
  const dragged = drag ? activities.find((a) => a.id === drag.id) : undefined;
  if (drag?.settling && (!dragged || !sameSpan(dragged, drag.origin))) setDrag(null);

  // The links do not depend on the days, so they are worked out once per saved state and
  // not on every pointer move of a drag.
  const links = useMemo(() => liveLinks(activities), [activities]);

  // What is drawn: the dragged block where it would land, and what it would push (FR-136).
  let shown = activities;
  if (drag && !drag.linkTo) {
    shown = activities.map((a) => (a.id === drag.id ? { ...a, ...drag.preview } : a));
    const pushed = schedulePlan(shown, links);
    if (pushed.size > 0) {
      shown = shown.map((a) => (pushed.has(a.id) ? { ...a, start: pushed.get(a.id)! } : a));
    }
  }

  // Hidden done activities (FR-162) are still part of the schedule above (a drag still
  // pushes them), they are only not drawn.
  if (hideDone) shown = shown.filter((a) => !a.done);

  // Read once: the grid must not shift at midnight in the middle of a drag.
  const [today] = useState(() => localDay(Date.now()));
  // The grid follows the saved days, not the preview: it must not move under the pointer.
  const range = timelineRange(
    hideDone ? activities.filter((a) => !a.done) : activities,
    today,
    scale,
  );
  const gridWidth = range.days * w;
  const rowsHeight = (shown.length + 1) * ROW_HEIGHT;

  // When days are added on the left or the scale changes, keep the day at the left edge
  // of the view where it is.
  const previous = useRef({ first: range.first, w });
  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = { first: range.first, w };
    const el = scroller.current;
    if (!el || (was.first === range.first && was.w === w)) return;
    const leftDay = daysBetween(range.first, was.first) + el.scrollLeft / was.w;
    el.scrollLeft = Math.max(0, leftDay * w);
  }, [range.first, w]);

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
    doubleTap.reset();
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
      earliest: kind === 'move' ? earliestStart(activities, a.id, links) : null,
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
    const delta = Math.round((e.clientX - drag.startX) / w);
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

  /** The drag ended without a release: forget it (a drop being saved stays). */
  function abandonDrag() {
    released();
    setDrag((d) => (d?.settling ? d : null));
  }

  const dragHandlers = (a: Activity, grip: Drag['grip']) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => startDrag(e, a, grip),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: abandonDrag,
    // The capture can end without a pointerup or pointercancel (the window lost focus, the
    // element was detached). Without this the preview would stay and block every new drag.
    // After a normal release this comes last and finds nothing to do.
    onLostPointerCapture: abandonDrag,
  });

  function choose(id: string) {
    if (suppressClick.current) return;
    onSelect(id);
  }

  /** A click on a block selects it; a second one right after toggles done (FR-154). */
  function clickBlock(id: string, at: number) {
    if (suppressClick.current) return;
    onSelect(id);
    if (doubleTap(id, at)) {
      void change(() => repo.updateActivity(id, (now) => ({ done: !now.done })));
    }
  }

  function onBlockKey(e: React.KeyboardEvent, a: Activity) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      const resize = e.shiftKey;
      // From the stored activity, not the one on screen: with key repeat the next press
      // comes before the screen has caught up, and must still add up.
      void change(() => repo.updateActivity(a.id, (now) => nudge(now, step, resize)));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete(a.id);
    }
  }

  const removeLink = (from: string, to: string) =>
    void change(() => repo.unlinkActivities(from, to));

  // ---- what to draw --------------------------------------------------------

  const rowOf = new Map(shown.map((a, i) => [a.id, i]));
  const boxOf = new Map(shown.map((a) => [a.id, blockBox(a, range, scale)]));
  const broken = new Set(brokenLinks(shown, links).map((l) => `${l.from}>${l.to}`));
  // An arrow to or from a hidden activity would point at nothing (decision P19).
  const arrows = links
    .filter((l) => rowOf.has(l.from) && rowOf.has(l.to))
    .map((l) => {
      const from = boxOf.get(l.from)!;
      const to = boxOf.get(l.to)!;
      const source = { x: from.left + from.width, row: rowOf.get(l.from)! };
      const target = { x: to.left, row: rowOf.get(l.to)! };
      const tip = arrowTip(source, target);
      return {
        ...l,
        key: `${l.from}>${l.to}`,
        d: arrowPath(source, target),
        // A small triangle on the corner of the target block, pointing along the line.
        head: `M ${tip.x} ${tip.y} l -9 -5 v 10 z`,
        turn: `rotate(${tip.angle} ${tip.x} ${tip.y})`,
      };
    });

  // A shown activity that waits for a hidden one: a dotted mark before its block (FR-173).
  const marks = hideDone
    ? [...hiddenPredecessors(links, new Set(rowOf.keys()))].map((id) => ({
        id,
        ...hiddenMark(boxOf.get(id)!, rowOf.get(id)!),
      }))
    : [];

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
        data-scale={scale}
        // The width of a day on this scale, for the grid lines and today's line (FR-157).
        style={{ '--plan-day': `${w}px` } as CSSProperties}
        ref={scroller}
        role="group"
        aria-label={t.plan.timeline}
      >
        <div className="plan-canvas">
          {/* The row's details button, and in the Column mode its name (FR-149, FR-140). */}
          <div className={`plan-side${nameMode === 'column' ? ' plan-name-col' : ''}`}>
            <div className="plan-name-head">
              {nameMode === 'column' ? t.plan.activityColumn : ''}
            </div>
            {shown.map((a) => (
              <div key={a.id} className={`plan-side-row${a.done ? ' is-done' : ''}`}>
                <Link
                  href={activityPath(planId, a.id)}
                  className="icon-btn plan-details-btn"
                  aria-label={t.plan.details(a.name)}
                  title={t.plan.details(a.name)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M5 7h14M5 12h14M5 17h9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </Link>
                {nameMode === 'column' && (
                  <button
                    type="button"
                    className={`plan-name${a.id === selectedId ? ' is-selected' : ''}`}
                    data-activity-id={a.id}
                    title={a.name}
                    onClick={() => choose(a.id)}
                  >
                    {a.done && <span aria-hidden="true">✓ </span>}
                    {a.name}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="plan-grid" style={{ width: gridWidth }}>
            <TimelineHeader first={range.first} days={range.days} today={today} scale={scale} />

            <div
              className="plan-rows"
              ref={rowsRef}
              // Weekends are one repeating background, shifted to the grid's first day.
              style={
                {
                  height: rowsHeight,
                  '--plan-week-shift': `${-weekShift(range.first) * w}px`,
                } as CSSProperties
              }
              onClick={(e) => {
                // A click on the empty grid lets go of what was selected.
                if (e.target !== e.currentTarget || suppressClick.current) return;
                onSelect(null);
              }}
            >
              {scale !== 'day' && <UnitLines first={range.first} days={range.days} scale={scale} />}
              <div className="plan-today" style={{ left: todayIndex * w }} />

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
                    <path className="plan-arrow-head" d={arrow.head} transform={arrow.turn} />
                  </g>
                ))}
                {marks.map((m) => (
                  <line
                    key={m.id}
                    className="plan-hidden-pred"
                    data-activity-id={m.id}
                    x1={m.x1}
                    x2={m.x2}
                    y1={m.y}
                    y2={m.y}
                  />
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
                // Too narrow for its name (coarse scales): the name goes after the block.
                const narrow = box.width < NARROW_BLOCK;
                const nameOn = nameMode === 'on' && !narrow;
                const nameAfter = nameMode === 'after' || (nameMode === 'on' && narrow);
                const end = endDay(a.start, a.days);
                // Ended before today and not done: red (FR-161).
                const overdue = isOverdue(a, a.done, today);
                const style: CSSProperties = {
                  left: box.left,
                  width: box.width,
                  top: row * ROW_HEIGHT,
                };
                const classes = [
                  'plan-bar',
                  narrow && 'is-narrow',
                  a.id === selectedId && 'is-selected',
                  a.id === drag?.id && 'is-dragged',
                  a.id === drag?.linkTo && 'is-link-target',
                  a.done && 'is-done',
                  overdue && 'is-overdue',
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
                      aria-label={t.plan.block(
                        a.name,
                        formatDay(a.start),
                        formatDay(end),
                        a.done ? 'done' : overdue ? 'overdue' : 'open',
                      )}
                      aria-pressed={a.id === selectedId}
                      aria-describedby="plan-block-help"
                      title={`${a.name}: ${formatDay(a.start)} – ${formatDay(end)}`}
                      onClick={(e) => clickBlock(a.id, e.timeStamp)}
                      onKeyDown={(e) => onBlockKey(e, a)}
                      {...dragHandlers(a, null)}
                    >
                      {nameOn && (
                        <span className="plan-block-name">
                          {a.done && <span aria-hidden="true">✓ </span>}
                          {a.name}
                        </span>
                      )}
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
                    {nameAfter && (
                      <span className="plan-after-name">
                        {a.done && <span aria-hidden="true">✓ </span>}
                        {a.name}
                      </span>
                    )}
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

const quarterOf = (day: string) => `Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;

/** The text of a header cell: a group above (top) or a column (bottom). */
function unitLabel(start: string, unit: Unit, top: boolean): string {
  switch (unit) {
    case 'day':
      return String(Number(start.slice(8)));
    case 'week':
      return String(Number(start.slice(8))); // the day of its Monday
    case 'month':
      return top
        ? formatMonth(start.slice(0, 7))
        : new Date(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1).toLocaleDateString(
            undefined,
            { month: 'short' },
          );
    case 'quarter':
      return quarterOf(start);
    case 'year':
      return start.slice(0, 4);
  }
}

/**
 * The two header rows: groups (months or years) and columns (days, weeks, months or
 * quarters, FR-157). Its own memoised component: it only depends on the range, so the
 * (possibly thousands of) cells are not rendered again while a block is dragged.
 */
const TimelineHeader = memo(function TimelineHeader({
  first,
  days,
  today,
  scale,
}: {
  first: string;
  days: number;
  today: string;
  scale: Scale;
}) {
  const w = dayWidth(scale);
  const [top, bottom] = headerUnits(scale);
  const range = { first, days };
  const todayIndex = daysBetween(first, today);
  return (
    <>
      <div className="plan-months" aria-hidden="true">
        {unitSpans(range, top).map((m) => (
          <div
            key={m.start}
            className="plan-month"
            style={{ left: m.index * w, width: m.days * w }}
          >
            <span>{unitLabel(m.start, top, true)}</span>
          </div>
        ))}
      </div>
      <div className="plan-days" aria-hidden="true">
        {unitSpans(range, bottom).map((u) => {
          const isToday = bottom === 'day' && u.start === today;
          const hasToday =
            bottom !== 'day' && todayIndex >= u.index && todayIndex < u.index + u.days;
          const classes = [
            'plan-day',
            'plan-head-unit',
            bottom === 'day' && isWeekend(u.start) && 'is-weekend',
            isToday && 'is-today',
            hasToday && 'has-today',
          ];
          return (
            <div
              key={u.start}
              className={classes.filter(Boolean).join(' ')}
              style={{ left: u.index * w, width: u.days * w }}
              title={isToday ? t.plan.today : undefined}
            >
              {unitLabel(u.start, bottom, false)}
            </div>
          );
        })}
      </div>
    </>
  );
});

/** A line at the start of every column on the coarse scales (the Days grid is a background). */
const UnitLines = memo(function UnitLines({
  first,
  days,
  scale,
}: {
  first: string;
  days: number;
  scale: Scale;
}) {
  const w = dayWidth(scale);
  return (
    <>
      {unitSpans({ first, days }, headerUnits(scale)[1])
        .slice(1)
        .map((u) => (
          <div key={u.start} className="plan-unit-line" style={{ left: u.index * w }} />
        ))}
    </>
  );
});
