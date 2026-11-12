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
  GROUP_DEPTH_MAX,
  addDays,
  brokenLinks,
  daysBetween,
  depthOf,
  earliestStart,
  endDay,
  heightOf,
  isGroup,
  isInside,
  leavesOf,
  liveLinks,
  localDay,
  planTree,
  schedulePlan,
  spansOf,
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
  groupBox,
  headerUnits,
  hiddenMark,
  hiddenPredecessors,
  isOverdue,
  nudge,
  planRows,
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
  /** Groups drawn as one row (FR-180, FR-181). */
  collapsed: ReadonlySet<string>;
  onToggleGroup: (id: string) => void;
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

/**
 * What releasing a block's middle over another row does (FR-176): group it with an
 * activity, add it to a group, take it out of its group, or nothing (with the reason).
 */
type GroupDrop =
  | { kind: 'wrap'; target: string }
  | { kind: 'join'; target: string }
  | { kind: 'out'; from: string }
  | { kind: 'none'; message: string };

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
  /** The middle over another row: releasing groups (FR-176). */
  groupTo: GroupDrop | null;
  /** Where the pointer is on the rows, for the line to it while linking or grouping. */
  pointer: { x: number; y: number } | null;
  /** Released: the preview stays until the saved activity shows up, so nothing jumps back. */
  settling: boolean;
}

/** Narrower than this, a block shows no grip marks and its name goes after it. */
const NARROW_BLOCK = 48;

const sameSpan = (a: Span, b: Span) => a.start === b.start && a.days === b.days;

/**
 * The timeline of a plan (docs/plan/PRD.md FR-125 – FR-139, section 11): a day grid, one
 * row and one block per activity, boxes for expanded groups, arrows for dependencies. Blocks
 * are dragged with pointer events (mouse and touch alike); the geometry is in
 * lib/timeline.ts.
 *
 * An end of a block does two things, by where it is dragged: along its own row it changes
 * the activity (start or duration), onto the block of another row it links the two. The
 * middle of a block moves it along its own row and groups it when dropped in another row.
 */
