import type { Id } from './ids';
import { SELF_LOOP_EDGE_TYPES } from './schema/enums';

/**
 * The slice of a diagram the structural rules look at. Kept independent of `DiagramSchema` so the
 * schema can embed these checks in its `superRefine` without a circular import.
 */
export interface StructuralView {
  nodes: readonly {
    id: Id;
    type: string;
    parent: Id | null;
    data?: Record<string, unknown> | undefined;
  }[];
  edges: readonly { id: Id; source: Id; target: Id; type: string }[];
  groups: readonly { id: Id; parent: Id | null }[];
}

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  ids: Id[];
  message: string;
}

/** A structural issue also carries the JSON path of the offending element (for Zod issues). */
export interface StructuralIssue extends ValidationIssue {
  severity: 'error';
  path: (string | number)[];
}

type Kind = 'node' | 'edge' | 'group';

const error = (
  code: string,
  ids: Id[],
  message: string,
  path: (string | number)[],
): StructuralIssue => ({ code, severity: 'error', ids, message, path });

/**
 * Structural rules (spec 01 §6.1). Violations make a diagram unusable, so `DiagramSchema` runs
 * these at parse time and `validateDiagram` reports them as errors.
 */
export function structuralIssues(d: StructuralView): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  const kinds = new Map<Id, Kind>();
  const duplicates: Id[] = [];

  const register = (id: Id, kind: Kind) => {
    if (kinds.has(id)) {
      if (!duplicates.includes(id)) duplicates.push(id);
      return;
    }
    kinds.set(id, kind);
  };
  for (const n of d.nodes) register(n.id, 'node');
  for (const e of d.edges) register(e.id, 'edge');
  for (const g of d.groups) register(g.id, 'group');
  if (duplicates.length) {
    issues.push(error('E_ID_COLLISION', duplicates, `Duplicate ids: ${duplicates.join(', ')}`, []));
  }

  const checkRef = (
    owner: Id,
    field: string,
    ref: Id,
    expected: Kind,
    path: (string | number)[],
  ) => {
    const kind = kinds.get(ref);
    if (kind === undefined) {
      issues.push(error('E_UNKNOWN_REF', [owner], `${field} references unknown id "${ref}"`, path));
    } else if (kind !== expected) {
      issues.push(
        error(
          'E_REF_KIND',
          [owner],
          `${field} must reference a ${expected}, "${ref}" is a ${kind}`,
          path,
        ),
      );
    }
  };

  d.nodes.forEach((n, i) => {
    const path = ['nodes', i];
    if (n.parent !== null) checkRef(n.id, 'parent', n.parent, 'group', path);
    if (n.type === 'entity') {
      for (const fk of entityForeignKeys(n.data)) checkRef(n.id, 'columns[].fk', fk, 'node', path);
    }
  });
  d.edges.forEach((e, i) => {
    const path = ['edges', i];
    checkRef(e.id, 'source', e.source, 'node', path);
    checkRef(e.id, 'target', e.target, 'node', path);
    if (e.source === e.target && !(SELF_LOOP_EDGE_TYPES as ReadonlySet<string>).has(e.type)) {
      issues.push(
        error(
          'E_SELF_LOOP',
          [e.id],
          `Edge type "${e.type}" cannot connect "${e.source}" to itself`,
          path,
        ),
      );
    }
  });
  d.groups.forEach((g, i) => {
    if (g.parent !== null) checkRef(g.id, 'parent', g.parent, 'group', ['groups', i]);
  });

  issues.push(...parentCycles(d));
  return issues;
}

function entityForeignKeys(data: Record<string, unknown> | undefined): Id[] {
  const columns = data?.columns;
  if (!Array.isArray(columns)) return [];
  const fks: Id[] = [];
  for (const column of columns) {
    const fk = (column as { fk?: unknown } | null)?.fk;
    if (typeof fk === 'string') fks.push(fk);
  }
  return fks;
}

function parentCycles(d: StructuralView): StructuralIssue[] {
  const parentOf = new Map<Id, Id | null>();
  const indexOf = new Map<Id, number>();
  d.groups.forEach((g, i) => {
    if (!parentOf.has(g.id)) {
      parentOf.set(g.id, g.parent);
      indexOf.set(g.id, i);
    }
  });

  const issues: StructuralIssue[] = [];
  const reported = new Set<Id>();
  for (const start of parentOf.keys()) {
    if (reported.has(start)) continue;
    const trail: Id[] = [];
    let current: Id | null = start;
    while (current !== null && parentOf.has(current) && !trail.includes(current)) {
      trail.push(current);
      current = parentOf.get(current) ?? null;
    }
    if (current === null || !trail.includes(current)) continue;
    const cycle = trail.slice(trail.indexOf(current));
    if (cycle.some((id) => reported.has(id))) continue;
    for (const id of cycle) reported.add(id);
    issues.push(
      error('E_PARENT_CYCLE', cycle, `Group parent chain forms a cycle: ${cycle.join(' -> ')}`, [
        'groups',
        indexOf.get(cycle[0] as Id) ?? 0,
      ]),
    );
  }
  return issues;
}
