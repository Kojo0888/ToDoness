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
import { RepoError } from '../../data/repo';
import { formatDay, formatMonth, weekdayOf } from '../../lib/dates';
import type { NameMode } from '../../lib/planNames';
import {
  DAY_WIDTH,
  ROW_HEIGHT,
  arrowPath,
  blockBox,
  dragResult,
  monthSpans,
  timelineRange,
  type DragKind,
  type Span,
} from '../../lib/timeline';
import { repo } from '../../app/container';
import { t } from '../../app/strings';
import { useUndoToast } from '../common/Toast';

interface Props {
  activities: Activity[];
  nameMode: NameMode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  /** A short message for the user (a refused link), or `null` to take it away. */
  onMessage: (message: string | null) => void;
}

/** A block being dragged: what it was, and what it would become if released now. */
interface Drag {
  id: string;
  kind: DragKind;
  startX: number;
  origin: Span;
  /** The first day the predecessors allow (moves only). */
  earliest: string | null;
  preview: Span;
  moved: boolean;
  /** Released: the preview stays until the saved activity shows up, so nothing jumps back. */
  settling: boolean;
}

/** A link being made, from the end (`out`) or the start (`in`) of an activity. */
interface Linking {
  id: string;
  side: 'out' | 'in';
  /** Where the pointer is on the rows while dragging; `null` when armed by a click. */
  pointer: { x: number; y: number } | null;
}

const sameSpan = (a: Span, b: Span) => a.start === b.start && a.days === b.days;
/** A press only becomes a link drag after this many pixels, so a click stays a click. */
const LINK_DRAG_PX = 5;

/**
 * The timeline of a plan (docs/plan/PRD.md FR-125 – FR-139): a day grid, one row and one
 * block per activity, arrows for dependencies. Blocks are dragged with pointer events
 * (mouse and touch alike); the geometry is in lib/timeline.ts.
 */
