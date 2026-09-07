import {
  type Action,
  type ChangeSet,
  type Diagram,
  type EdgePatch,
  type Id,
  type NodeType,
  newChangeSetId,
  type Rect,
  type StyleOverride,
} from '@nivik/ir';
import {
  indexSnapshot,
  type NativeElement,
  type NativeSnapshot,
  type SnapshotIndex,
} from './native';

/** Spec 04 §5.3: how user-drawn elements become IR. */
export interface PromotionRules {
  newNodeId(): Id;
  newEdgeId(): Id;
  newGroupId(): Id;
  /** Node type for promoted shapes the adapter could not classify; default `box`. */
  defaultNodeType?: NodeType;
  /** `false` keeps every unmarked element an annotation; default `true`. */
  promote?: boolean;
}

export interface ReconcileOptions extends PromotionRules {
  now?: number;
  changeSetId?: string;
}

const geometry = (r: Rect) => ({
  position: { x: Math.round(r.x), y: Math.round(r.y) },
  size: { w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) },
});
const sameOverride = (
  a: StyleOverride | null | undefined,
  b: StyleOverride | null | undefined,
): boolean =>
  (a?.fill ?? null) === (b?.fill ?? null) &&
  (a?.stroke ?? null) === (b?.stroke ?? null) &&
  (a?.text ?? null) === (b?.text ?? null);
const trimmed = (label: string | undefined) => label?.trim() ?? '';

/**
 * Spec 04 §5.2: derive IR-level values from the native snapshot, diff them against the IR and turn
 * the differences into a user Change Set. Values the adapter did not report (`undefined`) are not
 * compared, so a snapshot mirroring the IR yields `null` — that is the loop guard.
 */
export function reconcile(
  ir: Diagram,
  snapshot: NativeSnapshot,
  rules: ReconcileOptions,
): ChangeSet | null {
  const index = indexSnapshot(snapshot);
  const actions: Action[] = [];
  const irGroups = new Set(ir.groups.map((g) => g.id));
  const deletedNodes = new Set<Id>();

  /** IR id of a native element that is the live main part of an IR element. */
  const irIdOf = (nativeId: string | undefined): Id | null => {
    if (nativeId === undefined) return null;
    const el = index.byNative.get(nativeId);
    return el?.nivik && el.nivik.part === 'main' && !el.deleted ? el.nivik.id : null;
  };
  /** Group the element sits in; undefined when unknown or when the frame is not (yet) an IR group. */
  const parentOf = (el: NativeElement): Id | null | undefined => {
    if (el.frame === undefined) return undefined;
    if (el.frame === null) return null;
    const groupId = irIdOf(el.frame);
    return groupId !== null && irGroups.has(groupId) ? groupId : undefined;
  };
  const labelOf = (id: Id, main: NativeElement) =>
    main.label ?? index.byIr.get(id)?.parts.get('label')?.label;

  const reparent = new Map<string, { parent: Id | null; ids: Id[] }>();
  for (const n of ir.nodes) {
    const main = index.byIr.get(n.id)?.main;
    if (!main || main.deleted) {
      deletedNodes.add(n.id);
      actions.push({ op: 'deleteNode', id: n.id });
      continue;
    }
    const { position, size } = geometry(main.bounds);
    if (!n.position || n.position.x !== position.x || n.position.y !== position.y) {
      actions.push({ op: 'moveNode', id: n.id, position });
    }
    if (!n.size || n.size.w !== size.w || n.size.h !== size.h) {
      actions.push({ op: 'resizeNode', id: n.id, size });
    }
    const label = labelOf(n.id, main);
    if (label !== undefined && label !== n.label) {
      actions.push({ op: 'updateNode', id: n.id, patch: { label } });
    }
    const parent = parentOf(main);
    if (parent !== undefined && parent !== n.parent) {
      const key = parent ?? '';
      const bucket = reparent.get(key) ?? { parent, ids: [] };
      bucket.ids.push(n.id);
      reparent.set(key, bucket);
    }
    if (main.override !== undefined && !sameOverride(main.override, n.style?.override)) {
      actions.push({ op: 'setStyle', targets: [n.id], style: { override: main.override ?? null } });
    }
  }
  for (const { parent, ids } of reparent.values()) actions.push({ op: 'setParent', ids, parent });

  for (const e of ir.edges) {
    // deleteNode cascades to incident edges; deleting them again would be an unknown reference.
    if (deletedNodes.has(e.source) || deletedNodes.has(e.target)) continue;
    const main = index.byIr.get(e.id)?.main;
    if (!main || main.deleted) {
      actions.push({ op: 'deleteEdge', id: e.id });
      continue;
    }
    const patch: EdgePatch = {};
    if (main.binding) {
      const source = irIdOf(main.binding.start);
      const target = irIdOf(main.binding.end);
      if (source === null || target === null) {
        // One end let go → the arrow becomes an annotation (spec 04 §6.4).
        actions.push({ op: 'deleteEdge', id: e.id });
        continue;
      }
      if (source !== e.source) patch.source = source;
      if (target !== e.target) patch.target = target;
    }
    const label = labelOf(e.id, main);
    if (label !== undefined && label !== (e.label ?? '')) patch.label = label === '' ? null : label;
    if (Object.keys(patch).length > 0) actions.push({ op: 'updateEdge', id: e.id, patch });
  }

  for (const g of ir.groups) {
    const main = index.byIr.get(g.id)?.main;
    if (!main || main.deleted) {
      actions.push({ op: 'deleteGroup', id: g.id, mode: 'ungroup' });
      continue;
    }
    if (main.label !== undefined && main.label !== (g.label ?? '')) {
      actions.push({
        op: 'updateGroup',
        id: g.id,
        patch: { label: main.label === '' ? null : main.label },
      });
    }
  }

  if (rules.promote !== false) promote(ir, index, rules, irIdOf, actions);

  if (actions.length === 0) return null;
  return {
    id: rules.changeSetId ?? newChangeSetId(),
    diagramId: ir.id,
    baseVersion: ir.version,
    origin: 'user',
    actions,
    summary: summarize(actions),
    createdAt: rules.now ?? Date.now(),
  };
}

