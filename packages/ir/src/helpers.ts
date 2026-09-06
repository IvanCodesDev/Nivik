import { rectOf, unionRects } from './geom';
import { type Id, newDiagramId } from './ids';
import {
  DIAGRAM_SCHEMA_VERSION,
  type Diagram,
  LayoutSpecSchema,
  ThemeSpecSchema,
} from './schema/diagram';
import type { DiagramEdge, DiagramGroup, DiagramNode } from './schema/elements';
import type { DiagramType } from './schema/enums';
import type { Rect } from './schema/geometry';

export interface CreateDiagramInit {
  name: string;
  type: DiagramType;
  id?: Id;
  /** Epoch ms used for `meta.createdAt` / `updatedAt`; defaults to `Date.now()`. */
  now?: number;
}

/** An empty diagram at version 1 with every default filled in. */
export function createDiagram(init: CreateDiagramInit): Diagram {
  const now = init.now ?? Date.now();
  return {
    schema: DIAGRAM_SCHEMA_VERSION,
    id: init.id ?? newDiagramId(),
    name: init.name,
    type: init.type,
    version: 1,
    nodes: [],
    edges: [],
    groups: [],
    layout: LayoutSpecSchema.parse({}),
    theme: ThemeSpecSchema.parse({}),
    renderer: { preferred: 'excalidraw', state: {} },
    sources: [],
    meta: { createdAt: now, updatedAt: now },
  };
}

export interface DiagramIndex {
  nodes: Map<Id, DiagramNode>;
  edges: Map<Id, DiagramEdge>;
  groups: Map<Id, DiagramGroup>;
  /** Children (nodes first, then groups) per parent; top-level elements live under `null`. */
  byParent: Map<Id | null, Id[]>;
  /** Incident edge ids per node, in edge order. */
  edgesByNode: Map<Id, Id[]>;
}

/** O(n) lookup structures shared by apply / layout / renderer adapters. */
export function indexDiagram(d: Diagram): DiagramIndex {
  const byParent = new Map<Id | null, Id[]>();
  const push = (parent: Id | null, id: Id) => {
    const list = byParent.get(parent);
    if (list) list.push(id);
    else byParent.set(parent, [id]);
  };
  for (const n of d.nodes) push(n.parent, n.id);
  for (const g of d.groups) push(g.parent, g.id);

  const edgesByNode = new Map<Id, Id[]>();
  const incident = (nodeId: Id, edgeId: Id) => {
    const list = edgesByNode.get(nodeId);
    if (list) list.push(edgeId);
    else edgesByNode.set(nodeId, [edgeId]);
  };
  for (const e of d.edges) {
    incident(e.source, e.id);
    if (e.target !== e.source) incident(e.target, e.id);
  }

  return {
    nodes: new Map(d.nodes.map((n) => [n.id, n])),
    edges: new Map(d.edges.map((e) => [e.id, e])),
    groups: new Map(d.groups.map((g) => [g.id, g])),
    byParent,
    edgesByNode,
  };
}

export const childrenOf = (d: Diagram, groupId: Id): Id[] => [
  ...d.nodes.filter((n) => n.parent === groupId).map((n) => n.id),
  ...d.groups.filter((g) => g.parent === groupId).map((g) => g.id),
];

/** All nested elements of a group, depth-first (each group's children before descending into it). */
export function descendantsOf(d: Diagram, groupId: Id): Id[] {
  const groupIds = new Set(d.groups.map((g) => g.id));
  const out: Id[] = [];
  const visit = (id: Id) => {
    for (const child of childrenOf(d, id)) {
      out.push(child);
      if (groupIds.has(child)) visit(child);
    }
  };
  visit(groupId);
  return out;
}

/** Bounding box of the laid-out elements among `ids` (unplaced ones are ignored). */
export function boundsOf(d: Diagram, ids: readonly Id[]): Rect | null {
  const wanted = new Set(ids);
  const rects: Rect[] = [];
  for (const element of [...d.nodes, ...d.groups]) {
    if (!wanted.has(element.id)) continue;
    const rect = rectOf(element);
    if (rect) rects.push(rect);
  }
  return unionRects(rects);
}

/** Node ids reachable from `ids` within `hops` undirected edge hops, seeds included, BFS order. */
export function neighborhood(d: Diagram, ids: readonly Id[], hops: number): Id[] {
  const index = indexDiagram(d);
  const seen = new Set<Id>(ids.filter((id) => index.nodes.has(id)));
  let frontier = [...seen];
  for (let step = 0; step < hops && frontier.length > 0; step += 1) {
    const next: Id[] = [];
    for (const nodeId of frontier) {
      for (const edgeId of index.edgesByNode.get(nodeId) ?? []) {
        const e = index.edges.get(edgeId);
        if (!e) continue;
        const other = e.source === nodeId ? e.target : e.source;
        if (!seen.has(other) && index.nodes.has(other)) {
          seen.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return [...seen];
}
