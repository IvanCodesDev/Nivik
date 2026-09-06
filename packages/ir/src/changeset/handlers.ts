import type { z } from 'zod';
import type { Id } from '../ids';
import type { Diagram, LayoutSpec, ThemeSpec } from '../schema/diagram';
import {
  type DiagramEdge,
  DiagramEdgeSchema,
  type DiagramGroup,
  type DiagramNode,
  DiagramNodeSchema,
  type ElementMeta,
} from '../schema/elements';
import { SELF_LOOP_EDGE_TYPES } from '../schema/enums';
import type { Point, Size } from '../schema/geometry';
import type { StyleTokens } from '../schema/style';
import type {
  Action,
  ActionOf,
  EdgeInput,
  GroupInput,
  LayoutPatch,
  NodeInput,
  StylePatch,
  ThemePatch,
} from './actions';
import type { ChangeSet } from './changeset';
import { ApplyError, type Draft, type Element } from './draft';

export interface ApplyContext {
  draft: Draft;
  cs: ChangeSet;
  /** `cs.createdAt`, so replays are deterministic. */
  now: number;
  /** Shallow copy of the input diagram; only top-level fields are mutated here. */
  diagram: Diagram;
  hints: Record<Id, Id>;
  relayoutScopes: ('all' | Id[])[];
  structural: boolean;
  fullRelayout: boolean;
  measureIds: Set<Id>;
  diagramChanged: boolean;
}

type ApplyLayoutAction = ActionOf<'applyLayout'>;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const isEmpty = (o: object) => Object.keys(o).length === 0;

const newMeta = (ctx: ApplyContext): ElementMeta => ({
  createdBy: ctx.cs.origin,
  ...(ctx.cs.runId !== undefined ? { runId: ctx.cs.runId } : {}),
  createdAt: ctx.now,
  updatedAt: ctx.now,
  rev: 0,
});

const bump = (meta: ElementMeta, now: number): ElementMeta => ({
  ...meta,
  rev: meta.rev + 1,
  updatedAt: now,
});

