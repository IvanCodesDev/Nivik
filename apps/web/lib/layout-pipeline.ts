import {
  type Affected,
  type ChangeSet,
  type Diagram,
  type Id,
  type LayoutRequest,
  newChangeSetId,
  type Point,
  type Size,
} from '@nivik/ir';
import {
  type ElkEngine,
  type LayoutMode,
  type LayoutResult,
  layoutDiagram,
  type NodeMeasurer,
} from '@nivik/layout';

/**
 * Spec 03 §2 / §6.1: the apply result picks the engine mode. Incremental layouts get the ids the
 * change set actually touched (the engine widens them to a neighbourhood itself); `scope` is the
 * fallback when the caller has no `Affected`.
 */
export function layoutModeFor(request: LayoutRequest, affected: Affected): LayoutMode {
  if (request.scope === 'all') return { kind: 'full' };
  if (request.reason === 'measure') return { kind: 'measure-only', ids: request.scope };
  const touched = [...new Set([...affected.added, ...affected.modified])];
  return {
    kind: 'incremental',
    affected: touched.length > 0 ? touched : request.scope,
    hints: request.hints,
  };
}

export interface LayoutChangeSetMeta {
  runId?: string;
  now: number;
  id?: string;
  summary?: string;
}

const samePoint = (a?: Point, b?: Point) => a?.x === b?.x && a?.y === b?.y;
const sameSize = (a?: Size, b?: Size) => a?.w === b?.w && a?.h === b?.h;

/**
 * Spec 03 §8: one `origin: 'system'` change set carrying every coordinate the layout changed, so
 * history replays without re-running ELK and an AI run undoes as a unit. `null` when nothing moved.
 */
export function layoutChangeSet(
  before: Diagram,
  result: LayoutResult,
  meta: LayoutChangeSetMeta,
): ChangeSet | null {
  const positions: Record<Id, Point> = {};
  const sizes: Record<Id, Size> = {};
  const routes: Record<Id, Point[]> = {};
  const previous = new Map([...before.nodes, ...before.groups].map((e) => [e.id, e]));
  const moved = new Set(result.moved);
  for (const element of [...result.diagram.nodes, ...result.diagram.groups]) {
    if (!moved.has(element.id)) continue;
    const old = previous.get(element.id);
    if (element.position && !samePoint(element.position, old?.position)) {
      positions[element.id] = element.position;
    }
    if (element.size && !sameSize(element.size, old?.size)) sizes[element.id] = element.size;
  }
  const routed = new Set(result.routed);
  for (const edge of result.diagram.edges) {
    if (routed.has(edge.id) && edge.route) routes[edge.id] = edge.route.points;
  }
  if (
    Object.keys(positions).length === 0 &&
    Object.keys(sizes).length === 0 &&
    Object.keys(routes).length === 0
  ) {
    return null;
  }
  return {
    id: meta.id ?? newChangeSetId(),
    diagramId: before.id,
    baseVersion: before.version,
    origin: 'system',
    ...(meta.runId ? { runId: meta.runId } : {}),
    actions: [{ op: 'applyLayout', positions, sizes, routes }],
    summary: meta.summary ?? 'Layout',
    createdAt: meta.now,
  };
}

export interface RunLayoutOptions {
  measurer: NodeMeasurer;
  /** Ids the triggering change set touched (`ApplyResult.affected`); defaults to the request scope. */
  affected?: Affected;
  engine?: ElkEngine;
  signal?: AbortSignal;
  runId?: string;
  now: () => number;
}

export interface RunLayoutOutcome {
  changeSet: ChangeSet | null;
  result: LayoutResult | null;
}

const NO_AFFECTED: Affected = { added: [], modified: [], deleted: [] };

/** Runs the layout a change set asked for and packages it as the system change set to apply next. */
export async function runLayout(
  diagram: Diagram,
  request: LayoutRequest | null,
  opts: RunLayoutOptions,
): Promise<RunLayoutOutcome> {
  if (!request) return { changeSet: null, result: null };
  const result = await layoutDiagram(diagram, {
    mode: layoutModeFor(request, opts.affected ?? NO_AFFECTED),
    measurer: opts.measurer,
    ...(opts.engine ? { engine: opts.engine } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  const changeSet = layoutChangeSet(diagram, result, {
    ...(opts.runId ? { runId: opts.runId } : {}),
    now: opts.now(),
  });
  return { changeSet, result };
}
