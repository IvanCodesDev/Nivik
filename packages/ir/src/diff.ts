import type {
  Action,
  ChangeSet,
  EdgeInput,
  EdgePatch,
  GroupInput,
  GroupPatch,
  LayoutPatch,
  NodeInput,
  NodePatch,
  StylePatch,
  ThemePatch,
} from './changeset';
import { type DiagramIndex, indexDiagram } from './helpers';
import type { Id } from './ids';
import type {
  Diagram,
  DiagramEdge,
  DiagramGroup,
  DiagramNode,
  Origin,
  StyleTokens,
} from './schema';

export interface DiffOptions {
  /**
   * Who the resulting change set is attributed to. `user` / `import` express geometry with
   * `moveNode` / `resizeNode` (which pin the node, as a drag would); `system` writes it with one
   * `applyLayout` and can also clear geometry. Default `user`.
   */
  origin?: Origin;
  id?: string;
  runId?: string;
  /** `createdAt` of the change set; defaults to `b.meta.updatedAt`. */
  now?: number;
  /** Overrides the auto-generated summary. */
  summary?: string;
}

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

/**
 * Minimal change set turning `a` into `b` (spec 02 section 5.2): renderer reconcile, import merge and the
 * version-compare view share it. `meta` and edge `route`s are ignored. Returns `null` when the two
 * diagrams are equivalent. A cell change clears the element's position on apply; `b`'s pixels are
 * re-derived by the layout engine, not carried by the diff.
 */
export function diffDiagrams(a: Diagram, b: Diagram, opts: DiffOptions = {}): ChangeSet | null {
  const origin = opts.origin ?? 'user';
  const ia = indexDiagram(a);
  const ib = indexDiagram(b);
  const actions: Action[] = [];
  const counts = new Counts();

  // An edge that survives but hangs off a node that does not would be swept away by the node's
  // delete cascade before any patch could rewire it, so it is deleted and re-added instead.
  const recreatedEdges = new Set(
    a.edges
      .filter((e) => ib.edges.has(e.id) && !(ib.nodes.has(e.source) && ib.nodes.has(e.target)))
      .map((e) => e.id),
  );

  // 1. deletions: edges, nodes, groups (ungroup - children are re-parented explicitly below)
  for (const e of a.edges) {
    if (ib.edges.has(e.id) && !recreatedEdges.has(e.id)) continue;
    actions.push({ op: 'deleteEdge', id: e.id });
    if (!recreatedEdges.has(e.id)) counts.deletedEdges += 1;
  }
  for (const n of a.nodes) {
    if (ib.nodes.has(n.id)) continue;
    actions.push({ op: 'deleteNode', id: n.id });
    counts.deletedNodes += 1;
  }
  for (const g of a.groups) {
    if (ib.groups.has(g.id)) continue;
    actions.push({ op: 'deleteGroup', id: g.id, mode: 'ungroup' });
    counts.deletedGroups += 1;
  }

  // 2. additions: groups (parents first), nodes, edges
  const newGroups = new Map(b.groups.filter((g) => !ia.groups.has(g.id)).map((g) => [g.id, g]));
  const emitted = new Set<Id>();
  const emitGroup = (g: DiagramGroup, trail: Set<Id>) => {
    if (emitted.has(g.id) || trail.has(g.id)) return;
    trail.add(g.id);
    const parent = g.parent ? newGroups.get(g.parent) : undefined;
    if (parent) emitGroup(parent, trail);
    emitted.add(g.id);
    actions.push({ op: 'addGroup', group: stripGroup(g), members: [] });
    counts.addedGroups += 1;
  };
  for (const g of newGroups.values()) emitGroup(g, new Set());
  for (const n of b.nodes) {
    if (ia.nodes.has(n.id)) continue;
    actions.push({ op: 'addNode', node: stripNode(n) });
    counts.addedNodes += 1;
  }
  for (const e of b.edges) {
    if (ia.edges.has(e.id) && !recreatedEdges.has(e.id)) continue;
    actions.push({ op: 'addEdge', edge: stripEdge(e) });
    if (recreatedEdges.has(e.id)) counts.updated += 1;
    else counts.addedEdges += 1;
  }

  // 3. re-parenting of surviving nodes and groups
  actions.push(...reparentActions(b, ia, ib, counts));

  // 4. field patches
  for (const g of b.groups) {
    const before = ia.groups.get(g.id);
    if (!before) continue;
    const patch = groupPatch(before, g);
    if (patch) {
      actions.push({ op: 'updateGroup', id: g.id, patch });
      counts.updated += 1;
    }
  }
  for (const n of b.nodes) {
    const before = ia.nodes.get(n.id);
    if (!before) continue;
    const patch = nodePatch(before, n);
    if (patch) {
      actions.push({ op: 'updateNode', id: n.id, patch });
      counts.updated += 1;
    }
  }
  for (const e of b.edges) {
    const before = ia.edges.get(e.id);
    if (!before || recreatedEdges.has(e.id)) continue;
    const patch = edgePatch(before, e);
    if (patch) {
      actions.push({ op: 'updateEdge', id: e.id, patch });
      counts.updated += 1;
    }
  }

  // 5. styles (merged by identical patch)
  const byStylePatch = new Map<string, Id[]>();
  type Styled = { id: Id; style?: StyleTokens };
  const pair = (el: Styled, before: Styled | undefined): [Styled, Styled | undefined] => [
    el,
    before,
  ];
  const surviving = [
    ...b.nodes.map((n) => pair(n, ia.nodes.get(n.id))),
    ...b.edges.filter((e) => !recreatedEdges.has(e.id)).map((e) => pair(e, ia.edges.get(e.id))),
    ...b.groups.map((g) => pair(g, ia.groups.get(g.id))),
  ];
  for (const [el, before] of surviving) {
    if (!before) continue;
    const patch = stylePatch(before.style, el.style);
    if (!patch) continue;
    const key = JSON.stringify(patch);
    const ids = byStylePatch.get(key);
    if (ids) ids.push(el.id);
    else byStylePatch.set(key, [el.id]);
  }
  for (const [key, targets] of byStylePatch) {
    actions.push({ op: 'setStyle', targets, style: JSON.parse(key) as StylePatch });
    counts.restyled += targets.length;
  }

  // 6. geometry, then pinned state
  actions.push(...geometryActions(b, ia, origin, counts));

  // 7. diagram-level fields
  const diagramPatch = diagramLevelPatch(a, b);
  if (diagramPatch) {
    actions.push({ op: 'setDiagram', patch: diagramPatch });
    counts.diagram = true;
  }

  if (actions.length === 0) return null;
  return {
    id: opts.id ?? `diff_${a.id}_${a.version}_${b.version}`,
    diagramId: a.id,
    baseVersion: a.version,
    origin,
    ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
    actions,
    summary: (opts.summary ?? counts.summary()).slice(0, 300),
    createdAt: opts.now ?? b.meta.updatedAt,
  };
}

