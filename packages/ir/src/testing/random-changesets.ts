/**
 * Deterministic generator of *valid* random change sets, used by the replay / undo property tests
 * (spec 02 搂10). Every action is generated against the diagram state it will actually see, so the
 * generated change set must apply cleanly; a failure means a bug in `applyChangeSet` (or here).
 */
import type { Action, ChangeSet, StylePatch } from '../changeset';
import { applyChangeSet } from '../changeset/apply';
import type { Id } from '../ids';
import type { Diagram, DiagramGroup, DiagramNode, Origin } from '../schema';

/** mulberry32: tiny seeded PRNG, good enough for test data. */
export const rng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Rand = () => number;

const pick = <T>(rand: Rand, list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
const chance = (rand: Rand, p: number) => rand() < p;
const int = (rand: Rand, min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const sample = <T>(rand: Rand, list: readonly T[], n: number): T[] => {
  const copy = [...list];
  const out: T[] = [];
  while (copy.length && out.length < n)
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0] as T);
  return out;
};

const PLAIN_NODE_TYPES = ['box', 'rounded', 'ellipse', 'cylinder', 'hexagon', 'note'] as const;
const PLAIN_EDGE_TYPES = ['flow', 'data', 'dependency', 'link'] as const;
const PALETTES = ['neutral', 'lavender', 'mint', 'sky', 'coral', null] as const;

const chainContains = (groups: Map<Id, DiagramGroup>, start: Id | null, target: Id): boolean => {
  const seen = new Set<Id>();
  let current = start;
  while (current !== null && !seen.has(current)) {
    if (current === target) return true;
    seen.add(current);
    current = groups.get(current)?.parent ?? null;
  }
  return false;
};

const point = (rand: Rand) => ({ x: int(rand, 0, 1200), y: int(rand, 0, 800) });
const size = (rand: Rand) => ({ w: int(rand, 40, 240), h: int(rand, 30, 120) });

export interface Generator {
  /** Produces the next change set against `d`; increments its own counters for fresh ids. */
  next(d: Diagram): ChangeSet;
}