/** Spec 04 §5.3 promotion: labelled shapes, fully bound arrows, frames around IR nodes. */
function promote(
  ir: Diagram,
  index: SnapshotIndex,
  rules: PromotionRules,
  irIdOf: (nativeId: string | undefined) => Id | null,
  actions: Action[],
): void {
  const live = index.untagged.filter((el) => !el.deleted);
  const irGroups = new Set(ir.groups.map((g) => g.id));
  const promotedNodes = new Map<string, Id>();
  for (const el of live) {
    if (el.kind !== 'shape' || trimmed(el.label) === '') continue;
    const id = rules.newNodeId();
    const frameGroup = el.frame ? irIdOf(el.frame) : null;
    const parent = frameGroup !== null && irGroups.has(frameGroup) ? frameGroup : null;
    actions.push({
      op: 'addNode',
      node: {
        id,
        type: el.shape ?? rules.defaultNodeType ?? 'box',
        label: trimmed(el.label),
        parent,
      },
    });
    const { position, size } = geometry(el.bounds);
    actions.push({ op: 'moveNode', id, position }, { op: 'resizeNode', id, size });
    promotedNodes.set(el.nativeId, id);
  }

  const irNodeIds = new Set([...ir.nodes.map((n) => n.id), ...promotedNodes.values()]);
  const nodeAt = (nativeId: string | undefined): Id | null => {
    if (nativeId === undefined) return null;
    const id = promotedNodes.get(nativeId) ?? irIdOf(nativeId);
    return id !== null && irNodeIds.has(id) ? id : null;
  };
  for (const el of live) {
    if (el.kind !== 'arrow') continue;
    const source = nodeAt(el.binding?.start);
    const target = nodeAt(el.binding?.end);
    if (source === null || target === null || source === target) continue;
    const label = trimmed(el.label);
    actions.push({
      op: 'addEdge',
      edge: {
        id: rules.newEdgeId(),
        source,
        target,
        type: 'flow',
        direction: 'forward',
        sourceSide: 'auto',
        targetSide: 'auto',
        ...(label ? { label } : {}),
      },
    });
  }
  for (const el of live) {
    if (el.kind !== 'frame') continue;
    const members: Id[] = [];
    for (const candidate of index.byNative.values()) {
      if (candidate.frame !== el.nativeId || candidate.deleted) continue;
      const id = nodeAt(candidate.nativeId);
      if (id !== null) members.push(id);
    }
    if (members.length === 0) continue;
    const label = trimmed(el.label);
    actions.push({
      op: 'addGroup',
      group: {
        id: rules.newGroupId(),
        ...(label ? { label } : {}),
        role: 'cluster',
        parent: null,
        collapsed: false,
      },
      members,
    });
  }
}

const VERBS: Partial<Record<Action['op'], [verb: string, noun: string]>> = {
  moveNode: ['moved', 'node'],
  resizeNode: ['resized', 'node'],
  updateNode: ['renamed', 'node'],
  deleteNode: ['deleted', 'node'],
  addNode: ['added', 'node'],
  setParent: ['regrouped', 'node'],
  setStyle: ['recoloured', 'node'],
  updateEdge: ['rewired', 'edge'],
  deleteEdge: ['deleted', 'edge'],
  addEdge: ['added', 'edge'],
  updateGroup: ['renamed', 'group'],
  deleteGroup: ['deleted', 'group'],
  addGroup: ['added', 'group'],
};

/** Human summary for the history entry, e.g. "moved 2 nodes, renamed 1 node". */
export function summarize(actions: readonly Action[]): string {
  const counts = new Map<string, number>();
  for (const a of actions) {
    const entry = VERBS[a.op];
    if (!entry) continue;
    const key = `${entry[0]} ${entry[1]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, n]) => {
      const [verb, noun] = key.split(' ');
      return `${verb} ${n} ${noun}${n === 1 ? '' : 's'}`;
    })
    .join(', ');
}