// ---------------------------------------------------------------------------

const stripNode = (n: DiagramNode): NodeInput => {
  const { position: _p, size: _s, pinned: _pin, meta: _m, ...rest } = n;
  return rest;
};
const stripEdge = (e: DiagramEdge): EdgeInput => {
  const { route: _r, meta: _m, ...rest } = e;
  return rest;
};
const stripGroup = (g: DiagramGroup): GroupInput => {
  const { position: _p, size: _s, meta: _m, ...rest } = g;
  return rest;
};

/** Keys whose values differ; removed fields become `null`. */
function fieldPatch<T extends object>(before: T, after: T, keys: readonly (keyof T & string)[]) {
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    const x = before[key];
    const y = after[key];
    if (same(x, y)) continue;
    patch[key] = y === undefined ? null : y;
  }
  return Object.keys(patch).length ? patch : null;
}

const nodePatch = (x: DiagramNode, y: DiagramNode) =>
  fieldPatch(x, y, [
    'label',
    'description',
    'role',
    'type',
    'data',
    'semantic',
    'cell',
  ]) as NodePatch | null;
const edgePatch = (x: DiagramEdge, y: DiagramEdge) =>
  fieldPatch(x, y, [
    'label',
    'type',
    'direction',
    'sourceSide',
    'targetSide',
    'data',
    'source',
    'target',
  ]) as EdgePatch | null;
const groupPatch = (x: DiagramGroup, y: DiagramGroup) =>
  fieldPatch(x, y, ['label', 'role', 'collapsed', 'cell']) as GroupPatch | null;

function stylePatch(
  before: StyleTokens | undefined,
  after: StyleTokens | undefined,
): StylePatch | null {
  const x = (before ?? {}) as Record<string, unknown>;
  const y = (after ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (same(x[key], y[key])) continue;
    if (key === 'override' && x[key] !== undefined && y[key] !== undefined) {
      const nested = stylePatch(x[key] as StyleTokens, y[key] as StyleTokens);
      if (nested) patch.override = nested;
      continue;
    }
    patch[key] = y[key] === undefined ? null : y[key];
  }
  return Object.keys(patch).length ? (patch as StylePatch) : null;
}

/** Depth of a group in `b` (0 for top level), used to order re-parenting so no step forms a cycle. */
function depthOf(index: DiagramIndex, groupId: Id | null): number {
  let depth = -1;
  const seen = new Set<Id>();
  let current = groupId;
  while (current && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = index.groups.get(current)?.parent ?? null;
  }
  return depth;
}

function reparentActions(b: Diagram, ia: DiagramIndex, ib: DiagramIndex, counts: Counts): Action[] {
  const byParent = new Map<Id | null, Id[]>();
  const consider = (id: Id, before: Id | null | undefined, after: Id | null) => {
    if (before === undefined || before === after) return;
    const list = byParent.get(after);
    if (list) list.push(id);
    else byParent.set(after, [id]);
  };
  for (const n of b.nodes) consider(n.id, ia.nodes.get(n.id)?.parent, n.parent);
  for (const g of b.groups) consider(g.id, ia.groups.get(g.id)?.parent, g.parent);

  // shallower new parents first: everything above a target is final before anything moves under it
  const entries = [...byParent.entries()].sort(([p], [q]) => depthOf(ib, p) - depthOf(ib, q));
  return entries.map(([parent, ids]) => {
    counts.regrouped += ids.length;
    return { op: 'setParent', ids, parent };
  });
}

