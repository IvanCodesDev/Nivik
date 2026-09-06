import type { Id } from '../ids';
import type { Diagram } from '../schema/diagram';
import type { Action } from './actions';
import type { ChangeSet } from './changeset';

/**
 * Ids an action touches or relies on (spec 02 §6.1): the elements it edits plus the source/target/
 * parent/members/near ids it references. Diagram-wide edits (`setDiagram`, `relayout{all}`) are
 * represented by the diagram id itself.
 */
function actionIds(action: Action, diagramId: Id, into: Set<Id>): void {
  switch (action.op) {
    case 'addNode':
      into.add(action.node.id);
      if (action.node.parent) into.add(action.node.parent);
      if (action.node.near) into.add(action.node.near);
      return;
    case 'updateNode':
    case 'deleteNode':
    case 'moveNode':
    case 'resizeNode':
    case 'updateGroup':
    case 'deleteGroup':
    case 'deleteEdge':
      into.add(action.id);
      return;
    case 'pinNodes':
      for (const id of action.ids) into.add(id);
      return;
    case 'addEdge':
      into.add(action.edge.id);
      into.add(action.edge.source);
      into.add(action.edge.target);
      return;
    case 'updateEdge':
      into.add(action.id);
      if (action.patch.source) into.add(action.patch.source);
      if (action.patch.target) into.add(action.patch.target);
      return;
    case 'addGroup':
      into.add(action.group.id);
      if (action.group.parent) into.add(action.group.parent);
      for (const id of action.members) into.add(id);
      return;
    case 'setParent':
      for (const id of action.ids) into.add(id);
      if (action.parent) into.add(action.parent);
      return;
    case 'setStyle':
      for (const id of action.targets) into.add(id);
      return;
    case 'relayout':
      if (action.scope === 'all') into.add(diagramId);
      else for (const id of action.scope) into.add(id);
      for (const [id, anchor] of Object.entries(action.near ?? {})) {
        into.add(id);
        into.add(anchor);
      }
      return;
    case 'setDiagram':
      into.add(diagramId);
      return;
    case 'applyLayout':
      for (const id of Object.keys(action.positions)) into.add(id);
      for (const id of Object.keys(action.sizes)) into.add(id);
      for (const id of Object.keys(action.routes)) into.add(id);
      return;
    default: {
      const unknown: never = action;
      throw new Error(`unknown action ${JSON.stringify(unknown)}`);
    }
  }
}

/** All ids a change set touches or relies on, in first-appearance order. */
export function affectedIds(cs: ChangeSet): Set<Id> {
  const ids = new Set<Id>();
  for (const action of cs.actions) actionIds(action, cs.diagramId, ids);
  return ids;
}

export type RebaseResult =
  | { kind: 'clean'; rebased: ChangeSet }
  | { kind: 'conflict'; conflicts: Id[] };

/**
 * Moves a change set built against an older version onto `current` (spec 02 §6). Clean when none
 * of the ids it touches were touched by the change sets applied in between; otherwise the overlap
 * is reported so the UI can offer regenerate / apply anyway / discard. User change sets never
 * conflict: the user is editing the live diagram.
 */
export function rebaseChangeSet(
  cs: ChangeSet,
  current: Diagram,
  since: readonly ChangeSet[],
): RebaseResult {
  const rebased: ChangeSet =
    cs.baseVersion === current.version ? cs : { ...cs, baseVersion: current.version };
  if (cs.origin === 'user') return { kind: 'clean', rebased };

  const touchedSince = new Set<Id>();
  for (const other of since) for (const id of affectedIds(other)) touchedSince.add(id);

  const conflicts = [...affectedIds(cs)].filter((id) => touchedSince.has(id));
  if (conflicts.length > 0) return { kind: 'conflict', conflicts };
  return { kind: 'clean', rebased };
}
