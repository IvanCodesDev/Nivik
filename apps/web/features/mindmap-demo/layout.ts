/**
 * SPIKE — deterministic tidy-tree layout for the mind map demo.
 *
 * Pure function of the document: every visible topic gets a box, every parent→child pair a cubic
 * connector. Nothing is persisted; there are no pinned positions to respect, so the whole tree is
 * recomputed on every edit (a few hundred topics take well under a millisecond).
 */

import { countDescendants, findTopic, type MindMap, type Topic } from './model';

export type Dir = 'right' | 'left' | 'down';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedTopic {
  id: string;
  depth: number;
  dir: Dir;
  box: Box;
  parentId: string | null;
  /** Index of the level-1 ancestor (its colour family); -1 for the root. */
  branch: number;
  hasChildren: boolean;
  /** Descendants hidden behind a collapsed topic; 0 when expanded. */
  hiddenCount: number;
}

export interface Connector {
  id: string;
  from: string;
  to: string;
  d: string;
  branch: number;
  /** Depth of the child end. */
  depth: number;
}

export interface Layout {
  placed: Map<string, PlacedTopic>;
  /** Pre-order, visible topics only. */
  order: PlacedTopic[];
  connectors: Connector[];
  /** Bounding box of each visible subtree (own box included). */
  subtree: Map<string, Box>;
  bounds: Box;
}

/* ---------------------------------------------------------------------------------------- */
/* Sizing                                                                                    */
/* ---------------------------------------------------------------------------------------- */

export const TOPIC_MAX_WIDTH = 250;
export const ICON_SIZE = 18;
export const ICON_GAP = 4;

export interface Metrics {
  fontSize: number;
  lineHeight: number;
  padX: number;
  padY: number;
}

export function metricsFor(depth: number): Metrics {
  if (depth === 0) return { fontSize: 17, lineHeight: 24, padX: 26, padY: 13 };
  if (depth === 1) return { fontSize: 14, lineHeight: 20, padX: 16, padY: 9 };
  return { fontSize: 13, lineHeight: 19, padX: 8, padY: 5 };
}

/** Rough advance widths; CJK is square, Latin averages just over half an em. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x2e80) width += fontSize;
    else if (ch === ' ') width += fontSize * 0.28;
    else if (ch >= 'A' && ch <= 'Z') width += fontSize * 0.66;
    else if (ch >= '0' && ch <= '9') width += fontSize * 0.58;
    else if (ch >= 'a' && ch <= 'z') width += fontSize * 0.54;
    else width += fontSize * 0.4;
  }
  return width;
}

export function iconCount(t: Topic): number {
  return (t.markers?.length ?? 0) + (t.note ? 1 : 0) + (t.link ? 1 : 0);
}

export function measureTopic(t: Topic, depth: number): { w: number; h: number } {
  const m = metricsFor(depth);
  const icons = iconCount(t);
  const iconsWidth = icons * (ICON_SIZE + ICON_GAP) + (icons ? ICON_GAP : 0);
  const maxText = TOPIC_MAX_WIDTH - m.padX * 2 - iconsWidth;
  const text = Math.max(estimateTextWidth(t.title || '　', m.fontSize), m.fontSize * 1.5);
  const lines = Math.max(1, Math.ceil(text / maxText));
  return {
    w: Math.ceil(Math.min(text, maxText) + iconsWidth + m.padX * 2),
    h: Math.ceil(lines * m.lineHeight + m.padY * 2),
  };
}

/** Distance from a topic at `depth` to its children. */
function mainGap(depth: number): number {
  if (depth === 0) return 64;
  if (depth === 1) return 40;
  return 30;
}

/** Distance between siblings at `depth`. */
function crossGap(depth: number): number {
  if (depth === 1) return 26;
  if (depth === 2) return 14;
  return 10;
}

/* ---------------------------------------------------------------------------------------- */
/* Layout                                                                                    */
/* ---------------------------------------------------------------------------------------- */