export function Timeline({
  activities,
  nameMode,
  selectedId,
  onSelect,
  onDelete,
  onMessage,
}: Props) {
  const toast = useUndoToast();
  const scroller = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  /** The press that may become a link drag. */
  const linkPress = useRef<{ id: string; side: 'out' | 'in'; x: number; y: number } | null>(null);
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
  if (drag) {
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

  // Escape cancels a drag or a link in the making (FR-129).
  const busy = drag !== null || linking !== null;
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pointerDown.current) cancelled.current = true;
      linkPress.current = null;
      setDrag((d) => (d?.settling ? d : null));
      setLinking(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const nameOf = (id: string) => activities.find((a) => a.id === id)?.name ?? '';
  const failed = (err: unknown) =>
    onMessage(err instanceof RepoError && err.code === 'loop' ? t.plan.loop : t.plan.failed);

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

  // ---- dragging a block (FR-127 – FR-129) ----------------------------------

  function startDrag(e: React.PointerEvent<HTMLElement>, a: Activity, kind: DragKind) {
    if (e.button !== 0 || linking || drag) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerDown.current = true;
    cancelled.current = false;
    const origin = { start: a.start, days: a.days };
    setDrag({
      id: a.id,
      kind,
      startX: e.clientX,
      origin,
      earliest: kind === 'move' ? earliestStart(activities, a.id) : null,
      preview: origin,
      moved: false,
      settling: false,
    });
  }

  function moveDrag(e: React.PointerEvent) {
    if (!drag || drag.settling) return;
    const delta = Math.round((e.clientX - drag.startX) / DAY_WIDTH);
    const preview = dragResult(drag.kind, drag.origin, delta, drag.earliest);
    if (!sameSpan(preview, drag.preview)) setDrag({ ...drag, preview, moved: true });
  }

  function endDrag() {
    if (released() || !drag || drag.settling) return;
    if (drag.moved) afterDrag();
    if (sameSpan(drag.preview, drag.origin)) return setDrag(null);
    const { id, kind, preview, origin } = drag;
    setDrag({ ...drag, settling: true });
    onMessage(null);
    repo
      .updateActivity(id, kind === 'move' ? { start: preview.start } : { days: preview.days })
      .then(
        (saved) =>
          // Saved somewhere else than shown (or not at all): show that.
          setDrag((d) =>
            d?.id !== id || !d.settling
              ? d
              : sameSpan(saved, origin)
                ? null
                : { ...d, preview: saved },
          ),
        (err) => {
          setDrag(null);
          failed(err);
        },
      );
  }

  const dragHandlers = (a: Activity, kind: DragKind) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => startDrag(e, a, kind),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: () => {
      released();
      setDrag((d) => (d?.settling ? d : null));
    },
  });

  // ---- linking (FR-133) ----------------------------------------------------

  function connect(source: { id: string; side: 'out' | 'in' }, otherId: string) {
    if (source.id === otherId) return;
    const [from, to] = source.side === 'out' ? [source.id, otherId] : [otherId, source.id];
    onMessage(null);
    repo.linkActivities(from, to).catch(failed);
  }

  const linkHandlers = (a: Activity, side: 'out' | 'in') => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || drag) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      pointerDown.current = true;
      cancelled.current = false;
      linkPress.current = { id: a.id, side, x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const press = linkPress.current;
      if (!press || !rowsRef.current) return;
      const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) >= LINK_DRAG_PX;
      if (!linking?.pointer && !far) return;
      const box = rowsRef.current.getBoundingClientRect();
      setLinking({
        id: press.id,
        side: press.side,
        pointer: { x: e.clientX - box.left, y: e.clientY - box.top },
      });
    },
    onPointerUp: (e: React.PointerEvent) => {
      const press = linkPress.current;
      linkPress.current = null;
      if (released() || !press || !linking?.pointer) return; // a click: `onClick` arms the point
      afterDrag();
      setLinking(null);
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-activity-id]')
        ?.getAttribute('data-activity-id');
      if (target) connect(press, target);
    },
    onPointerCancel: () => {
      released();
      linkPress.current = null;
      setLinking(null);
    },
    // Click – click (also the keyboard way): this point, then the other activity.
    onClick: () => {
      if (suppressClick.current) return;
      if (!linking) {
        onMessage(null);
        setLinking({ id: a.id, side, pointer: null });
      } else {
        connect(linking, a.id);
        setLinking(null);
      }
    },
  });

  /** A click on an activity: finishes a link when one is being made, else selects. */
  function choose(id: string) {
    if (suppressClick.current) return;
    if (linking) {
      connect(linking, id);
      setLinking(null);
    } else onSelect(selectedId === id ? null : id);
  }

  function onBlockKey(e: React.KeyboardEvent, a: Activity) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      const patch = e.shiftKey
        ? { days: Math.max(1, a.days + step) }
        : { start: addDays(a.start, step) };
      void repo.updateActivity(a.id, patch).catch(failed);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete(a.id);
    }
  }

  function removeLink(from: string, to: string) {
    void repo
      .unlinkActivities(from, to)
      .then(
        () => toast(t.plan.linkRemoved, () => void repo.linkActivities(from, to).catch(failed)),
        failed,
      );
  }

  // ---- what to draw --------------------------------------------------------

  const rowOf = new Map(shown.map((a, i) => [a.id, i]));
  const boxOf = new Map(shown.map((a) => [a.id, blockBox(a, range)]));
  const broken = new Set(brokenLinks(shown).map((l) => `${l.from}>${l.to}`));
  const arrows = liveLinks(shown).map((l) => {
    const from = boxOf.get(l.from)!;
    const to = boxOf.get(l.to)!;
    const head = { x: to.left, y: rowOf.get(l.to)! * ROW_HEIGHT + ROW_HEIGHT / 2 };
    return {
      ...l,
      key: `${l.from}>${l.to}`,
      head,
      d: arrowPath(
        { x: from.left + from.width, row: rowOf.get(l.from)! },
        { x: to.left, row: rowOf.get(l.to)! },
      ),
    };
  });

  const days = Array.from({ length: range.days }, (_, i) => addDays(range.first, i));
  const todayIndex = daysBetween(range.first, today);
  const linkSource = linking ? boxOf.get(linking.id) : undefined;

  return (
    <>
      <span id="plan-block-help" className="sr-only">
        {t.plan.blockHelp}
      </span>
      <div
        className={`plan-timeline${linking ? ' is-linking' : ''}${drag ? ' is-dragging' : ''}`}
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
                // A click on the empty grid lets go of what was selected or being linked.
                if (e.target !== e.currentTarget || suppressClick.current) return;
                setLinking(null);
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
                    <path
                      className="plan-arrow-head"
                      d={`M ${arrow.head.x} ${arrow.head.y} l -8 -4.5 v 9 z`}
                    />
                  </g>
                ))}
                {linking?.pointer && linkSource && (
                  <line
                    className="plan-rubber"
                    x1={linkSource.left + (linking.side === 'out' ? linkSource.width : 0)}
                    y1={rowOf.get(linking.id)! * ROW_HEIGHT + ROW_HEIGHT / 2}
                    x2={linking.pointer.x}
                    y2={linking.pointer.y}
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
                  a.id === linking?.id && 'is-link-source',
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
                      className="plan-link plan-link-in"
                      aria-label={t.plan.linkIn(a.name)}
                      aria-pressed={linking?.id === a.id && linking.side === 'in'}
                      {...linkHandlers(a, 'in')}
                    />
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
                      {...dragHandlers(a, 'move')}
                    >
                      {nameMode === 'on' && <span className="plan-block-name">{a.name}</span>}
                    </button>
                    {/* Drag grips: mouse and touch only. The keyboard uses the block itself
                        (arrow keys) and the edit bar, so they are not tab stops. */}
                    <button
                      type="button"
                      tabIndex={-1}
                      className="plan-handle plan-handle-start"
                      aria-label={t.plan.moveHandle(a.name)}
                      {...dragHandlers(a, 'move')}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      className="plan-handle plan-handle-end"
                      aria-label={t.plan.endHandle(a.name)}
                      {...dragHandlers(a, 'resize')}
                    />
                    <button
                      type="button"
                      className="plan-link plan-link-out"
                      aria-label={t.plan.linkOut(a.name)}
                      aria-pressed={linking?.id === a.id && linking.side === 'out'}
                      {...linkHandlers(a, 'out')}
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
        {linking ? t.plan.linking(nameOf(linking.id)) : ''}
      </p>
    </>
  );
}

const isWeekend = (day: string) => {
  const weekday = weekdayOf(day);
  return weekday === 0 || weekday === 6;
};
