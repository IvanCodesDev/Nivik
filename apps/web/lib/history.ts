import { type Action, type ChangeSet, type Diagram, diffDiagrams, type Origin } from '@nivik/ir';

/** How the Detail page groups the change-set vocabulary for people (PRD §5.6 "Add / Update / Delete / Relayout"). */
export const CHANGE_GROUPS = ['added', 'updated', 'deleted', 'layout', 'diagram'] as const;
export type ChangeGroup = (typeof CHANGE_GROUPS)[number];

export type ChangeCounts = Record<ChangeGroup, number>;

const GROUP_OF: Record<Action['op'], ChangeGroup> = {
  addNode: 'added',
  addEdge: 'added',
  addGroup: 'added',
  updateNode: 'updated',
  updateEdge: 'updated',
  updateGroup: 'updated',
  setStyle: 'updated',
  setParent: 'updated',
  deleteNode: 'deleted',
  deleteEdge: 'deleted',
  deleteGroup: 'deleted',
  moveNode: 'layout',
  resizeNode: 'layout',
  pinNodes: 'layout',
  relayout: 'layout',
  applyLayout: 'layout',
  setDiagram: 'diagram',
};

export const emptyCounts = (): ChangeCounts => ({
  added: 0,
  updated: 0,
  deleted: 0,
  layout: 0,
  diagram: 0,
});

/** Counts elements touched, not actions: one `setStyle` over five nodes is five updates. */
export function countChanges(actions: readonly Action[]): ChangeCounts {
  const counts = emptyCounts();
  for (const action of actions) {
    const group = GROUP_OF[action.op];
    const weight =
      'targets' in action && Array.isArray(action.targets)
        ? action.targets.length
        : 'ids' in action && Array.isArray(action.ids)
          ? action.ids.length
          : action.op === 'applyLayout'
            ? Object.keys(action.positions ?? {}).length || 1
            : 1;
    counts[group] += weight;
  }
  return counts;
}

export interface ChangeDescription {
  origin: Origin;
  runId: string | null;
  counts: ChangeCounts;
  /** Labels of the first few added nodes: the most useful hint of what a change was about. */
  highlights: string[];
  summary: string | null;
}

export function describeChangeSet(cs: ChangeSet): ChangeDescription {
  const highlights: string[] = [];
  for (const action of cs.actions) {
    if (action.op === 'addNode' && highlights.length < 3) highlights.push(action.node.label);
  }
  return {
    origin: cs.origin,
    runId: cs.runId ?? null,
    counts: countChanges(cs.actions),
    highlights,
    summary: cs.summary ?? null,
  };
}

export interface VersionComparison {
  /** What it would take to turn `from` into `to`; null when they are the same drawing. */
  changeSet: ChangeSet | null;
  counts: ChangeCounts;
  identical: boolean;
}

/** Spec 06 §3.4 in numbers: a snapshot against the current document. */
export function compareVersions(from: Diagram, to: Diagram): VersionComparison {
  const changeSet = diffDiagrams(from, to, { origin: 'system', now: to.meta.updatedAt });
  return {
    changeSet,
    counts: changeSet ? countChanges(changeSet.actions) : emptyCounts(),
    identical: changeSet === null,
  };
}

export const totalChanges = (counts: ChangeCounts): number =>
  CHANGE_GROUPS.reduce((sum, group) => sum + counts[group], 0);