function geometryActions(b: Diagram, ia: DiagramIndex, origin: Origin, counts: Counts): Action[] {
  const actions: Action[] = [];
  const pinnedByMove = new Set<Id>();

  if (origin === 'system') {
    const layout: Extract<Action, { op: 'applyLayout' }> = {
      op: 'applyLayout',
      positions: {},
      sizes: {},
      routes: {},
    };
    const touched = new Set<Id>();
    for (const el of [...b.nodes, ...b.groups]) {
      const before = ia.nodes.get(el.id) ?? ia.groups.get(el.id);
      if (!same(before?.position, el.position)) {
        layout.positions[el.id] = el.position ?? null;
        touched.add(el.id);
      }
      if (!same(before?.size, el.size)) {
        layout.sizes[el.id] = el.size ?? null;
        touched.add(el.id);
      }
    }
    if (touched.size) {
      actions.push(layout);
      counts.laidOut += touched.size;
    }
  } else if (origin !== 'ai') {
    for (const n of b.nodes) {
      const before = ia.nodes.get(n.id);
      if (n.position && !same(before?.position, n.position)) {
        actions.push({ op: 'moveNode', id: n.id, position: n.position });
        pinnedByMove.add(n.id);
        counts.moved += 1;
      }
      if (n.size && !same(before?.size, n.size)) {
        actions.push({ op: 'resizeNode', id: n.id, size: n.size });
        pinnedByMove.add(n.id);
        counts.resized += 1;
      }
    }
  }

  const byPinned = new Map<boolean, Id[]>();
  for (const n of b.nodes) {
    const current = pinnedByMove.has(n.id) ? true : (ia.nodes.get(n.id)?.pinned ?? false);
    if (current === n.pinned) continue;
    const list = byPinned.get(n.pinned);
    if (list) list.push(n.id);
    else byPinned.set(n.pinned, [n.id]);
  }
  for (const [pinned, ids] of byPinned) {
    actions.push({ op: 'pinNodes', ids, pinned });
    if (pinned) counts.pinned += ids.length;
    else counts.unpinned += ids.length;
  }
  return actions;
}

function diagramLevelPatch(a: Diagram, b: Diagram) {
  const patch = (fieldPatch(a, b, ['name', 'description', 'type', 'semantic']) ?? {}) as Record<
    string,
    unknown
  >;
  const layout = fieldPatch(a.layout, b.layout, [
    'algorithm',
    'direction',
    'spacing',
    'edgeRouting',
    'autoLayout',
  ]);
  if (layout) patch.layout = layout as LayoutPatch;
  const theme = fieldPatch(a.theme, b.theme, ['preset', 'strokeStyle', 'fontScale']);
  if (theme) patch.theme = theme as ThemePatch;
  return Object.keys(patch).length
    ? (patch as Extract<Action, { op: 'setDiagram' }>['patch'])
    : null;
}

class Counts {
  addedGroups = 0;
  addedNodes = 0;
  addedEdges = 0;
  deletedEdges = 0;
  deletedNodes = 0;
  deletedGroups = 0;
  regrouped = 0;
  updated = 0;
  restyled = 0;
  moved = 0;
  resized = 0;
  laidOut = 0;
  pinned = 0;
  unpinned = 0;
  diagram = false;

  summary(): string {
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const parts: string[] = [];
    const added = [
      this.addedGroups && plural(this.addedGroups, 'group'),
      this.addedNodes && plural(this.addedNodes, 'node'),
      this.addedEdges && plural(this.addedEdges, 'edge'),
    ].filter(Boolean);
    if (added.length) parts.push(`added ${added.join(', ')}`);
    const deleted = [
      this.deletedEdges && plural(this.deletedEdges, 'edge'),
      this.deletedNodes && plural(this.deletedNodes, 'node'),
      this.deletedGroups && plural(this.deletedGroups, 'group'),
    ].filter(Boolean);
    if (deleted.length) parts.push(`deleted ${deleted.join(', ')}`);
    if (this.regrouped) parts.push(`regrouped ${plural(this.regrouped, 'element')}`);
    if (this.updated) parts.push(`updated ${plural(this.updated, 'element')}`);
    if (this.restyled) parts.push(`restyled ${plural(this.restyled, 'element')}`);
    if (this.moved) parts.push(`moved ${plural(this.moved, 'node')}`);
    if (this.resized) parts.push(`resized ${plural(this.resized, 'node')}`);
    if (this.laidOut) parts.push(`laid out ${plural(this.laidOut, 'element')}`);
    if (this.pinned) parts.push(`pinned ${plural(this.pinned, 'node')}`);
    if (this.unpinned) parts.push(`unpinned ${plural(this.unpinned, 'node')}`);
    if (this.diagram) parts.push('changed diagram settings');
    const text = parts.join('; ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
}
