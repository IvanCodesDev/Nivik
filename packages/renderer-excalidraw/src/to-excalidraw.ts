import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import type { Arrowhead, ExcalidrawLinearElement } from '@excalidraw/excalidraw/element/types';
import {
  type Diagram,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
  type EntityData,
  type Id,
  indexDiagram,
  type LineData,
  type NodeType,
  type Point,
  type Rect,
  rectOf,
} from '@nivik/ir';
import { SEQUENCE_METRICS, straightRoute } from '@nivik/layout';
import {
  emptyFidelity,
  type FidelityReport,
  type NativePart,
  partId,
  tagOf,
} from '@nivik/renderer-core';
import { FONT_PX, ROUNDNESS } from './constants';
import { colorsFor, type ExcalidrawStyle, textColorFor } from './palette';

type Skeleton = ExcalidrawElementSkeleton;
type LocalPoints = ExcalidrawLinearElement['points'];
type Approximate = (from: string, id: Id) => void;

const nivik = (id: Id, part: NativePart, rev: number) => ({ nivik: tagOf(id, part, rev) });
const localPoints = (points: readonly Point[], origin: Point): LocalPoints =>
  points.map((p) => [p.x - origin.x, p.y - origin.y]) as unknown as LocalPoints;
/** Node types Excalidraw draws faithfully; the rest becomes a rounded rectangle (spec 04 §6.2). */
const NATIVE: ReadonlySet<NodeType> = new Set([
  'box',
  'rounded',
  'ellipse',
  'diamond',
  'text',
  'line',
  'entity',
  'participant',
]);
const shapeStyle = (s: ExcalidrawStyle) => ({
  strokeColor: s.strokeColor,
  backgroundColor: s.backgroundColor,
  fillStyle: s.fillStyle,
  strokeWidth: s.strokeWidth,
  strokeStyle: s.strokeStyle,
  roughness: s.roughness,
  opacity: s.opacity,
});

export interface ToExcalidrawResult {
  elements: Skeleton[];
  fidelity: FidelityReport;
}

/**
 * Spec 04 §6.2: IR → Excalidraw skeletons. The browser expands them with
 * `convertToExcalidrawElements(skeletons, { regenerateIds: false })`; `opts.ids` limits the output
 * to those elements while edge endpoints and frame children are still resolved from the whole IR.
 */
export function toExcalidraw(d: Diagram, opts: { ids?: Id[] } = {}): ToExcalidrawResult {
  const index = indexDiagram(d);
  const wanted = opts.ids ? new Set(opts.ids) : null;
  const include = (id: Id) => wanted === null || wanted.has(id);
  const rects = new Map<Id, Rect>();
  for (const el of [...d.nodes, ...d.groups]) {
    const r = rectOf(el);
    if (r) rects.set(el.id, r);
  }
  const approximated = new Map<string, Id[]>();
  const approximate: Approximate = (from, id) => {
    const ids = approximated.get(from);
    if (ids) ids.push(id);
    else approximated.set(from, [id]);
  };
  const lifelineEnd = lifelineEnds(d);
  const elements: Skeleton[] = [];

  for (const n of d.nodes) {
    if (include(n.id)) {
      elements.push(...nodeSkeletons(n, d, rects.get(n.id), approximate, lifelineEnd));
    }
  }
  for (const e of d.edges) {
    if (!include(e.id)) continue;
    const s = edgeSkeleton(e, d, rects);
    if (s) elements.push(s);
  }
  for (const g of d.groups) {
    if (include(g.id)) {
      elements.push(
        ...groupSkeletons(g, d, rects.get(g.id), index.byParent.get(g.id) ?? [], approximate),
      );
    }
  }

  const fidelity = emptyFidelity();
  for (const [from, ids] of approximated) {
    fidelity.approximated.push({
      ids,
      from,
      to: from === 'nested group' ? 'locked rectangle' : 'rectangle',
    });
  }
  fidelity.lossless = fidelity.approximated.length === 0;
  return { elements, fidelity };
}

