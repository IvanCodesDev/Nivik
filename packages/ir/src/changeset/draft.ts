import type { Id } from '../ids';
import type { Diagram } from '../schema/diagram';
import type { DiagramEdge, DiagramGroup, DiagramNode } from '../schema/elements';
import type { Affected, ChangeSetErrorCode } from './changeset';

export type ElementKind = 'node' | 'edge' | 'group';
export type Element = DiagramNode | DiagramEdge | DiagramGroup;

/** Raised by handlers; `applyChangeSet` turns it into a `ChangeSetError`. */
export class ApplyError extends Error {
  constructor(
    readonly code: ChangeSetErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApplyError';
  }
}

/**
 * Mutable working copy of a diagram with copy-on-write elements: untouched elements keep their
 * identity (structural sharing), touched ones are cloned once. Also tracks the affected sets.
 */
export class Draft {
  readonly nodes = new Map<Id, DiagramNode>();
  readonly edges = new Map<Id, DiagramEdge>();
  readonly groups = new Map<Id, DiagramGroup>();

  private readonly cloned = new Set<Id>();
  private readonly added = new Set<Id>();
  private readonly modified = new Set<Id>();
  private readonly deleted = new Set<Id>();

  constructor(base: Diagram) {
    for (const n of base.nodes) this.nodes.set(n.id, n);
    for (const e of base.edges) this.edges.set(e.id, e);
    for (const g of base.groups) this.groups.set(g.id, g);
  }

  kindOf(id: Id): ElementKind | undefined {
    if (this.nodes.has(id)) return 'node';
    if (this.edges.has(id)) return 'edge';
    if (this.groups.has(id)) return 'group';
    return undefined;
  }

  get(id: Id): Element | undefined {
    return this.nodes.get(id) ?? this.edges.get(id) ?? this.groups.get(id);
  }

  /** Resolves `id`, failing with E_UNKNOWN_REF / E_REF_KIND when it is missing or of another kind. */
  require(id: Id, expected: ElementKind | readonly ElementKind[], field: string): Element {
    const kind = this.kindOf(id);
    if (kind === undefined) {
      throw new ApplyError('E_UNKNOWN_REF', `${field} references unknown id "${id}"`, {
        id,
        field,
      });
    }
    const allowed = typeof expected === 'string' ? [expected] : expected;
    if (!allowed.includes(kind)) {
      throw new ApplyError(
        'E_REF_KIND',
        `${field} must reference a ${allowed.join(' or ')}, "${id}" is a ${kind}`,
        { id, field, kind },
      );
    }
    return this.get(id) as Element;
  }

  requireNode(id: Id, field = 'id'): DiagramNode {
    return this.require(id, 'node', field) as DiagramNode;
  }

  requireEdge(id: Id, field = 'id'): DiagramEdge {
    return this.require(id, 'edge', field) as DiagramEdge;
  }

  requireGroup(id: Id, field = 'id'): DiagramGroup {
    return this.require(id, 'group', field) as DiagramGroup;
  }

  requireFree(id: Id): void {
    const kind = this.kindOf(id);
    if (kind !== undefined) {
      throw new ApplyError('E_ID_COLLISION', `id "${id}" is already used by a ${kind}`, {
        id,
        kind,
      });
    }
  }

  // --- writes -------------------------------------------------------------------------------

  addNode(node: DiagramNode): void {
    this.nodes.set(node.id, node);
    this.markAdded(node.id);
  }

  addEdge(edge: DiagramEdge): void {
    this.edges.set(edge.id, edge);
    this.markAdded(edge.id);
  }

  addGroup(group: DiagramGroup): void {
    this.groups.set(group.id, group);
    this.markAdded(group.id);
  }

  /** Replaces a node with an updated copy and records it as modified. */
  putNode(node: DiagramNode): void {
    this.nodes.set(node.id, node);
    this.cloned.add(node.id);
    this.markModified(node.id);
  }

  putEdge(edge: DiagramEdge): void {
    this.edges.set(edge.id, edge);
    this.cloned.add(edge.id);
    this.markModified(edge.id);
  }

  putGroup(group: DiagramGroup): void {
    this.groups.set(group.id, group);
    this.cloned.add(group.id);
    this.markModified(group.id);
  }

  deleteNode(id: Id): void {
    this.nodes.delete(id);
    this.markDeleted(id);
  }

  deleteEdge(id: Id): void {
    this.edges.delete(id);
    this.markDeleted(id);
  }

  deleteGroup(id: Id): void {
    this.groups.delete(id);
    this.markDeleted(id);
  }

  // --- hierarchy helpers --------------------------------------------------------------------

  /** Does the parent chain starting at `start` pass through `target`? (cycle detection) */
  chainContains(start: Id | null, target: Id): boolean {
    const seen = new Set<Id>();
    let current = start;
    while (current !== null && !seen.has(current)) {
      if (current === target) return true;
      seen.add(current);
      current = this.groups.get(current)?.parent ?? null;
    }
    return false;
  }

  /** Direct children of a group: nodes first, then groups, in collection order. */
  childrenOf(groupId: Id): Id[] {
    const ids: Id[] = [];
    for (const n of this.nodes.values()) if (n.parent === groupId) ids.push(n.id);
    for (const g of this.groups.values()) if (g.parent === groupId) ids.push(g.id);
    return ids;
  }

  /** The group and all nested groups, parents before children. */
  groupSubtree(groupId: Id): Id[] {
    const out: Id[] = [groupId];
    for (let i = 0; i < out.length; i += 1) {
      const current = out[i] as Id;
      for (const g of this.groups.values()) if (g.parent === current) out.push(g.id);
    }
    return out;
  }

  incidentEdges(nodeId: Id): DiagramEdge[] {
    return [...this.edges.values()].filter((e) => e.source === nodeId || e.target === nodeId);
  }

  // --- affected bookkeeping -----------------------------------------------------------------

  private markAdded(id: Id): void {
    this.cloned.add(id);
    if (this.deleted.has(id)) {
      // delete + re-add within one change set nets out to a modification
      this.deleted.delete(id);
      this.modified.add(id);
      return;
    }
    this.added.add(id);
  }

  private markModified(id: Id): void {
    if (!this.added.has(id)) this.modified.add(id);
  }

  private markDeleted(id: Id): void {
    this.modified.delete(id);
    if (this.added.has(id)) {
      this.added.delete(id);
      return;
    }
    this.deleted.add(id);
  }

  affected(): Affected {
    return { added: [...this.added], modified: [...this.modified], deleted: [...this.deleted] };
  }
}