/** Extra room on the sibling axis before / after a topic (boundary frame + its label). */
interface Pad {
  before: number;
  after: number;
}

const NO_PAD: Pad = { before: 0, after: 0 };
export const BOUNDARY_PAD = 10;
const BOUNDARY_LABEL_ROOM = 16;

interface Ctx {
  layout: Layout;
  sizes: Map<string, { w: number; h: number }>;
  blocks: Map<string, number>;
  pads: Map<string, Pad>;
  horizontal: boolean;
}

function padsFor(map: MindMap): Map<string, Pad> {
  const pads = new Map<string, Pad>();
  const bump = (id: string, patch: Partial<Pad>) => {
    const current = pads.get(id) ?? NO_PAD;
    pads.set(id, {
      before: Math.max(current.before, patch.before ?? 0),
      after: Math.max(current.after, patch.after ?? 0),
    });
  };
  for (const b of map.boundaries) {
    const parent = findTopic(map.root, b.parent);
    const first = parent?.children[b.from];
    const last = parent?.children[b.to];
    if (first) bump(first.id, { before: BOUNDARY_PAD + 2 });
    if (last) bump(last.id, { after: BOUNDARY_PAD + 2 + (b.label ? BOUNDARY_LABEL_ROOM : 0) });
  }
  return pads;
}

const padOf = (ctx: Ctx, t: Topic): Pad => ctx.pads.get(t.id) ?? NO_PAD;

function sizeOf(ctx: Ctx, t: Topic, depth: number) {
  let size = ctx.sizes.get(t.id);
  if (!size) {
    size = measureTopic(t, depth);
    ctx.sizes.set(t.id, size);
  }
  return size;
}

const cross = (ctx: Ctx, size: { w: number; h: number }) => (ctx.horizontal ? size.h : size.w);

function visibleChildren(t: Topic): Topic[] {
  return t.collapsed ? [] : t.children;
}

/** Extent of a subtree along the sibling axis. */
function blockOf(ctx: Ctx, t: Topic, depth: number): number {
  const cached = ctx.blocks.get(t.id);
  if (cached !== undefined) return cached;
  const own = cross(ctx, sizeOf(ctx, t, depth));
  const kids = visibleChildren(t);
  const block = kids.length ? Math.max(own, childrenExtent(ctx, kids, depth + 1)) : own;
  ctx.blocks.set(t.id, block);
  return block;
}

/** Sibling-axis extent of `kids` (each at `depth`) including their pads and the gaps between them. */
function childrenExtent(ctx: Ctx, kids: Topic[], depth: number): number {
  if (!kids.length) return 0;
  return (
    kids.reduce((sum, c) => {
      const pad = padOf(ctx, c);
      return sum + pad.before + blockOf(ctx, c, depth) + pad.after;
    }, 0) +
    crossGap(depth) * (kids.length - 1)
  );
}

export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function register(ctx: Ctx, t: Topic, placed: PlacedTopic) {
  ctx.layout.placed.set(t.id, placed);
  ctx.layout.order.push(placed);
}

/** Lays out `t` with its leading edge at `mainStart`, centred inside a block starting at `crossStart`. */
function place(
  ctx: Ctx,
  t: Topic,
  depth: number,
  dir: Dir,
  mainStart: number,
  crossStart: number,
  parent: PlacedTopic,
  branch: number,
): Box {
  const size = sizeOf(ctx, t, depth);
  const block = blockOf(ctx, t, depth);
  const crossPos = crossStart + (block - cross(ctx, size)) / 2;
  const box: Box =
    dir === 'right'
      ? { x: mainStart, y: crossPos, w: size.w, h: size.h }
      : dir === 'left'
        ? { x: mainStart - size.w, y: crossPos, w: size.w, h: size.h }
        : { x: crossPos, y: mainStart, w: size.w, h: size.h };

  const placed: PlacedTopic = {
    id: t.id,
    depth,
    dir,
    box,
    parentId: parent.id,
    branch,
    hasChildren: t.children.length > 0,
    hiddenCount: t.collapsed ? countDescendants(t) : 0,
  };
  register(ctx, t, placed);

  const bbox = placeChildren(ctx, t, placed, dir, branch, box);
  ctx.layout.subtree.set(t.id, bbox);
  return bbox;
}

