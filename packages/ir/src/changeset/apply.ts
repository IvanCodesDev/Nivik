import { neighborhood } from '../helpers';
import type { Id } from '../ids';
import type { Diagram } from '../schema/diagram';
import { structuralIssues } from '../structural';
import type { Action } from './actions';
import {
  type ApplyResult,
  type ChangeSet,
  type ChangeSetError,
  type ChangeSetErrorCode,
  type LayoutRequest,
  MAX_CHANGE_SET_ACTIONS,
} from './changeset';
import { ApplyError, Draft } from './draft';
import { type ApplyContext, applyAction } from './handlers';

export interface ApplyOptions {
  /** Skip the `baseVersion === diagram.version` check (rebase / "apply anyway" flows). */
  skipVersionCheck?: boolean;
}

const failure = (
  code: ChangeSetErrorCode,
  actionIndex: number | null,
  message: string,
  detail?: Record<string, unknown>,
): ApplyResult => {
  const error: ChangeSetError = { code, actionIndex, message };
  if (detail) error.detail = detail;
  return { ok: false, error };
};

/**
 * Applies a Change Set to a diagram and returns the new diagram, its inverse (undo) Change Set,
 * the affected ids and the layout work it implies (spec 02 §4). Pure: the input is never mutated,
 * untouched elements are shared with the result, and `cs.createdAt` stands in for "now".
 */
export function applyChangeSet(
  diagram: Diagram,
  cs: ChangeSet,
  opts: ApplyOptions = {},
): ApplyResult {
  if (cs.diagramId !== diagram.id) {
    return failure(
      'E_INVALID_ACTION',
      null,
      `change set targets diagram "${cs.diagramId}" but was applied to "${diagram.id}"`,
      { expected: diagram.id, actual: cs.diagramId },
    );
  }
  if (!opts.skipVersionCheck && cs.baseVersion !== diagram.version) {
    return failure(
      'E_BASE_VERSION_MISMATCH',
      null,
      `change set is based on version ${cs.baseVersion} but the diagram is at ${diagram.version}`,
      { expected: diagram.version, actual: cs.baseVersion },
    );
  }
  if (cs.actions.length > MAX_CHANGE_SET_ACTIONS) {
    return failure(
      'E_TOO_MANY_ACTIONS',
      null,
      `change set has ${cs.actions.length} actions (max ${MAX_CHANGE_SET_ACTIONS})`,
    );
  }
  if (cs.actions.length === 0) {
    return failure('E_INVALID_ACTION', null, 'change set has no actions');
  }

  const ctx: ApplyContext = {
    draft: new Draft(diagram),
    cs,
    now: cs.createdAt,
    diagram: { ...diagram },
    hints: {},
    relayoutScopes: [],
    structural: false,
    fullRelayout: false,
    measureIds: new Set(),
    diagramChanged: false,
  };

  const inversePerAction: Action[][] = [];
  for (const [index, action] of cs.actions.entries()) {
    try {
      inversePerAction.push(applyAction(ctx, action));
    } catch (error) {
      if (error instanceof ApplyError) {
        return failure(
          error.code,
          index,
          `action ${index} (${action.op}): ${error.message}`,
          error.detail,
        );
      }
      throw error;
    }
  }

  const next: Diagram = {
    ...ctx.diagram,
    nodes: [...ctx.draft.nodes.values()],
    edges: [...ctx.draft.edges.values()],
    groups: [...ctx.draft.groups.values()],
    version: diagram.version + 1,
    meta: {
      ...diagram.meta,
      updatedAt: ctx.now,
      ...(cs.origin === 'ai' && cs.runId !== undefined ? { lastRunId: cs.runId } : {}),
    },
  };

  // Safety net for reference dangling that only shows up once all actions are combined.
  const [issue] = structuralIssues(next);
  if (issue) {
    return failure(issue.code as ChangeSetErrorCode, null, issue.message, { ids: issue.ids });
  }

  const affected = ctx.draft.affected();
  const inverseActions = inversePerAction.reverse().flat();
  if (inverseActions.length === 0) {
    inverseActions.push({ op: 'applyLayout', positions: {}, sizes: {}, routes: {} });
  }
  const inverse: ChangeSet = {
    id: `inv_${cs.id}`,
    diagramId: cs.diagramId,
    baseVersion: next.version,
    origin: 'system',
    actions: inverseActions,
    createdAt: ctx.now,
    ...(cs.summary !== undefined ? { summary: `Undo: ${cs.summary}`.slice(0, 300) } : {}),
  };

  return {
    ok: true,
    diagram: next,
    inverse,
    affected,
    layoutRequest: layoutRequestFor(ctx, next, affected),
    diagramChanged: ctx.diagramChanged,
  };
}

function layoutRequestFor(
  ctx: ApplyContext,
  next: Diagram,
  affected: { added: Id[]; modified: Id[] },
): LayoutRequest | null {
  const { hints } = ctx;
  if (ctx.relayoutScopes.length > 0) {
    const scope = ctx.relayoutScopes.some((s) => s === 'all')
      ? 'all'
      : [...new Set(ctx.relayoutScopes.flatMap((s) => (s === 'all' ? [] : s)))];
    return { scope, reason: 'relayout', hints };
  }
  if (ctx.fullRelayout) return { scope: 'all', reason: 'structural', hints };
  if (ctx.structural) {
    return {
      scope: neighborhood(next, structuralSeeds(ctx, affected), 1),
      reason: 'structural',
      hints,
    };
  }
  if (ctx.measureIds.size > 0) return { scope: [...ctx.measureIds], reason: 'measure', hints };
  return null;
}

/** Node ids whose surroundings must be re-laid out: touched nodes, endpoints of touched edges, members of touched groups. */
function structuralSeeds(ctx: ApplyContext, affected: { added: Id[]; modified: Id[] }): Id[] {
  const { draft } = ctx;
  const seeds = new Set<Id>();
  for (const id of [...affected.added, ...affected.modified]) {
    const edge = draft.edges.get(id);
    if (edge) {
      seeds.add(edge.source);
      seeds.add(edge.target);
      continue;
    }
    if (draft.nodes.has(id)) {
      seeds.add(id);
      continue;
    }
    if (draft.groups.has(id)) {
      for (const n of draft.nodes.values()) if (n.parent === id) seeds.add(n.id);
    }
  }
  return [...seeds];
}
