import {
  type Diagram,
  type NodeType,
  type Palette,
  type Point,
  rectOf,
  unionRects,
} from '@nivik/ir';

/** Shape families the schematic preview can draw; everything else is a rectangle. */
export type PreviewShape = 'rect' | 'rounded' | 'ellipse' | 'diamond' | 'text' | 'line';

export interface PreviewNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: PreviewShape;
  /** First line is the title; entities carry one line per column. */
  lines: string[];
  palette: Palette;
}

export interface PreviewGroup {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface PreviewEdge {
  id: string;
  points: Point[];
  label: string;
  directed: boolean;
}

export interface PreviewModel {
  width: number;
  height: number;
  groups: PreviewGroup[];
  nodes: PreviewNode[];
  edges: PreviewEdge[];
}

export interface PreviewOptions {
  padding?: number;
  /** Minimum canvas so an empty diagram still has a frame to sit in. */
  minWidth?: number;
  minHeight?: number;
}

const SHAPE_OF: Partial<Record<NodeType, PreviewShape>> = {
  rounded: 'rounded',
  ellipse: 'ellipse',
  diamond: 'diamond',
  text: 'text',
  line: 'line',
  participant: 'rounded',
  state: 'rounded',
};

const UNDIRECTED_EDGE_TYPES = new Set(['link', 'association', 'relation']);

const anchor = (rect: { x: number; y: number; w: number; h: number }, toward: Point): Point => {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  // Leave the box through the side the target lies behind.
  const scale = Math.min(
    rect.w / 2 / Math.max(Math.abs(dx), 1e-6),
    rect.h / 2 / Math.max(Math.abs(dy), 1e-6),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
};

/**
 * Spec-free schematic of a laid-out document for the Detail page and cards: geometry straight from
 * the IR, shifted so the drawing starts at the padding; edges follow their stored route when there
 * is one and otherwise run centre to centre, clipped at the boxes. Nodes without geometry are left
 * out — the preview shows what the canvas would show.
 */
export function previewOf(diagram: Diagram, opts: PreviewOptions = {}): PreviewModel {
  const padding = opts.padding ?? 24;
  const minWidth = opts.minWidth ?? 320;
  const minHeight = opts.minHeight ?? 200;

  const placedNodes = diagram.nodes.flatMap((n) => {
    const rect = rectOf(n);
    return rect ? [{ node: n, rect }] : [];
  });
  const placedGroups = diagram.groups.flatMap((g) => {
    const rect = rectOf(g);
    return rect ? [{ group: g, rect }] : [];
  });
  const routePoints = diagram.edges.flatMap((e) => e.route?.points ?? []);
  const bounds = unionRects([
    ...placedNodes.map((p) => p.rect),
    ...placedGroups.map((p) => p.rect),
    ...routePoints.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })),
  ]);

  const originX = (bounds?.x ?? 0) - padding;
  const originY = (bounds?.y ?? 0) - padding;
  const shift = (p: Point): Point => ({ x: p.x - originX, y: p.y - originY });

  const nodes: PreviewNode[] = placedNodes.map(({ node, rect }) => {
    const at = shift(rect);
    const lines = node.label.split('\n').filter((line) => line.trim() !== '');
    return {
      id: node.id,
      x: at.x,
      y: at.y,
      w: rect.w,
      h: rect.h,
      shape: SHAPE_OF[node.type] ?? 'rect',
      lines: lines.length ? lines : [node.label],
      palette: node.style?.palette ?? 'neutral',
    };
  });
  const rectById = new Map(nodes.map((n) => [n.id, n]));

  const groups: PreviewGroup[] = placedGroups.map(({ group, rect }) => {
    const at = shift(rect);
    return { id: group.id, x: at.x, y: at.y, w: rect.w, h: rect.h, label: group.label ?? '' };
  });

  const edges: PreviewEdge[] = diagram.edges.flatMap((e) => {
    const points = e.route?.points?.map(shift);
    if (points && points.length >= 2) {
      return [
        { id: e.id, points, label: e.label ?? '', directed: !UNDIRECTED_EDGE_TYPES.has(e.type) },
      ];
    }
    const from = rectById.get(e.source);
    const to = rectById.get(e.target);
    if (!from || !to) return [];
    const toCentre = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
    const fromCentre = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
    return [
      {
        id: e.id,
        points: [anchor(from, toCentre), anchor(to, fromCentre)],
        label: e.label ?? '',
        directed: !UNDIRECTED_EDGE_TYPES.has(e.type),
      },
    ];
  });

  return {
    width: Math.max(minWidth, (bounds?.w ?? 0) + padding * 2),
    height: Math.max(minHeight, (bounds?.h ?? 0) + padding * 2),
    groups,
    nodes,
    edges,
  };
}