/** Bottom of each participant's lifeline: the last message touching it plus the tail (spec 03 §7.1). */
function lifelineEnds(d: Diagram): (id: Id) => number {
  const last = new Map<Id, number>();
  for (const e of d.edges) {
    if (e.type !== 'message') continue;
    const y = Math.max(...(e.route?.points.map((p) => p.y) ?? [Number.NEGATIVE_INFINITY]));
    for (const id of [e.source, e.target]) {
      last.set(id, Math.max(last.get(id) ?? Number.NEGATIVE_INFINITY, y));
    }
  }
  return (id) => {
    const y = last.get(id);
    return y === undefined || !Number.isFinite(y) ? Number.NaN : y + SEQUENCE_METRICS.lifelineTail;
  };
}

function nodeSkeletons(
  n: DiagramNode,
  d: Diagram,
  rect: Rect | undefined,
  approximate: Approximate,
  lifelineEnd: (id: Id) => number,
): Skeleton[] {
  const r = rect ?? { x: 0, y: 0, w: 120, h: 56 };
  const style = colorsFor(d.theme, n.style);
  const fontSize = FONT_PX[d.theme.fontScale];
  const textColor = textColorFor(d.theme, n.style);
  const tag = { customData: nivik(n.id, 'main', n.meta.rev) };
  const box = { id: n.id, x: r.x, y: r.y, width: r.w, height: r.h, ...shapeStyle(style), ...tag };
  const label = { text: n.label, fontSize, fontFamily: style.fontFamily, strokeColor: textColor };
  if (!NATIVE.has(n.type)) approximate(n.type, n.id);
  switch (n.type) {
    case 'ellipse':
      return [{ type: 'ellipse', ...box, label }];
    case 'diamond':
      return [{ type: 'diamond', ...box, label }];
    case 'text':
      return [
        {
          type: 'text',
          id: n.id,
          x: r.x,
          y: r.y,
          text: n.label,
          fontSize,
          fontFamily: style.fontFamily,
          strokeColor: textColor,
          ...tag,
        },
      ];
    case 'entity': {
      const columns = (n.data as EntityData | undefined)?.columns ?? [];
      const lines = [n.label, ...columns.map((c) => (c.type ? `${c.name}: ${c.type}` : c.name))];
      return [
        { type: 'rectangle', ...box, roundness: null },
        {
          type: 'text',
          id: partId(n.id, 'label'),
          x: r.x + 12,
          y: r.y + 8,
          text: lines.join('\n'),
          fontSize: fontSize - 4,
          fontFamily: style.fontFamily,
          textAlign: 'left',
          strokeColor: textColor,
          customData: nivik(n.id, 'label', n.meta.rev),
        },
      ];
    }
    case 'participant': {
      const top = r.y + r.h;
      const end = lifelineEnd(n.id);
      const length = Number.isNaN(end)
        ? SEQUENCE_METRICS.firstMsgOffset + SEQUENCE_METRICS.lifelineTail
        : Math.max(0, end - top);
      return [
        { type: 'rectangle', ...box, roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS }, label },
        {
          type: 'line',
          id: partId(n.id, 'lifeline'),
          x: r.x + r.w / 2,
          y: top,
          points: localPoints(
            [
              { x: 0, y: 0 },
              { x: 0, y: length },
            ],
            { x: 0, y: 0 },
          ),
          strokeColor: style.strokeColor,
          strokeWidth: 1,
          strokeStyle: 'dashed',
          roughness: style.roughness,
          locked: true,
          customData: nivik(n.id, 'lifeline', n.meta.rev),
        },
      ];
    }
    case 'line':
      return lineSkeletons(n, r, style, fontSize, textColor);
    default:
      return [
        {
          type: 'rectangle',
          ...box,
          roundness: n.type === 'box' ? null : { type: ROUNDNESS.ADAPTIVE_RADIUS },
          label,
        },
      ];
  }
}