function placeChildren(
  ctx: Ctx,
  t: Topic,
  placed: PlacedTopic,
  dir: Dir,
  branch: number,
  own: Box,
): Box {
  const kids = visibleChildren(t);
  if (!kids.length) return own;
  const depth = placed.depth;
  const block = blockOf(ctx, t, depth);
  const total = childrenExtent(ctx, kids, depth + 1);
  const blockStart = dir === 'down' ? own.x + (own.w - block) / 2 : own.y + (own.h - block) / 2;
  let cursor = blockStart + (block - total) / 2;
  const nextMain =
    dir === 'right'
      ? own.x + own.w + mainGap(depth)
      : dir === 'left'
        ? own.x - mainGap(depth)
        : own.y + own.h + mainGap(depth);

  let bbox = own;
  kids.forEach((child, index) => {
    const childBranch = depth === 0 ? index : branch;
    const pad = padOf(ctx, child);
    cursor += pad.before;
    const childBox = place(ctx, child, depth + 1, dir, nextMain, cursor, placed, childBranch);
    bbox = unionBox(bbox, childBox);
    const childPlaced = ctx.layout.placed.get(child.id);
    if (childPlaced) ctx.layout.connectors.push(connector(placed, childPlaced));
    cursor += blockOf(ctx, child, depth + 1) + pad.after + crossGap(depth + 1);
  });
  return bbox;
}

/**
 * Order-preserving split of the root's children for the two-sided map: the first `k` go right,
 * the rest left, with `k` chosen to balance the two heights (ties favour the right side).
 */