export function Timeline({
  activities,
  nameMode,
  scale,
  hideDone,
  collapsed,
  onToggleGroup,
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

  // The groups and the links do not depend on the days, so they are worked out once per
  // saved state and not on every pointer move of a drag.
  const tree = useMemo(() => planTree(activities), [activities]);
  const links = useMemo(() => liveLinks(activities), [activities]);
  const saved = useMemo(() => spansOf(activities, tree), [activities, tree]);
  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const group = (id: string) => isGroup(tree, id);
  const leaves = (id: string) => leavesOf(tree, id).map((l) => byId.get(l)!);
  const allDone = (id: string) => leaves(id).every((l) => l.done);

  // The saved activity changed after a drop: the preview has done its job.
  const draggedSpan = drag ? saved.get(drag.id) : undefined;
  if (drag?.settling && (!draggedSpan || !sameSpan(draggedSpan, drag.origin))) setDrag(null);

  // What is drawn: the dragged block where it would land (a group: all its activities), and
  // what it would push (FR-136).
  let shown = activities;
  if (drag && !drag.linkTo && !drag.groupTo && !sameSpan(drag.preview, drag.origin)) {
    if (group(drag.id)) {
      const shift = daysBetween(drag.origin.start, drag.preview.start);
      const moving = new Set(leavesOf(tree, drag.id));
      shown = activities.map((a) =>
        moving.has(a.id) ? { ...a, start: addDays(a.start, shift) } : a,
      );
    } else {
      shown = activities.map((a) => (a.id === drag.id ? { ...a, ...drag.preview } : a));
    }
    const pushed = schedulePlan(shown, links);
    if (pushed.size > 0) {
      shown = shown.map((a) => (pushed.has(a.id) ? { ...a, start: pushed.get(a.id)! } : a));
    }
  }
  const spans = shown === activities ? saved : spansOf(shown, tree);
  const spanOf = (id: string) => spans.get(id)!;

  // The rows: groups expanded or collapsed, hidden done activities (FR-162) left out. They
  // are still part of the schedule above (a drag still pushes them), only not drawn.
  const { rows, boxes, rowOf } = useMemo(
    () => planRows(activities, tree, collapsed, hideDone),
    [activities, tree, collapsed, hideDone],
  );
  /** The row an activity is drawn in: its own, or its collapsed group's (FR-180). */
  const drawnAs = (id: string) => {
    const row = rowOf.get(id);
    return row === undefined ? undefined : rows[row]!.id;
  };

  // Read once: the grid must not shift at midnight in the middle of a drag.
  const [today] = useState(() => localDay(Date.now()));
  // The grid follows the saved days, not the preview: it must not move under the pointer.
  const range = timelineRange(
    rows.map((r) => saved.get(r.id)!),
    today,
    scale,
  );
  const gridWidth = range.days * w;
  const rowsHeight = (rows.length + 1) * ROW_HEIGHT;

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

  const nameOf = (id: string) => byId.get(id)?.name ?? '';

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

  // ---- dragging a block or one of its ends (FR-127 – FR-129, FR-133, FR-176) ----

  function startDrag(e: React.PointerEvent<HTMLElement>, id: string, grip: Drag['grip']) {
    if (e.button !== 0 || drag) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerDown.current = true;
    cancelled.current = false;
    const kind: DragKind = grip === 'end' ? 'resize' : 'move';
    const origin = { ...saved.get(id)! };
    setDrag({
      id,
      kind,
      grip,
      startX: e.clientX,
      origin,
      earliest: kind === 'move' ? earliestStart(activities, id, links) : null,
      preview: origin,
      moved: false,
      linkTo: null,
      groupTo: null,
      pointer: null,
      settling: false,
    });
  }

  /**
   * The other activity under the pointer that an end can be dropped on: a block, or the
   * header of an expanded group's box.
   */
  function linkTargetUnder(e: React.PointerEvent, ownId: string): string | null {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const id =
      el?.closest('.plan-bar')?.getAttribute('data-activity-id') ??
      el?.closest('.plan-group-top')?.closest('.plan-group-box')?.getAttribute('data-group-id');
    return id && id !== ownId ? id : null;
  }

  /** What dropping the middle of `id` at the pointer, in another row, would do (FR-176). */
  function groupDropUnder(e: React.PointerEvent, id: string): GroupDrop {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const bar = el?.closest('.plan-bar')?.getAttribute('data-activity-id');
    const box = el?.closest('.plan-group-box')?.getAttribute('data-group-id');
    const target = bar ?? box ?? null;
    const parent = tree.parent.get(id);
    if (target === null || target === id) {
      return parent !== undefined ? { kind: 'out', from: parent } : { kind: 'none', message: '' };
    }
    if (isInside(tree, target, id)) {
      return { kind: 'none', message: t.plan.notIntoItself(nameOf(id)) };
    }
    if (group(target) && target === parent) {
      return { kind: 'none', message: t.plan.alreadyIn(nameOf(id), nameOf(target)) };
    }
    if (depthOf(tree, target) + heightOf(tree, id) > GROUP_DEPTH_MAX) {
      return { kind: 'none', message: t.plan.tooDeep };
    }
    return group(target) ? { kind: 'join', target } : { kind: 'wrap', target };
  }

  function moveDrag(e: React.PointerEvent) {
    if (!drag || drag.settling) return;
    const box = rowsRef.current?.getBoundingClientRect();
    const pointer = box ? { x: e.clientX - box.left, y: e.clientY - box.top } : null;
    // An end over the block of another row: a link, and the block itself stays as it is.
    const linkTo = drag.grip ? linkTargetUnder(e, drag.id) : null;
    if (linkTo && pointer) {
      return setDrag({
        ...drag,
        linkTo,
        groupTo: null,
        pointer,
        preview: drag.origin,
        moved: true,
      });
    }
    // The middle over another row: grouping, and the block stays as it is.
    const ownRow = rowOf.get(drag.id);
    if (!drag.grip && pointer && ownRow !== undefined) {
      const row = Math.floor(pointer.y / ROW_HEIGHT);
      if (row !== ownRow) {
        const groupTo = groupDropUnder(e, drag.id);
        return setDrag({
          ...drag,
          linkTo: null,
          groupTo,
          pointer,
          preview: drag.origin,
          moved: true,
        });
      }
    }
    const delta = Math.round((e.clientX - drag.startX) / w);
    // A group's length comes from its activities: its end only makes links (FR-182).
    const preview =
      drag.kind === 'resize' && group(drag.id)
        ? drag.origin
        : dragResult(drag.kind, drag.origin, delta, drag.earliest);
    if (drag.linkTo || drag.groupTo || !sameSpan(preview, drag.preview)) {
      setDrag({
        ...drag,
        linkTo: null,
        groupTo: null,
        pointer: null,
        preview,
        moved: drag.moved || !sameSpan(preview, drag.origin),
      });
    }
  }

  function endDrag() {
    if (released() || !drag || drag.settling) return;
    if (drag.moved) afterDrag();
    const { id, kind, grip, preview, origin, linkTo, groupTo } = drag;
    if (linkTo) {
      setDrag(null);
      // The end of this one on that one: this → that. Its beginning: that → this.
      const [from, to] = grip === 'end' ? [id, linkTo] : [linkTo, id];
      return void change(() => repo.linkActivities(from, to));
    }
    if (groupTo) {
      setDrag(null);
      if (groupTo.kind === 'wrap')
        return void change(() => repo.groupActivities(groupTo.target, id));
      if (groupTo.kind === 'join') return void change(() => repo.moveToGroup(id, groupTo.target));
      if (groupTo.kind === 'out') return void change(() => repo.moveToGroup(id, null));
      return;
    }
    if (sameSpan(preview, origin)) return setDrag(null);
    setDrag({ ...drag, settling: true });
    void change(() =>
      repo.updateActivity(id, kind === 'move' ? { start: preview.start } : { days: preview.days }),
    ).then((stored) =>
      // Refused, or saved somewhere else than shown: show what is stored.
      setDrag((d) =>
        d?.id !== id || !d.settling
          ? d
          : !stored || sameSpan(stored, origin)
            ? null
            : { ...d, preview: { start: stored.start, days: stored.days } },
      ),
    );
  }

  /** The drag ended without a release: forget it (a drop being saved stays). */
  function abandonDrag() {
    released();
    setDrag((d) => (d?.settling ? d : null));
  }

  const dragHandlers = (id: string, grip: Drag['grip']) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => startDrag(e, id, grip),
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

  /** A click on a block selects it; a second one right after toggles done (FR-154, FR-184). */
  function clickBlock(id: string, at: number) {
    if (suppressClick.current) return;
    onSelect(id);
    if (doubleTap(id, at)) {
      void change(() => repo.updateActivity(id, (now) => ({ done: !now.done })));
    }
  }

  function onBlockKey(e: React.KeyboardEvent, id: string) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      const resize = e.shiftKey;
      // From the stored activity, not the one on screen: with key repeat the next press
      // comes before the screen has caught up, and must still add up.
      void change(() => repo.updateActivity(id, (now) => nudge(now, step, resize)));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete(id);
    }
  }

  const removeLink = (from: string, to: string) =>
    void change(() => repo.unlinkActivities(from, to));

  // ---- what to draw --------------------------------------------------------

  const boxOf = new Map(rows.map((r) => [r.id, blockBox(spanOf(r.id), range, scale)]));
  const lastRowOf = new Map(boxes.map((b) => [b.id, b.last]));
  const broken = new Set(brokenLinks(shown, links).map((l) => `${l.from}>${l.to}`));
  // An arrow to or from a hidden activity would point at nothing (decision P19). One into a
  // collapsed group ends at the group's block, one arrow per pair (FR-180).
  const seen = new Set<string>();
  const arrows = links.flatMap((l) => {
    const from = drawnAs(l.from);
    const to = drawnAs(l.to);
    if (from === undefined || to === undefined || from === to) return [];
    if (isInside(tree, from, to) || isInside(tree, to, from)) return [];
    const pair = `${from}>${to}`;
    if (seen.has(pair)) return [];
    seen.add(pair);
    const a = boxOf.get(from)!;
    const b = boxOf.get(to)!;
    // From the bottom of an expanded group's box.
    const source = { x: a.left + a.width, row: lastRowOf.get(from) ?? rowOf.get(from)! };
    const target = { x: b.left, row: rowOf.get(to)! };
    const tip = arrowTip(source, target);
    return [
      {
        ...l,
        key: `${l.from}>${l.to}`,
        d: arrowPath(source, target),
        // A small triangle on the corner of the target block, pointing along the line.
        head: `M ${tip.x} ${tip.y} l -9 -5 v 10 z`,
        turn: `rotate(${tip.angle} ${tip.x} ${tip.y})`,
      },
    ];
  });

  // A shown activity that waits for a hidden one: a dotted mark before its block (FR-173).
  const marks = hideDone
    ? [...hiddenPredecessors(links, new Set(rowOf.keys()))]
        .filter((id) => drawnAs(id) === id)
        .map((id) => ({ id, ...hiddenMark(boxOf.get(id)!, rowOf.get(id)!) }))
    : [];

  const todayIndex = daysBetween(range.first, today);
  const dragBox = drag ? boxOf.get(drag.id) : undefined;
  const dragRow = drag ? rowOf.get(drag.id) : undefined;
  const dropTarget =
    drag?.linkTo ??
    (drag?.groupTo?.kind === 'wrap' || drag?.groupTo?.kind === 'join' ? drag.groupTo.target : null);

  /** What releasing will do, for the line below the timeline. */
  function dropHint(): string {
    if (!drag) return '';
    if (drag.linkTo) {
      return drag.grip === 'end'
        ? t.plan.linking(nameOf(drag.id), nameOf(drag.linkTo))
        : t.plan.linking(nameOf(drag.linkTo), nameOf(drag.id));
    }
    const g = drag.groupTo;
    if (!g) return '';
    switch (g.kind) {
      case 'wrap':
        return t.plan.groupWith(nameOf(g.target), nameOf(drag.id));
      case 'join':
        return t.plan.joinGroup(nameOf(drag.id), nameOf(g.target));
      case 'out':
        return t.plan.leaveGroup(nameOf(drag.id), nameOf(g.from));
      case 'none':
        return g.message;
    }
  }

  /** The ▸ / ▾ button of a group (FR-181). */
  const chevron = (id: string, className: string) => {
    const open = !collapsed.has(id);
    const label = open ? t.plan.collapse(nameOf(id)) : t.plan.expand(nameOf(id));
    return (
      <button
        type="button"
        className={`plan-chev ${className}`}
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => onToggleGroup(id)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
    );
  };

  return (
    <>
      <span id="plan-block-help" className="sr-only">
        {t.plan.blockHelp}
      </span>
      <div
        className={`plan-timeline${drag?.linkTo || drag?.groupTo ? ' is-linking' : ''}${drag ? ' is-dragging' : ''}`}
        data-names={nameMode}
        data-scale={scale}
        // The width of a day on this scale, for the grid lines and today's line (FR-157).
        style={{ '--plan-day': `${w}px` } as CSSProperties}
        ref={scroller}
        role="group"
        aria-label={t.plan.timeline}
      >
        <div className="plan-canvas">
          {/* The row's details button, and in the Column mode its name (FR-149, FR-140), as a
              tree (FR-185). */}
          <div className={`plan-side${nameMode === 'column' ? ' plan-name-col' : ''}`}>
            <div className="plan-name-head">
              {nameMode === 'column' ? t.plan.activityColumn : ''}
            </div>
            {rows.map((r) => {
              const a = byId.get(r.id)!;
              const isG = r.kind !== 'leaf';
              const done = isG ? allDone(r.id) : a.done;
              const classes = ['plan-side-row', isG && 'is-group', done && 'is-done'];
              return (
                <div
                  key={r.id}
                  className={classes.filter(Boolean).join(' ')}
                  style={
                    nameMode === 'column'
                      ? ({ '--plan-indent': r.depth } as CSSProperties)
                      : undefined
                  }
                >
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
                    <>
                      <span className="plan-indent" aria-hidden="true" />
                      {isG ? chevron(r.id, 'plan-chev-side') : <span className="plan-chev-gap" />}
                      <button
                        type="button"
                        className={`plan-name${a.id === selectedId ? ' is-selected' : ''}`}
                        data-activity-id={a.id}
                        title={a.name}
                        onClick={() => choose(a.id)}
                      >
                        {done && !isG && <span aria-hidden="true">✓ </span>}
                        {a.name}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="plan-grid" style={{ width: gridWidth }}>
            <TimelineHeader first={range.first} days={range.days} today={today} scale={scale} />

            <div
              className={`plan-rows${drag?.groupTo?.kind === 'out' ? ' is-drop-target' : ''}`}
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

              {/* Expanded groups: a light box from the header row to the last child (FR-179),
                  outer ones first so that inner ones are drawn above them. */}
              {boxes.map((b) => {
                const a = byId.get(b.id)!;
                const span = spanOf(b.id);
                const end = endDay(span.start, span.days);
                const lv = leaves(b.id);
                const doneCount = lv.filter((l) => l.done).length;
                const geo = groupBox(boxOf.get(b.id)!, b.first, b.last, b.levels);
                const classes = [
                  'plan-group-box',
                  `level-${Math.min(b.depth, 3)}`,
                  b.id === selectedId && 'is-selected',
                  b.id === drag?.id && 'is-dragged',
                  b.id === dropTarget && 'is-link-target',
                ];
                return (
                  <div
                    key={b.id}
                    className={classes.filter(Boolean).join(' ')}
                    data-group-id={b.id}
                    style={{ left: geo.left, width: geo.width, top: geo.top, height: geo.height }}
                  >
                    <div className="plan-group-top">
                      {chevron(b.id, 'plan-chev-box')}
                      <button
                        type="button"
                        className="plan-group-head"
                        data-start={span.start}
                        data-end={end}
                        aria-label={t.plan.groupHead(
                          a.name,
                          formatDay(span.start),
                          formatDay(end),
                          doneCount,
                          lv.length,
                        )}
                        aria-pressed={b.id === selectedId}
                        aria-describedby="plan-block-help"
                        title={`${a.name}: ${formatDay(span.start)} – ${formatDay(end)}`}
                        onClick={() => choose(b.id)}
                        onKeyDown={(e) => onBlockKey(e, b.id)}
                        {...dragHandlers(b.id, null)}
                      >
                        <span className="plan-group-name">{a.name}</span>
                        <span className="plan-group-meta">
                          {t.plan.groupMeta(
                            formatDay(span.start),
                            formatDay(end),
                            doneCount,
                            lv.length,
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}

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
                {(drag?.linkTo || drag?.groupTo) &&
                  drag.pointer &&
                  dragBox &&
                  dragRow !== undefined && (
                    <line
                      className="plan-rubber"
                      x1={
                        dragBox.left +
                        (drag.grip === 'end'
                          ? dragBox.width
                          : drag.grip === 'start'
                            ? 0
                            : dragBox.width / 2)
                      }
                      y1={dragRow * ROW_HEIGHT + ROW_HEIGHT / 2}
                      x2={drag.pointer.x}
                      y2={drag.pointer.y}
                    />
                  )}
              </svg>

              {rows.map((r, row) => {
                if (r.kind === 'open') return null; // drawn as its box
                const a = byId.get(r.id)!;
                const isG = r.kind === 'closed';
                const span = spanOf(r.id);
                const box = boxOf.get(r.id)!;
                // Too narrow for its name (coarse scales): the name goes after the block.
                const narrow = box.width < NARROW_BLOCK;
                const nameOn = nameMode === 'on' && !narrow;
                const nameAfter = nameMode === 'after' || (nameMode === 'on' && narrow);
                const end = endDay(span.start, span.days);
                const lv = isG ? leaves(r.id) : [a];
                const doneCount = lv.filter((l) => l.done).length;
                const done = doneCount === lv.length;
                // Ended before today and not done: red (FR-161).
                const overdue = isOverdue(span, done, today);
                const state = done ? 'done' : overdue ? 'overdue' : 'open';
                const style: CSSProperties = {
                  left: box.left,
                  width: box.width,
                  top: row * ROW_HEIGHT,
                };
                const classes = [
                  'plan-bar',
                  isG && 'is-group',
                  narrow && 'is-narrow',
                  a.id === selectedId && 'is-selected',
                  a.id === drag?.id && 'is-dragged',
                  a.id === dropTarget && 'is-link-target',
                  done && 'is-done',
                  overdue && 'is-overdue',
                ];
                return (
                  <div
                    key={a.id}
                    className={classes.filter(Boolean).join(' ')}
                    style={style}
                    data-activity-id={a.id}
                    data-parent-id={tree.parent.get(a.id)}
                  >
                    <button
                      type="button"
                      className="plan-block"
                      data-start={span.start}
                      data-end={end}
                      aria-label={
                        isG
                          ? t.plan.groupBlock(
                              a.name,
                              lv.length,
                              formatDay(span.start),
                              formatDay(end),
                              state,
                            )
                          : t.plan.block(a.name, formatDay(span.start), formatDay(end), state)
                      }
                      aria-pressed={a.id === selectedId}
                      aria-describedby="plan-block-help"
                      title={`${a.name}: ${formatDay(span.start)} – ${formatDay(end)}`}
                      onClick={(e) => clickBlock(a.id, e.timeStamp)}
                      onKeyDown={(e) => onBlockKey(e, a.id)}
                      {...dragHandlers(a.id, null)}
                    >
                      {nameOn && (
                        <span className="plan-block-name">
                          {done && !isG && <span aria-hidden="true">✓ </span>}
                          {a.name}
                        </span>
                      )}
                      {isG && (
                        <>
                          <span className="plan-group-count" title={t.plan.groupCount(lv.length)}>
                            {lv.length}
                          </span>
                          <span
                            className="plan-group-progress"
                            aria-hidden="true"
                            style={{ width: `${Math.round((100 * doneCount) / lv.length)}%` }}
                          />
                        </>
                      )}
                    </button>
                    {/* The two ends: dragged along the row they move the activity or change
                        its duration, dropped on another block they link the two. Mouse and
                        touch only: the keyboard uses the block itself (arrow keys) and the
                        details page, so they are not tab stops. A collapsed group shows { }
                        instead of the grips; its end only links (FR-180, FR-182). */}
                    <button
                      type="button"
                      tabIndex={-1}
                      className="plan-handle plan-handle-start"
                      aria-label={t.plan.moveHandle(a.name)}
                      {...dragHandlers(a.id, 'start')}
                    >
                      {isG && (
                        <span className="plan-brace" aria-hidden="true">
                          {'{'}
                        </span>
                      )}
                    </button>
                    {isG && chevron(a.id, 'plan-chev-bar')}
                    <button
                      type="button"
                      tabIndex={-1}
                      className="plan-handle plan-handle-end"
                      aria-label={isG ? t.plan.linkHandle(a.name) : t.plan.endHandle(a.name)}
                      {...dragHandlers(a.id, 'end')}
                    >
                      {isG && (
                        <span className="plan-brace" aria-hidden="true">
                          {'}'}
                        </span>
                      )}
                    </button>
                    {nameAfter && (
                      <span className="plan-after-name">
                        {done && !isG && <span aria-hidden="true">✓ </span>}
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
        {dropHint()}
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