/** Free-standing line along the box axis (spec 04 §6.2 `line` row). */
function lineSkeletons(
  n: DiagramNode,
  r: Rect,
  style: ExcalidrawStyle,
  fontSize: number,
  textColor: string,
): Skeleton[] {
  const data = n.data as LineData | undefined;
  const [from, to] = axisPoints(r, data?.axis ?? 'horizontal');
  const arrow = data?.arrow ?? 'none';
  const common = {
    id: n.id,
    x: from.x,
    y: from.y,
    points: localPoints([from, to], from),
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    roughness: style.roughness,
    customData: nivik(n.id, 'main', n.meta.rev),
  };
  const out: Skeleton[] = [
    arrow === 'none'
      ? { type: 'line', ...common }
      : {
          type: 'arrow',
          ...common,
          startArrowhead: arrow === 'both' ? 'arrow' : null,
          endArrowhead: 'arrow',
        },
  ];
  if (n.label) {
    out.push({
      type: 'text',
      id: partId(n.id, 'label'),
      x: r.x + r.w / 2,
      y: r.y + r.h / 2 - fontSize,
      text: n.label,
      fontSize: fontSize - 4,
      fontFamily: style.fontFamily,
      textAlign: 'center',
      strokeColor: textColor,
      customData: nivik(n.id, 'label', n.meta.rev),
    });
  }
  return out;
}

function axisPoints(r: Rect, axis: NonNullable<LineData['axis']>): [Point, Point] {
  switch (axis) {
    case 'horizontal':
      return [
        { x: r.x, y: r.y + r.h / 2 },
        { x: r.x + r.w, y: r.y + r.h / 2 },
      ];
    case 'vertical':
      return [
        { x: r.x + r.w / 2, y: r.y },
        { x: r.x + r.w / 2, y: r.y + r.h },
      ];
    case 'diagonal-down':
      return [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y + r.h },
      ];
    case 'diagonal-up':
      return [
        { x: r.x, y: r.y + r.h },
        { x: r.x + r.w, y: r.y },
      ];
  }
}

function arrowheads(e: DiagramEdge): { start: Arrowhead | null; end: Arrowhead | null } {
  const head: Arrowhead =
    e.type === 'inheritance'
      ? 'triangle_outline'
      : e.type === 'composition'
        ? 'diamond'
        : e.type === 'aggregation'
          ? 'diamond_outline'
          : 'arrow';
  switch (e.direction) {
    case 'forward':
      return { start: null, end: head };
    case 'backward':
      return { start: head, end: null };
    case 'both':
      return { start: head, end: head };
    case 'none':
      return { start: null, end: null };
  }
}

function edgeSkeleton(e: DiagramEdge, d: Diagram, rects: ReadonlyMap<Id, Rect>): Skeleton | null {
  const a = rects.get(e.source);
  const b = rects.get(e.target);
  if (!a || !b) return null;
  const route = e.route?.points ?? straightRoute(a, b);
  const first = route[0];
  if (!first) return null;
  const style = colorsFor(d.theme, e.style);
  const heads = arrowheads(e);
  return {
    type: 'arrow',
    id: e.id,
    x: first.x,
    y: first.y,
    points: localPoints(route, first),
    start: { id: e.source },
    end: { id: e.target },
    ...(e.label
      ? {
          label: {
            text: e.label,
            fontSize: FONT_PX[d.theme.fontScale] - 4,
            fontFamily: style.fontFamily,
          },
        }
      : {}),
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    roughness: style.roughness,
    startArrowhead: heads.start,
    endArrowhead: heads.end,
    customData: nivik(e.id, 'main', e.meta.rev),
  };
}

function groupSkeletons(
  g: DiagramGroup,
  d: Diagram,
  rect: Rect | undefined,
  children: readonly Id[],
  approximate: Approximate,
): Skeleton[] {
  if (!rect) return [];
  const tag = { customData: nivik(g.id, 'main', g.meta.rev) };
  if (g.parent !== null) {
    // Excalidraw frames cannot nest: the inner group becomes a locked, translucent backdrop.
    approximate('nested group', g.id);
    const style = colorsFor(d.theme, g.style);
    return [
      {
        type: 'rectangle',
        id: g.id,
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
        strokeColor: style.strokeColor,
        backgroundColor: style.backgroundColor,
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'dashed',
        roughness: style.roughness,
        opacity: 40,
        locked: true,
        ...(g.label
          ? {
              label: {
                text: g.label,
                fontSize: FONT_PX[d.theme.fontScale] - 4,
                fontFamily: style.fontFamily,
                textAlign: 'left',
                verticalAlign: 'top',
              },
            }
          : {}),
        ...tag,
      },
    ];
  }
  return [
    {
      type: 'frame',
      id: g.id,
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      name: g.label ?? '',
      children: [...children],
      ...tag,
    },
  ];
}