export function splitBalanced(blocks: number[]): number {
  const n = blocks.length;
  if (n <= 1) return n;
  const total = blocks.reduce((a, b) => a + b, 0);
  let best = n;
  let bestDiff = Number.POSITIVE_INFINITY;
  let right = 0;
  for (let k = 1; k <= n; k += 1) {
    right += blocks[k - 1] ?? 0;
    const diff = Math.abs(right - (total - right));
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return best;
}

export function layoutMindMap(map: MindMap): Layout {
  const horizontal = map.structure !== 'org';
  const ctx: Ctx = {
    layout: {
      placed: new Map(),
      order: [],
      connectors: [],
      subtree: new Map(),
      bounds: { x: 0, y: 0, w: 0, h: 0 },
    },
    sizes: new Map(),
    blocks: new Map(),
    pads: padsFor(map),
    horizontal,
  };

  const root = map.root;
  const size = sizeOf(ctx, root, 0);
  const rootBox: Box = { x: -size.w / 2, y: -size.h / 2, w: size.w, h: size.h };
  const rootPlaced: PlacedTopic = {
    id: root.id,
    depth: 0,
    dir: horizontal ? 'right' : 'down',
    box: rootBox,
    parentId: null,
    branch: -1,
    hasChildren: root.children.length > 0,
    hiddenCount: root.collapsed ? countDescendants(root) : 0,
  };
  register(ctx, root, rootPlaced);

  const kids = visibleChildren(root).map((child, index) => ({ child, index }));
  const groups: { dir: Dir; items: typeof kids }[] = [];
  if (map.structure === 'map') {
    const k = splitBalanced(kids.map(({ child }) => blockOf(ctx, child, 1)));
    groups.push({ dir: 'right', items: kids.slice(0, k) }, { dir: 'left', items: kids.slice(k) });
  } else {
    groups.push({ dir: horizontal ? 'right' : 'down', items: kids });
  }

  let bbox = rootBox;
  for (const { dir, items } of groups) {
    if (!items.length) continue;
    const total = childrenExtent(
      ctx,
      items.map(({ child }) => child),
      1,
    );
    const centre = dir === 'down' ? rootBox.x + rootBox.w / 2 : rootBox.y + rootBox.h / 2;
    let cursor = centre - total / 2;
    const mainStart =
      dir === 'right'
        ? rootBox.x + rootBox.w + mainGap(0)
        : dir === 'left'
          ? rootBox.x - mainGap(0)
          : rootBox.y + rootBox.h + mainGap(0);
    for (const { child, index } of items) {
      const pad = padOf(ctx, child);
      cursor += pad.before;
      const childBox = place(ctx, child, 1, dir, mainStart, cursor, rootPlaced, index);
      bbox = unionBox(bbox, childBox);
      const childPlaced = ctx.layout.placed.get(child.id);
      if (childPlaced) ctx.layout.connectors.push(connector(rootPlaced, childPlaced));
      cursor += blockOf(ctx, child, 1) + pad.after + crossGap(1);
    }
  }

  ctx.layout.subtree.set(root.id, bbox);
  ctx.layout.bounds = bbox;
  return ctx.layout;
}

/* ---------------------------------------------------------------------------------------- */
/* Connectors                                                                                */
/* ---------------------------------------------------------------------------------------- */

const fmt = (n: number) => Math.round(n * 10) / 10;

/** Topics from depth 2 down are drawn as text on an underline, so their connectors meet the underline. */
export const isUnderlined = (depth: number, dir: Dir) => depth >= 2 && dir !== 'down';

export function connector(parent: PlacedTopic, child: PlacedTopic): Connector {
  const p = parent.box;
  const c = child.box;
  const dir = child.dir;
  let d: string;
  if (dir === 'down') {
    const x1 = p.x + p.w / 2;
    const y1 = p.y + p.h;
    const x2 = c.x + c.w / 2;
    const y2 = c.y;
    const my = (y1 + y2) / 2;
    d = `M${fmt(x1)} ${fmt(y1)} C${fmt(x1)} ${fmt(my)} ${fmt(x2)} ${fmt(my)} ${fmt(x2)} ${fmt(y2)}`;
  } else {
    const toRight = dir === 'right';
    const x1 = toRight ? p.x + p.w : p.x;
    const y1 = isUnderlined(parent.depth, dir) ? p.y + p.h : p.y + p.h / 2;
    const x2 = toRight ? c.x : c.x + c.w;
    const y2 = isUnderlined(child.depth, dir) ? c.y + c.h : c.y + c.h / 2;
    const mx = (x1 + x2) / 2;
    d = `M${fmt(x1)} ${fmt(y1)} C${fmt(mx)} ${fmt(y1)} ${fmt(mx)} ${fmt(y2)} ${fmt(x2)} ${fmt(y2)}`;
  }
  return {
    id: `${parent.id}->${child.id}`,
    from: parent.id,
    to: child.id,
    d,
    branch: child.branch,
    depth: child.depth,
  };
}

/* ---------------------------------------------------------------------------------------- */
/* Helpers for boundaries / summaries / hit-testing                                          */
/* ---------------------------------------------------------------------------------------- */

/** Bounding box of the visible subtrees of `parent.children[from..to]`, or null when hidden. */
export function rangeBox(layout: Layout, parent: Topic, from: number, to: number): Box | null {
  if (parent.collapsed || !layout.placed.has(parent.id)) return null;
  let box: Box | null = null;
  for (const child of parent.children.slice(from, to + 1)) {
    const sub = layout.subtree.get(child.id);
    if (!sub) continue;
    box = box ? unionBox(box, sub) : sub;
  }
  return box;
}

export function hitTest(layout: Layout, x: number, y: number): PlacedTopic | undefined {
  // Later entries are deeper in the tree; prefer them when boxes touch.
  for (let i = layout.order.length - 1; i >= 0; i -= 1) {
    const p = layout.order[i];
    if (!p) continue;
    const b = p.box;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return p;
  }
  return undefined;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