function validateElement(schema: z.ZodType, value: unknown, what: string): void {
  const result = schema.safeParse(value);
  if (result.success) return;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  throw new ApplyError(
    'E_INVALID_ACTION',
    `${what} is invalid: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    { issues },
  );
}

function assertOrigin(ctx: ApplyContext, allowed: boolean, op: string): void {
  if (!allowed) {
    throw new ApplyError(
      'E_INVALID_ACTION',
      `"${op}" is not allowed in a change set with origin "${ctx.cs.origin}"`,
      { op, origin: ctx.cs.origin },
    );
  }
}

/**
 * Shallow-merges a patch where `null` clears a field. Returns the merged object and the inverse
 * patch (old values, `null` where the field did not exist).
 */
function mergePatch<T extends object>(
  current: T,
  patch: Record<string, unknown>,
): { next: T; inverse: Record<string, unknown> } {
  const source = current as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };
  const inverse: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const old = source[key];
    inverse[key] = old === undefined ? null : old;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return { next: next as T, inverse };
}

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

const emptyLayout = (): ApplyLayoutAction => ({
  op: 'applyLayout',
  positions: {},
  sizes: {},
  routes: {},
});

/** Records the current geometry of elements into an applyLayout action (for restoration). */
function captureGeometry(into: ApplyLayoutAction, elements: Iterable<Element>): ApplyLayoutAction {
  for (const el of elements) {
    if ('source' in el) {
      if (el.route) into.routes[el.id] = el.route.points;
    } else {
      if (el.position) into.positions[el.id] = el.position;
      if (el.size) into.sizes[el.id] = el.size;
    }
  }
  return into;
}

const hasGeometry = (a: ApplyLayoutAction) =>
  !isEmpty(a.positions) || !isEmpty(a.sizes) || !isEmpty(a.routes);

/** Groups ids by a key, preserving first-appearance order. */
function groupBy<K>(ids: readonly Id[], keyOf: (id: Id) => K): Map<K, Id[]> {
  const out = new Map<K, Id[]>();
  for (const id of ids) {
    const key = keyOf(id);
    const list = out.get(key);
    if (list) list.push(id);
    else out.set(key, [id]);
  }
  return out;
}

const setParentActions = (byParent: Map<Id | null, Id[]>): Action[] =>
  [...byParent.entries()].map(([parent, ids]) => ({ op: 'setParent', ids, parent }));

const pinActions = (byPinned: Map<boolean, Id[]>): Action[] =>
  [...byPinned.entries()].map(([pinned, ids]) => ({ op: 'pinNodes', ids, pinned }));

// ---------------------------------------------------------------------------
// nodes
// ---------------------------------------------------------------------------

function addNode(ctx: ApplyContext, action: ActionOf<'addNode'>): Action[] {
  const { draft } = ctx;
  const { near, ...input } = action.node;
  const parent = input.parent ?? null;
  draft.requireFree(input.id);
  if (parent !== null) draft.requireGroup(parent, 'parent');
  if (near !== undefined) draft.requireNode(near, 'near');

  const node: DiagramNode = { ...input, parent, pinned: false, meta: newMeta(ctx) };
  validateElement(DiagramNodeSchema, node, `node "${node.id}"`);
  draft.addNode(node);
  if (near !== undefined) ctx.hints[node.id] = near;
  ctx.structural = true;
  return [{ op: 'deleteNode', id: node.id }];
}

function updateNode(ctx: ApplyContext, action: ActionOf<'updateNode'>): Action[] {
  const current = ctx.draft.requireNode(action.id);
  const { next, inverse } = mergePatch(current, action.patch);
  next.meta = bump(current.meta, ctx.now);
  validateElement(DiagramNodeSchema, next, `node "${action.id}"`);
  ctx.draft.putNode(next);
  if ('label' in action.patch || 'type' in action.patch || 'data' in action.patch) {
    ctx.measureIds.add(action.id);
  }
  return [{ op: 'updateNode', id: action.id, patch: inverse as ActionOf<'updateNode'>['patch'] }];
}

function deleteNode(ctx: ApplyContext, action: ActionOf<'deleteNode'>): Action[] {
  const { draft } = ctx;
  const node = draft.requireNode(action.id);
  const incident = draft.incidentEdges(node.id);
  draft.deleteNode(node.id);
  for (const e of incident) draft.deleteEdge(e.id);

  const inverse: Action[] = [{ op: 'addNode', node: stripNode(node) }];
  for (const e of incident) inverse.push({ op: 'addEdge', edge: stripEdge(e) });
  const geometry = captureGeometry(emptyLayout(), [node, ...incident]);
  if (hasGeometry(geometry)) inverse.push(geometry);
  if (node.pinned) inverse.push({ op: 'pinNodes', ids: [node.id], pinned: true });
  return inverse;
}

function moveNode(ctx: ApplyContext, action: ActionOf<'moveNode'>): Action[] {
  assertOrigin(ctx, ctx.cs.origin !== 'ai', 'moveNode');
  const current = ctx.draft.requireNode(action.id);
  ctx.draft.putNode({
    ...current,
    position: action.position,
    pinned: true,
    meta: bump(current.meta, ctx.now),
  });
  const restore: Action = current.position
    ? { op: 'moveNode', id: action.id, position: current.position }
    : { ...emptyLayout(), positions: { [action.id]: null } };
  return [restore, { op: 'pinNodes', ids: [action.id], pinned: current.pinned }];
}

function resizeNode(ctx: ApplyContext, action: ActionOf<'resizeNode'>): Action[] {
  assertOrigin(ctx, ctx.cs.origin !== 'ai', 'resizeNode');
  const current = ctx.draft.requireNode(action.id);
  ctx.draft.putNode({
    ...current,
    size: action.size,
    pinned: true,
    meta: bump(current.meta, ctx.now),
  });
  const restore: Action = current.size
    ? { op: 'resizeNode', id: action.id, size: current.size }
    : { ...emptyLayout(), sizes: { [action.id]: null } };
  return [restore, { op: 'pinNodes', ids: [action.id], pinned: current.pinned }];
}

function pinNodes(ctx: ApplyContext, action: ActionOf<'pinNodes'>): Action[] {
  const nodes = action.ids.map((id) => ctx.draft.requireNode(id));
  const byOld = groupBy(action.ids, (id) => (ctx.draft.nodes.get(id) as DiagramNode).pinned);
  for (const n of nodes) ctx.draft.putNode({ ...n, pinned: action.pinned });
  return pinActions(byOld);
}

// ---------------------------------------------------------------------------
// edges
// ---------------------------------------------------------------------------

function checkEndpoints(
  draft: Draft,
  edge: { id: Id; source: Id; target: Id; type: string },
): void {
  draft.requireNode(edge.source, 'source');
  draft.requireNode(edge.target, 'target');
  if (
    edge.source === edge.target &&
    !(SELF_LOOP_EDGE_TYPES as ReadonlySet<string>).has(edge.type)
  ) {
    throw new ApplyError(
      'E_SELF_LOOP',
      `edge "${edge.id}" of type "${edge.type}" cannot connect "${edge.source}" to itself`,
      { id: edge.id, type: edge.type },
    );
  }
}

function addEdge(ctx: ApplyContext, action: ActionOf<'addEdge'>): Action[] {
  const { draft } = ctx;
  draft.requireFree(action.edge.id);
  checkEndpoints(draft, action.edge);
  const edge: DiagramEdge = { ...action.edge, meta: newMeta(ctx) };
  validateElement(DiagramEdgeSchema, edge, `edge "${edge.id}"`);
  draft.addEdge(edge);
  ctx.structural = true;
  return [{ op: 'deleteEdge', id: edge.id }];
}

const ENDPOINT_KEYS = ['source', 'target', 'sourceSide', 'targetSide'] as const;

function updateEdge(ctx: ApplyContext, action: ActionOf<'updateEdge'>): Action[] {
  const current = ctx.draft.requireEdge(action.id);
  const { next, inverse } = mergePatch(current, action.patch);
  checkEndpoints(ctx.draft, next);
  const endpointsChanged = ENDPOINT_KEYS.some((key) => action.patch[key] !== undefined);
  const clearedRoute = endpointsChanged ? current.route : undefined;
  if (endpointsChanged) delete next.route;
  next.meta = bump(current.meta, ctx.now);
  validateElement(DiagramEdgeSchema, next, `edge "${action.id}"`);
  ctx.draft.putEdge(next);
  if (action.patch.source !== undefined || action.patch.target !== undefined) ctx.structural = true;

  const actions: Action[] = [
    { op: 'updateEdge', id: action.id, patch: inverse as ActionOf<'updateEdge'>['patch'] },
  ];
  if (clearedRoute)
    actions.push({ ...emptyLayout(), routes: { [action.id]: clearedRoute.points } });
  return actions;
}

function deleteEdge(ctx: ApplyContext, action: ActionOf<'deleteEdge'>): Action[] {
  const edge = ctx.draft.requireEdge(action.id);
  ctx.draft.deleteEdge(edge.id);
  const inverse: Action[] = [{ op: 'addEdge', edge: stripEdge(edge) }];
  if (edge.route) inverse.push({ ...emptyLayout(), routes: { [edge.id]: edge.route.points } });
  return inverse;
}

// ---------------------------------------------------------------------------
// groups
// ---------------------------------------------------------------------------

function reparent(ctx: ApplyContext, id: Id, parent: Id | null): void {
  const { draft } = ctx;
  const element = draft.require(id, ['node', 'group'], 'ids');
  if ('source' in element) return;
  const next = { ...element, parent, meta: bump(element.meta, ctx.now) };
  if (draft.kindOf(id) === 'node') draft.putNode(next as DiagramNode);
  else draft.putGroup(next as DiagramGroup);
}

function addGroup(ctx: ApplyContext, action: ActionOf<'addGroup'>): Action[] {
  const { draft } = ctx;
  const input = action.group;
  const parent = input.parent ?? null;
  draft.requireFree(input.id);
  if (parent !== null) draft.requireGroup(parent, 'parent');
  const oldParents = new Map<Id, Id | null>();
  for (const member of action.members) {
    const element = draft.require(member, ['node', 'group'], 'members');
    if ('source' in element) continue;
    if (draft.kindOf(member) === 'group' && draft.chainContains(parent, member)) {
      throw new ApplyError(
        'E_PARENT_CYCLE',
        `group "${member}" is an ancestor of the new group "${input.id}" and cannot become its member`,
        { group: input.id, member },
      );
    }
    oldParents.set(member, element.parent);
  }

  draft.addGroup({ ...input, parent, meta: newMeta(ctx) });
  for (const member of action.members) reparent(ctx, member, input.id);
  ctx.structural = true;

  const byOldParent = groupBy(action.members, (id) => oldParents.get(id) ?? null);
  return [{ op: 'deleteGroup', id: input.id, mode: 'ungroup' }, ...setParentActions(byOldParent)];
}

function updateGroup(ctx: ApplyContext, action: ActionOf<'updateGroup'>): Action[] {
  const current = ctx.draft.requireGroup(action.id);
  const { next, inverse } = mergePatch(current, action.patch);
  next.meta = bump(current.meta, ctx.now);
  ctx.draft.putGroup(next);
  return [{ op: 'updateGroup', id: action.id, patch: inverse as ActionOf<'updateGroup'>['patch'] }];
}

function deleteGroup(ctx: ApplyContext, action: ActionOf<'deleteGroup'>): Action[] {
  const { draft } = ctx;
  const group = draft.requireGroup(action.id);
  ctx.structural = true;

  if (action.mode === 'ungroup') {
    const children = draft.childrenOf(group.id);
    draft.deleteGroup(group.id);
    for (const child of children) reparent(ctx, child, group.parent);
    const inverse: Action[] = [{ op: 'addGroup', group: stripGroup(group), members: children }];
    const geometry = captureGeometry(emptyLayout(), [group]);
    if (hasGeometry(geometry)) inverse.push(geometry);
    return inverse;
  }

  // cascade: every nested group, every node inside any of them, and the edges touching those nodes
  const groupIds = draft.groupSubtree(group.id);
  const groupSet = new Set(groupIds);
  const groups = groupIds.map((id) => draft.groups.get(id) as DiagramGroup);
  const nodes = [...draft.nodes.values()].filter(
    (n) => n.parent !== null && groupSet.has(n.parent),
  );
  const nodeSet = new Set(nodes.map((n) => n.id));
  const edges = [...draft.edges.values()].filter(
    (e) => nodeSet.has(e.source) || nodeSet.has(e.target),
  );

  for (const g of groups) draft.deleteGroup(g.id);
  for (const n of nodes) draft.deleteNode(n.id);
  for (const e of edges) draft.deleteEdge(e.id);

  const inverse: Action[] = groups.map((g) => ({
    op: 'addGroup',
    group: stripGroup(g),
    members: [],
  }));
  for (const n of nodes) inverse.push({ op: 'addNode', node: stripNode(n) });
  for (const e of edges) inverse.push({ op: 'addEdge', edge: stripEdge(e) });
  const geometry = captureGeometry(emptyLayout(), [...groups, ...nodes, ...edges]);
  if (hasGeometry(geometry)) inverse.push(geometry);
  const pinned = nodes.filter((n) => n.pinned).map((n) => n.id);
  if (pinned.length) inverse.push({ op: 'pinNodes', ids: pinned, pinned: true });
  return inverse;
}

function setParent(ctx: ApplyContext, action: ActionOf<'setParent'>): Action[] {
  const { draft } = ctx;
  if (action.parent !== null) draft.requireGroup(action.parent, 'parent');
  const oldParents = new Map<Id, Id | null>();
  for (const id of action.ids) {
    const element = draft.require(id, ['node', 'group'], 'ids');
    if ('source' in element) continue;
    if (
      draft.kindOf(id) === 'group' &&
      action.parent !== null &&
      draft.chainContains(action.parent, id)
    ) {
      throw new ApplyError(
        'E_PARENT_CYCLE',
        `moving group "${id}" under "${action.parent}" would create a cycle`,
        { id, parent: action.parent },
      );
    }
    oldParents.set(id, element.parent);
  }
  for (const id of action.ids) reparent(ctx, id, action.parent);
  ctx.structural = true;
  return setParentActions(groupBy(action.ids, (id) => oldParents.get(id) ?? null));
}

// ---------------------------------------------------------------------------
// style / layout / diagram
// ---------------------------------------------------------------------------

/** Applies a style patch (`null` clears) and returns the merged tokens plus the inverse patch. */
function mergeStyle(
  current: StyleTokens | undefined,
  patch: StylePatch,
): { next: StyleTokens | undefined; inverse: StylePatch } {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  const inverse: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const old = (current as Record<string, unknown> | undefined)?.[key];
    if (key === 'override' && value !== null && typeof value === 'object') {
      // nested shallow merge; nulls inside the patch must never reach the stored style
      const merged = mergeStyle((old ?? {}) as StyleTokens, value as StylePatch);
      if (merged.next) next.override = merged.next;
      else delete next.override;
      inverse.override = old === undefined ? null : merged.inverse;
      continue;
    }
    inverse[key] = old === undefined ? null : old;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return {
    next: isEmpty(next) ? undefined : (next as StyleTokens),
    inverse: inverse as StylePatch,
  };
}

function setStyle(ctx: ApplyContext, action: ActionOf<'setStyle'>): Action[] {
  const { draft } = ctx;
  const inverses = new Map<Id, StylePatch>();
  for (const id of action.targets) {
    const element = draft.require(id, ['node', 'edge', 'group'], 'targets');
    const { next, inverse } = mergeStyle(element.style, action.style);
    inverses.set(id, inverse);
    const updated = { ...element, meta: bump(element.meta, ctx.now) } as Element;
    if (next) updated.style = next;
    else delete updated.style;
    const kind = draft.kindOf(id);
    if (kind === 'node') draft.putNode(updated as DiagramNode);
    else if (kind === 'edge') draft.putEdge(updated as DiagramEdge);
    else draft.putGroup(updated as DiagramGroup);
  }
  const byInverse = groupBy(action.targets, (id) => JSON.stringify(inverses.get(id)));
  return [...byInverse.entries()].map(([key, targets]) => ({
    op: 'setStyle',
    targets,
    style: JSON.parse(key) as StylePatch,
  }));
}

/** Nodes inside a group at any depth. */
function nodesUnder(draft: Draft, groupId: Id): DiagramNode[] {
  const groups = new Set(draft.groupSubtree(groupId));
  return [...draft.nodes.values()].filter((n) => n.parent !== null && groups.has(n.parent));
}

function relayout(ctx: ApplyContext, action: ActionOf<'relayout'>): Action[] {
  const { draft } = ctx;
  const scopeNodes = new Map<Id, DiagramNode>();
  if (action.scope === 'all') {
    for (const n of draft.nodes.values()) scopeNodes.set(n.id, n);
  } else {
    for (const id of action.scope) {
      const element = draft.require(id, ['node', 'group'], 'scope');
      if (draft.kindOf(id) === 'node') scopeNodes.set(id, element as DiagramNode);
      else for (const n of nodesUnder(draft, id)) scopeNodes.set(n.id, n);
    }
  }
  for (const [nodeId, anchor] of Object.entries(action.near ?? {})) {
    draft.requireNode(nodeId, 'near');
    draft.requireNode(anchor, 'near');
    ctx.hints[nodeId] = anchor;
  }

  const restore = emptyLayout();
  const cleared = new Set<Id>();
  for (const n of scopeNodes.values()) {
    if (n.pinned || !n.position) continue;
    restore.positions[n.id] = n.position;
    const { position: _p, ...rest } = n;
    draft.putNode(rest);
    cleared.add(n.id);
  }
  for (const e of draft.edges.values()) {
    if (!e.route || !(cleared.has(e.source) || cleared.has(e.target))) continue;
    restore.routes[e.id] = e.route.points;
    const { route: _r, ...rest } = e;
    draft.putEdge(rest);
  }

  const inverse: Action[] = [];
  if (action.layout) {
    const { next, inverse: oldLayout } = mergePatch(ctx.diagram.layout, action.layout);
    ctx.diagram.layout = next as LayoutSpec;
    ctx.diagramChanged = true;
    inverse.push({ op: 'setDiagram', patch: { layout: oldLayout as LayoutPatch } });
  }
  if (hasGeometry(restore)) inverse.push(restore);
  ctx.relayoutScopes.push(action.scope);
  return inverse;
}

const samePoint = (a: Point | undefined, b: Point) => a?.x === b.x && a?.y === b.y;
const sameSize = (a: Size | undefined, b: Size) => a?.w === b.w && a?.h === b.h;
const sameRoute = (a: Point[] | undefined, b: Point[]) =>
  a !== undefined && a.length === b.length && a.every((p, i) => samePoint(p, b[i] as Point));

function applyLayout(ctx: ApplyContext, action: ActionOf<'applyLayout'>): Action[] {
  assertOrigin(ctx, ctx.cs.origin === 'system', 'applyLayout');
  const { draft } = ctx;
  const inverse = emptyLayout();

  for (const [id, position] of Object.entries(action.positions)) {
    const element = draft.require(id, ['node', 'group'], 'positions') as DiagramNode | DiagramGroup;
    if (position === null ? element.position === undefined : samePoint(element.position, position))
      continue;
    inverse.positions[id] = element.position ?? null;
    const next = { ...element };
    if (position === null) delete next.position;
    else next.position = position;
    if (draft.kindOf(id) === 'node') draft.putNode(next as DiagramNode);
    else draft.putGroup(next as DiagramGroup);
  }
  for (const [id, size] of Object.entries(action.sizes)) {
    const element = draft.require(id, ['node', 'group'], 'sizes') as DiagramNode | DiagramGroup;
    if (size === null ? element.size === undefined : sameSize(element.size, size)) continue;
    inverse.sizes[id] = element.size ?? null;
    const next = { ...element };
    if (size === null) delete next.size;
    else next.size = size;
    if (draft.kindOf(id) === 'node') draft.putNode(next as DiagramNode);
    else draft.putGroup(next as DiagramGroup);
  }
  for (const [id, points] of Object.entries(action.routes)) {
    const edge = draft.requireEdge(id, 'routes');
    if (points === null ? edge.route === undefined : sameRoute(edge.route?.points, points))
      continue;
    inverse.routes[id] = edge.route?.points ?? null;
    const next = { ...edge };
    if (points === null) delete next.route;
    else next.route = { points };
    draft.putEdge(next);
  }
  return [inverse];
}

function setDiagram(ctx: ApplyContext, action: ActionOf<'setDiagram'>): Action[] {
  const { layout, theme, ...rest } = action.patch;
  const { next, inverse } = mergePatch(ctx.diagram, rest);
  const inversePatch: Record<string, unknown> = inverse;
  if (layout) {
    const merged = mergePatch(ctx.diagram.layout, layout);
    next.layout = merged.next as LayoutSpec;
    inversePatch.layout = merged.inverse as LayoutPatch;
    ctx.fullRelayout = true;
  }
  if (theme) {
    const merged = mergePatch(ctx.diagram.theme, theme);
    next.theme = merged.next as ThemeSpec;
    inversePatch.theme = merged.inverse as ThemePatch;
  }
  if (rest.type !== undefined && rest.type !== ctx.diagram.type) ctx.fullRelayout = true;
  ctx.diagram = next;
  ctx.diagramChanged = true;
  return [{ op: 'setDiagram', patch: inversePatch as ActionOf<'setDiagram'>['patch'] }];
}

// ---------------------------------------------------------------------------

/** Applies one action to the draft and returns its inverse actions (in the order they must run). */
export function applyAction(ctx: ApplyContext, action: Action): Action[] {
  switch (action.op) {
    case 'addNode':
      return addNode(ctx, action);
    case 'updateNode':
      return updateNode(ctx, action);
    case 'deleteNode':
      return deleteNode(ctx, action);
    case 'moveNode':
      return moveNode(ctx, action);
    case 'resizeNode':
      return resizeNode(ctx, action);
    case 'pinNodes':
      return pinNodes(ctx, action);
    case 'addEdge':
      return addEdge(ctx, action);
    case 'updateEdge':
      return updateEdge(ctx, action);
    case 'deleteEdge':
      return deleteEdge(ctx, action);
    case 'addGroup':
      return addGroup(ctx, action);
    case 'updateGroup':
      return updateGroup(ctx, action);
    case 'deleteGroup':
      return deleteGroup(ctx, action);
    case 'setParent':
      return setParent(ctx, action);
    case 'setStyle':
      return setStyle(ctx, action);
    case 'relayout':
      return relayout(ctx, action);
    case 'applyLayout':
      return applyLayout(ctx, action);
    case 'setDiagram':
      return setDiagram(ctx, action);
    default: {
      const unknown: never = action;
      throw new ApplyError('E_INVALID_ACTION', `unknown action ${JSON.stringify(unknown)}`);
    }
  }
}
