import {
  cellsIntersect,
  rectContains,
  rectOf,
  rectsIntersect,
  segmentIntersectsRect,
} from './geom';
import { type DiagramIndex, indexDiagram } from './helpers';
import type { Id } from './ids';
import type { Diagram, LayoutSpec } from './schema/diagram';
import { ANNOTATION_NODE_TYPES, type NodeType } from './schema/enums';
import type { ValidationIssue } from './structural';

const MAX_LABEL_CHARS = 60;
const MAX_LABEL_LINES = 3;

/** Layout strategies in which "no edges" means "disconnected"; elsewhere isolated nodes are the design. */
const GRAPH_LAYOUTS: ReadonlySet<LayoutSpec['algorithm']> = new Set(['layered', 'radial']);

/**
 * The only place a diagram type influences validation (spec 01 §6.2, D16 exception): four
 * well-known types whose node vocabulary is fixed. Every other type accepts every shape.
 */
const EXPECTED_NODE_TYPE: Readonly<Record<string, NodeType>> = {
  sequence: 'participant',
  erd: 'entity',
  state: 'state',
  class: 'class',
};

const warn = (code: string, ids: Id[], message: string): ValidationIssue => ({
  code,
  severity: 'warning',
  ids,
  message,
});

const nameOf = (element: { id: Id; label?: string }) =>
  element.label ? `"${element.label}"` : element.id;

/** Quality rules (spec 01 §6.2): they never block, they inform the repair loop and the UI. */
export function qualityIssues(d: Diagram): ValidationIssue[] {
  const index = indexDiagram(d);
  return [
    ...orphanNodes(d, index),
    ...duplicateEdges(d),
    ...overlaps(d),
    ...longLabels(d),
    ...emptyGroups(d, index),
    ...groupEscapes(d, index),
    ...edgeCrossings(d, index),
    ...typeMismatches(d),
  ];
}

function orphanNodes(d: Diagram, index: DiagramIndex): ValidationIssue[] {
  if (d.edges.length === 0 || !GRAPH_LAYOUTS.has(d.layout.algorithm)) return [];
  return d.nodes
    .filter(
      (n) =>
        n.parent === null && !ANNOTATION_NODE_TYPES.has(n.type) && !index.edgesByNode.has(n.id),
    )
    .map((n) =>
      warn('W_ORPHAN_NODE', [n.id], `Node ${nameOf(n)} has no edges and is not in a group`),
    );
}

function duplicateEdges(d: Diagram): ValidationIssue[] {
  const buckets = new Map<string, Id[]>();
  for (const e of d.edges) {
    const key = [e.source, e.target, e.type, e.label ?? ''].join('\u0000');
    const bucket = buckets.get(key);
    if (bucket) bucket.push(e.id);
    else buckets.set(key, [e.id]);
  }
  return [...buckets.values()]
    .filter((ids) => ids.length >= 2)
    .map((ids) => warn('W_DUPLICATE_EDGE', ids, `Edges ${ids.join(', ')} are duplicates`));
}

function overlaps(d: Diagram): ValidationIssue[] {
  const placed = d.nodes.flatMap((n) => {
    const rect = rectOf(n);
    return rect ? [{ node: n, rect }] : [];
  });
  const issues: ValidationIssue[] = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      if (!a || !b || a.node.parent !== b.node.parent) continue;
      // Explicitly intersecting cells are intentional overlap (venn, callouts): not a defect.
      if (a.node.cell && b.node.cell && cellsIntersect(a.node.cell, b.node.cell)) continue;
      if (rectsIntersect(a.rect, b.rect)) {
        issues.push(
          warn(
            'W_OVERLAP',
            [a.node.id, b.node.id],
            `Nodes ${nameOf(a.node)} and ${nameOf(b.node)} overlap`,
          ),
        );
      }
    }
  }
  return issues;
}

function longLabels(d: Diagram): ValidationIssue[] {
  const tooLong = (label: string) =>
    label.length > MAX_LABEL_CHARS || label.split('\n').length > MAX_LABEL_LINES;
  return [...d.nodes, ...d.groups]
    .filter((element) => element.label !== undefined && tooLong(element.label))
    .map((element) =>
      warn(
        'W_LABEL_TOO_LONG',
        [element.id],
        `Label of ${element.id} exceeds ${MAX_LABEL_CHARS} characters or ${MAX_LABEL_LINES} lines`,
      ),
    );
}

function emptyGroups(d: Diagram, index: DiagramIndex): ValidationIssue[] {
  return d.groups
    .filter((g) => !index.byParent.has(g.id))
    .map((g) => warn('W_EMPTY_GROUP', [g.id], `Group ${nameOf(g)} has no children`));
}

function groupEscapes(d: Diagram, index: DiagramIndex): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const n of d.nodes) {
    if (n.parent === null) continue;
    const group = index.groups.get(n.parent);
    const nodeRect = rectOf(n);
    const groupRect = group ? rectOf(group) : null;
    if (!group || !nodeRect || !groupRect) continue;
    if (!rectContains(groupRect, nodeRect)) {
      issues.push(
        warn(
          'W_GROUP_ESCAPE',
          [n.id, group.id],
          `Node ${nameOf(n)} lies outside its group ${nameOf(group)}`,
        ),
      );
    }
  }
  return issues;
}

function edgeCrossings(d: Diagram, index: DiagramIndex): ValidationIssue[] {
  if (d.layout.edgeRouting !== 'orthogonal') return [];
  const placed = d.nodes.flatMap((n) => {
    const rect = rectOf(n);
    return rect ? [{ node: n, rect }] : [];
  });
  const issues: ValidationIssue[] = [];
  for (const e of d.edges) {
    const points = e.route?.points;
    if (!points || !index.nodes.has(e.source) || !index.nodes.has(e.target)) continue;
    for (const { node, rect } of placed) {
      if (node.id === e.source || node.id === e.target) continue;
      const crosses = points.some((p, i) => {
        const q = points[i + 1];
        return q !== undefined && segmentIntersectsRect(p, q, rect);
      });
      if (crosses) {
        issues.push(
          warn(
            'W_EDGE_CROSS_NODE',
            [e.id, node.id],
            `Edge ${e.id} runs through node ${nameOf(node)}`,
          ),
        );
      }
    }
  }
  return issues;
}

function typeMismatches(d: Diagram): ValidationIssue[] {
  const expected = EXPECTED_NODE_TYPE[d.type];
  if (!expected) return [];
  return d.nodes
    .filter((n) => n.type !== expected && !ANNOTATION_NODE_TYPES.has(n.type))
    .map((n) =>
      warn(
        'W_TYPE_MISMATCH',
        [n.id],
        `Node ${nameOf(n)} has type "${n.type}" but a ${d.type} diagram expects "${expected}"`,
      ),
    );
}
