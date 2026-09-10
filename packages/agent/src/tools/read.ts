import type { Diagram, Id } from '@nivik/ir';
import { toReadout } from '@nivik/ir';

export type ElementKind = 'node' | 'edge' | 'group';

export interface FindElementsInput {
  query: string;
  kinds?: ElementKind[];
  limit?: number;
}

export interface FoundElement {
  kind: ElementKind;
  id: Id;
  label: string;
  type: string;
  /** For edges: the endpoints; for nodes and groups: the parent. */
  context: string;
}

const norm = (text: string) => text.toLowerCase().trim();

/** Every whitespace-separated query token must appear somewhere in the element's text. */
function matches(query: string, haystack: string[]): boolean {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const joined = haystack.map(norm).join(' ');
  return tokens.every((token) => joined.includes(token));
}

/**
 * Spec 09 §3.3 `findElements`: substring / all-tokens search over labels, ids, roles and
 * descriptions of the staging document. Pure; the model uses it when the Readout was scoped.
 */
export function findElements(diagram: Diagram, input: FindElementsInput): FoundElement[] {
  const kinds = new Set<ElementKind>(input.kinds ?? ['node', 'edge', 'group']);
  const limit = Math.max(1, Math.min(input.limit ?? 10, 20));
  const out: FoundElement[] = [];
  if (kinds.has('node')) {
    for (const n of diagram.nodes) {
      if (matches(input.query, [n.id, n.label, n.role ?? '', n.description ?? '', n.type])) {
        out.push({
          kind: 'node',
          id: n.id,
          label: n.label,
          type: n.type,
          context: n.parent ? `in ${n.parent}` : 'top level',
        });
      }
    }
  }
  if (kinds.has('group')) {
    for (const g of diagram.groups) {
      if (matches(input.query, [g.id, g.label ?? '', g.role])) {
        out.push({
          kind: 'group',
          id: g.id,
          label: g.label ?? '',
          type: g.role,
          context: g.parent ? `in ${g.parent}` : 'top level',
        });
      }
    }
  }
  if (kinds.has('edge')) {
    for (const e of diagram.edges) {
      if (matches(input.query, [e.id, e.label ?? '', e.type, e.source, e.target])) {
        out.push({
          kind: 'edge',
          id: e.id,
          label: e.label ?? '',
          type: e.type,
          context: `${e.source} → ${e.target}`,
        });
      }
    }
  }
  return out.slice(0, limit);
}

export interface DescribeInput {
  ids: Id[];
  hops?: 0 | 1;
}

/** Spec 09 §3.3 `describe`: the Readout of a few elements and, optionally, their neighbours. */
export function describe(
  diagram: Diagram,
  input: DescribeInput,
): { readout: string; missing: Id[] } {
  const known = new Set([...diagram.nodes, ...diagram.groups, ...diagram.edges].map((e) => e.id));
  const ids = Array.from(new Set(input.ids)).slice(0, 20);
  const present = ids.filter((id) => known.has(id));
  const missing = ids.filter((id) => !known.has(id));
  if (present.length === 0) return { readout: '', missing };
  // Edges are described through their endpoints: the Readout scopes by nodes.
  const nodeIds = present.flatMap((id) => {
    const edge = diagram.edges.find((e) => e.id === id);
    return edge ? [edge.source, edge.target] : [id];
  });
  const readout = toReadout(diagram, {
    scope: { selection: Array.from(new Set(nodeIds)), hops: input.hops === 0 ? 1 : 2 },
    includeNotes: false,
    includeDescriptions: true,
    includeSiblings: input.hops !== 0,
    maxTokens: 1_500,
  });
  return { readout: readout.text, missing };
}