export function randomChangeSets(seed: number): Generator {
  const rand = rng(seed);
  let counter = 0;
  let csCounter = 0;
  const freshId = (prefix: string) => {
    counter += 1;
    return `${prefix}${counter}`;
  };

  function randomAction(d: Diagram, origin: Origin): Action | null {
    const nodes = d.nodes;
    const edges = d.edges;
    const groups = new Map(d.groups.map((g) => [g.id, g]));
    const groupIds = [...groups.keys()];
    const allIds = [...nodes.map((n) => n.id), ...edges.map((e) => e.id), ...groupIds];

    const ops: Action['op'][] = [
      'addNode',
      'addNode',
      'updateNode',
      'updateNode',
      'deleteNode',
      'pinNodes',
      'addEdge',
      'addEdge',
      'updateEdge',
      'deleteEdge',
      'addGroup',
      'updateGroup',
      'deleteGroup',
      'setParent',
      'setStyle',
      'setStyle',
      'relayout',
      'setDiagram',
    ];
    if (origin === 'user') ops.push('moveNode', 'moveNode', 'resizeNode');
    if (origin === 'system') ops.push('applyLayout', 'applyLayout', 'applyLayout');

    const op = pick(rand, ops);
    switch (op) {
      case 'addNode': {
        const id = freshId('rn');
        const parent = groupIds.length && chance(rand, 0.5) ? pick(rand, groupIds) : null;
        const near = nodes.length && chance(rand, 0.3) ? pick(rand, nodes).id : undefined;
        return {
          op,
          node: {
            id,
            type: pick(rand, PLAIN_NODE_TYPES),
            label: `Node ${id}`,
            parent,
            ...(chance(rand, 0.3) ? { role: pick(rand, ['service', 'database', 'queue']) } : {}),
            ...(near ? { near } : {}),
          },
        };
      }
      case 'updateNode': {
        if (!nodes.length) return null;
        const n = pick(rand, nodes);
        const patch: Record<string, unknown> = {};
        if (chance(rand, 0.6)) patch.label = `${n.label}*`;
        if (chance(rand, 0.4)) patch.description = chance(rand, 0.5) ? null : `desc ${counter}`;
        if (chance(rand, 0.3)) patch.role = chance(rand, 0.5) ? null : 'cache';
        if (!Object.keys(patch).length) patch.label = n.label.slice(0, 1) || 'x';
        return { op, id: n.id, patch };
      }
      case 'deleteNode':
        if (nodes.length <= 3) return null;
        return { op, id: pick(rand, nodes).id };
      case 'pinNodes':
        if (!nodes.length) return null;
        return {
          op,
          ids: sample(rand, nodes, int(rand, 1, 2)).map((n) => n.id),
          pinned: chance(rand, 0.5),
        };
      case 'addEdge': {
        if (nodes.length < 2) return null;
        const selfLoop = chance(rand, 0.1);
        const [a, b] = sample(rand, nodes, 2) as [DiagramNode, DiagramNode];
        return {
          op,
          edge: {
            id: freshId('re'),
            source: a.id,
            target: selfLoop ? a.id : b.id,
            type: selfLoop ? 'transition' : pick(rand, PLAIN_EDGE_TYPES),
            direction: pick(rand, ['forward', 'both', 'none']),
            sourceSide: 'auto',
            targetSide: 'auto',
            ...(chance(rand, 0.5) ? { label: `edge ${counter}` } : {}),
          },
        };
      }
      case 'updateEdge': {
        if (!edges.length || nodes.length < 2) return null;
        const e = pick(rand, edges);
        if (chance(rand, 0.5)) {
          const [a, b] = sample(rand, nodes, 2) as [DiagramNode, DiagramNode];
          return {
            op,
            id: e.id,
            patch: { source: a.id, target: b.id, type: pick(rand, PLAIN_EDGE_TYPES) },
          };
        }
        return { op, id: e.id, patch: { label: chance(rand, 0.5) ? null : `edge ${counter}` } };
      }
      case 'deleteEdge':
        if (!edges.length) return null;
        return { op, id: pick(rand, edges).id };
      case 'addGroup': {
        const parent = groupIds.length && chance(rand, 0.4) ? pick(rand, groupIds) : null;
        const memberGroups = groupIds.filter(
          (g) => g !== parent && !chainContains(groups, parent, g),
        );
        const members = [
          ...sample(rand, nodes, int(rand, 0, 3)).map((n) => n.id),
          ...(chance(rand, 0.3) ? sample(rand, memberGroups, 1) : []),
        ];
        const id = freshId('rg');
        return {
          op,
          group: {
            id,
            label: `Group ${id}`,
            role: pick(rand, ['cluster', 'layer', 'boundary']),
            parent,
            collapsed: false,
          },
          members,
        };
      }
      case 'updateGroup': {
        if (!groupIds.length) return null;
        const patch = chance(rand, 0.5)
          ? { label: chance(rand, 0.3) ? null : `G ${counter}` }
          : { collapsed: chance(rand, 0.5) };
        return { op, id: pick(rand, groupIds), patch };
      }
      case 'deleteGroup':
        if (!groupIds.length) return null;
        return { op, id: pick(rand, groupIds), mode: chance(rand, 0.5) ? 'ungroup' : 'cascade' };
      case 'setParent': {
        if (chance(rand, 0.7) || !groupIds.length) {
          if (!nodes.length) return null;
          const parent = groupIds.length && chance(rand, 0.7) ? pick(rand, groupIds) : null;
          return { op, ids: sample(rand, nodes, int(rand, 1, 2)).map((n) => n.id), parent };
        }
        const g = pick(rand, groupIds);
        const candidates = groupIds.filter((p) => p !== g && !chainContains(groups, p, g));
        const parent = candidates.length && chance(rand, 0.7) ? pick(rand, candidates) : null;
        return { op, ids: [g], parent };
      }
      case 'setStyle': {
        if (!allIds.length) return null;
        const style: StylePatch = {};
        if (chance(rand, 0.7)) style.palette = pick(rand, PALETTES);
        if (chance(rand, 0.4)) style.stroke = pick(rand, ['solid', 'dashed', null]);
        if (chance(rand, 0.3))
          style.override = chance(rand, 0.3)
            ? null
            : { fill: chance(rand, 0.5) ? '#aabbcc' : null };
        if (!Object.keys(style).length) style.emphasis = 'strong';
        return { op, targets: sample(rand, allIds, int(rand, 1, 2)), style };
      }
      case 'relayout': {
        const scope =
          chance(rand, 0.2) || !nodes.length
            ? 'all'
            : sample(rand, [...nodes.map((n) => n.id), ...groupIds], int(rand, 1, 3));
        const near =
          nodes.length >= 2 && chance(rand, 0.4)
            ? (() => {
                const [a, b] = sample(rand, nodes, 2) as [DiagramNode, DiagramNode];
                return { [a.id]: b.id };
              })()
            : undefined;
        return {
          op,
          scope,
          ...(chance(rand, 0.3) ? { layout: { direction: pick(rand, ['RIGHT', 'DOWN']) } } : {}),
          ...(near ? { near } : {}),
        };
      }
      case 'setDiagram': {
        const patch: Record<string, unknown> = {};
        if (chance(rand, 0.4)) patch.name = `Diagram ${counter}`;
        if (chance(rand, 0.3)) patch.type = pick(rand, ['architecture', 'flow', 'dataflow']);
        if (chance(rand, 0.3))
          patch.layout = { spacing: pick(rand, ['compact', 'normal', 'loose']) };
        if (chance(rand, 0.3)) patch.description = chance(rand, 0.5) ? null : 'random description';
        if (!Object.keys(patch).length) patch.theme = { fontScale: pick(rand, ['s', 'm', 'l']) };
        return { op, patch };
      }
      case 'moveNode':
        if (!nodes.length) return null;
        return { op, id: pick(rand, nodes).id, position: point(rand) };
      case 'resizeNode':
        if (!nodes.length) return null;
        return { op, id: pick(rand, nodes).id, size: size(rand) };
      case 'applyLayout': {
        const placeable = [...nodes.map((n) => n.id), ...groupIds];
        const positions: Record<Id, { x: number; y: number } | null> = {};
        for (const id of sample(rand, placeable, int(rand, 0, 4)))
          positions[id] = chance(rand, 0.2) ? null : point(rand);
        const sizes: Record<Id, { w: number; h: number } | null> = {};
        for (const id of sample(rand, placeable, int(rand, 0, 2)))
          sizes[id] = chance(rand, 0.2) ? null : size(rand);
        const routes: Record<Id, { x: number; y: number }[] | null> = {};
        for (const e of sample(rand, edges, int(rand, 0, 3))) {
          routes[e.id] = chance(rand, 0.2)
            ? null
            : [point(rand), point(rand), ...(chance(rand, 0.5) ? [point(rand)] : [])];
        }
        return { op, positions, sizes, routes };
      }
      default:
        return null;
    }
  }

  return {
    next(d: Diagram): ChangeSet {
      const origin = pick(rand, ['ai', 'ai', 'user', 'user', 'system', 'import'] as const);
      const count = int(rand, 1, 3);
      csCounter += 1;
      const base: ChangeSet = {
        id: `cs_rand${csCounter}`,
        diagramId: d.id,
        baseVersion: d.version,
        origin,
        ...(origin === 'ai' ? { runId: `run_${csCounter}` } : {}),
        actions: [],
        createdAt: 1_800_000_000_000 + csCounter,
      };
      let state = d;
      for (let attempts = 0; base.actions.length < count && attempts < 50; attempts += 1) {
        const action = randomAction(state, origin);
        if (!action) continue;
        const trial = applyChangeSet(d, { ...base, actions: [...base.actions, action] });
        if (!trial.ok) {
          throw new Error(
            `generator produced an invalid action: ${JSON.stringify(action)} -> ${JSON.stringify(trial.error)}`,
          );
        }
        base.actions.push(action);
        state = trial.diagram;
      }
      if (!base.actions.length) throw new Error('generator could not produce any action');
      return base;
    },
  };
}
