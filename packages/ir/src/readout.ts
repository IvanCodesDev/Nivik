import { type DiagramIndex, descendantsOf, indexDiagram, neighborhood } from './helpers';
import type { Id } from './ids';
import { qualityIssues } from './quality';
import type { Cell, Diagram, DiagramEdge, DiagramGroup, DiagramNode } from './schema';

export type ReadoutScope = 'all' | { selection: Id[]; hops: 1 | 2 };

export interface ReadoutOptions {
  /** What to include: everything, or the selection plus its N-hop neighbourhood (default `'all'`). */
  scope?: ReadoutScope;
  /** Ids listed under `## selection`; defaults to `scope.selection` when scoped. */
  selection?: Id[];
  /** Emit `@x,y wxh` for placed nodes (layout-related intents only). */
  includeGeometry?: boolean;
  /** Emit `desc="…"` (≤ 80 chars). Default false. */
  includeDescriptions?: boolean;
  /** Emit `## notes` (validation warnings, annotation count). Default true. */
  includeNotes?: boolean;
  /** In scoped mode, also show nodes sharing a group with a selected node. Default true. */
  includeSiblings?: boolean;
  /** Budget; the readout degrades step by step (spec 01 §7.3) to fit. Default 6000. */
  maxTokens?: number;
  /** Count of renderer-only annotation elements (spec 04 §5.3); omitted when 0. */
  annotations?: number;
}

export type ReadoutDegradation = 'descriptions' | 'notes' | 'hops' | 'siblings';

export interface Readout {
  text: string;
  /** Rough token estimate of `text` (see `estimateTokens`). */
  tokens: number;
  /** True when the text still exceeds `maxTokens` after every degradation step. */
  truncated: boolean;
  /** Degradation steps that were applied, in order. */
  degraded: ReadoutDegradation[];
  /** Elements actually listed (groups counts fully listed groups, not one-line summaries). */
  shown: { nodes: number; edges: number; groups: number };
}

interface Settings {
  scope: ReadoutScope;
  selection: Id[];
  includeGeometry: boolean;
  includeDescriptions: boolean;
  includeNotes: boolean;
  includeSiblings: boolean;
  annotations: number;
}

const DEFAULT_MAX_TOKENS = 6000;
const DESCRIPTION_LIMIT = 80;

const CJK = /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/g;

/** Cheap tokenizer-free estimate: CJK characters count as one token, everything else as ¼ token. */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const cjk = text.match(CJK)?.length ?? 0;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

const DEGRADATIONS: [ReadoutDegradation, (s: Settings) => Settings | null][] = [
  ['descriptions', (s) => (s.includeDescriptions ? { ...s, includeDescriptions: false } : null)],
  ['notes', (s) => (s.includeNotes ? { ...s, includeNotes: false } : null)],
  [
    'hops',
    (s) =>
      s.scope !== 'all' && s.scope.hops === 2 ? { ...s, scope: { ...s.scope, hops: 1 } } : null,
  ],
  [
    'siblings',
    (s) => (s.scope !== 'all' && s.includeSiblings ? { ...s, includeSiblings: false } : null),
  ],
];

/**
 * Compact, token-cheap description of a diagram for the model (spec 01 §7). Input only — models
 * never produce this format. Degrades in the spec's order until it fits `maxTokens`.
 */
export function toReadout(d: Diagram, opts: ReadoutOptions = {}): Readout {
  const scope = opts.scope ?? 'all';
  let settings: Settings = {
    scope,
    selection: opts.selection ?? (scope === 'all' ? [] : scope.selection),
    includeGeometry: opts.includeGeometry ?? false,
    includeDescriptions: opts.includeDescriptions ?? false,
    includeNotes: opts.includeNotes ?? true,
    includeSiblings: opts.includeSiblings ?? true,
    annotations: opts.annotations ?? 0,
  };
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const degraded: ReadoutDegradation[] = [];

  let rendered = render(d, settings);
  for (const [step, apply] of DEGRADATIONS) {
    if (rendered.tokens <= maxTokens) break;
    const next = apply(settings);
    if (!next) continue;
    settings = next;
    degraded.push(step);
    rendered = render(d, settings);
  }
  return { ...rendered, truncated: rendered.tokens > maxTokens, degraded };
}

// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
const quoted = (s: string) => `"${esc(s)}"`;
const oneLine = (s: string) => s.replace(/\s*\r?\n\s*/g, ' ').trim();

function render(d: Diagram, s: Settings): Omit<Readout, 'truncated' | 'degraded'> {
  const index = indexDiagram(d);
  const scoped = s.scope !== 'all';
  // Cells are structure under the grid strategy and noise everywhere else (spec 01 §7.1).
  const showCells = d.layout.algorithm === 'grid';

  // --- which nodes ------------------------------------------------------------------------
  const shownNodes = new Set<Id>();
  if (s.scope === 'all') {
    for (const n of d.nodes) shownNodes.add(n.id);
  } else {
    for (const id of neighborhood(d, s.scope.selection, s.scope.hops)) shownNodes.add(id);
    if (s.includeSiblings) {
      for (const id of s.scope.selection) {
        const parent = index.nodes.get(id)?.parent;
        if (!parent) continue;
        for (const sibling of index.byParent.get(parent) ?? []) {
          if (index.nodes.has(sibling)) shownNodes.add(sibling);
        }
      }
    }
  }

  // --- groups: fully listed when they (transitively) contain a shown node, else summarised --
  const listedGroups = new Set<Id>();
  for (const id of shownNodes) {
    let parent = index.nodes.get(id)?.parent ?? null;
    while (parent && !listedGroups.has(parent)) {
      listedGroups.add(parent);
      parent = index.groups.get(parent)?.parent ?? null;
    }
  }

  const shownEdges = d.edges.filter((e) => shownNodes.has(e.source) && shownNodes.has(e.target));
  const shownIds = new Set<Id>([...shownNodes, ...shownEdges.map((e) => e.id), ...listedGroups]);

  // --- header -------------------------------------------------------------------------------
  const { algorithm, direction } = d.layout;
  const layoutTag =
    algorithm === 'layered' && direction === 'RIGHT'
      ? ''
      : ` | layout=${algorithm}${direction === 'RIGHT' ? '' : ` ${direction}`}`;
  let header =
    `# ${oneLine(d.name)} | type=${d.type}${layoutTag} | v=${d.version}` +
    ` | nodes=${d.nodes.length} edges=${d.edges.length} groups=${d.groups.length}`;
  if (s.scope !== 'all') {
    const hops = s.scope.hops;
    header += ` | scope=selection+${hops}hop${hops > 1 ? 's' : ''} shown nodes=${shownNodes.size} edges=${shownEdges.length}`;
  }
  const out: string[] = [header];

  // --- groups -------------------------------------------------------------------------------
  const groupLines = d.groups.map((g) => {
    const summarised = scoped && !listedGroups.has(g.id);
    return groupLine(d, index, g, summarised, showCells);
  });
  if (groupLines.length) out.push('## groups', ...groupLines);

  // --- nodes --------------------------------------------------------------------------------
  const nodeLines: string[] = [];
  for (const n of d.nodes) {
    if (!shownNodes.has(n.id)) continue;
    nodeLines.push(nodeLine(n, s, showCells));
    const extra = nodeExtraLine(n);
    if (extra) nodeLines.push(extra);
  }
  if (nodeLines.length) out.push('## nodes', ...nodeLines);

  // --- edges --------------------------------------------------------------------------------
  if (shownEdges.length) out.push('## edges', ...shownEdges.map(edgeLine));

  // --- selection ----------------------------------------------------------------------------
  const selected = new Set(s.selection);
  const selection = [
    ...d.nodes.filter((n) => selected.has(n.id)).map((n) => n.id),
    ...d.edges.filter((e) => selected.has(e.id)).map((e) => e.id),
    ...d.groups.filter((g) => selected.has(g.id)).map((g) => g.id),
  ];
  if (selection.length) out.push('## selection', selection.join(' '));

  // --- notes --------------------------------------------------------------------------------
  if (s.includeNotes) {
    const notes = qualityIssues(d)
      .filter((issue) => issue.ids.length === 0 || issue.ids.some((id) => shownIds.has(id)))
      .map((issue) =>
        issue.ids.length
          ? `${issue.code} ${issue.ids.join(',')}: ${issue.message}`
          : `${issue.code}: ${issue.message}`,
      );
    if (s.annotations > 0)
      notes.push(`annotations: ${s.annotations} items (renderer-only, read-only)`);
    if (notes.length) out.push('## notes', ...notes);
  }

  const text = out.join('\n');
  return {
    text,
    tokens: estimateTokens(text),
    shown: {
      nodes: shownNodes.size,
      edges: shownEdges.length,
      groups: scoped ? listedGroups.size : d.groups.length,
    },
  };
}

/** `cell=<col>,<row>[+<colSpan>x<rowSpan>]`; a 1×1 span is the default and omitted. */
const cellTag = (cell: Cell) =>
  `cell=${cell.col},${cell.row}${
    cell.colSpan > 1 || cell.rowSpan > 1 ? `+${cell.colSpan}x${cell.rowSpan}` : ''
  }`;

function groupLine(
  d: Diagram,
  index: DiagramIndex,
  g: DiagramGroup,
  summarised: boolean,
  showCells: boolean,
): string {
  const parts = ['group', g.id];
  if (g.label !== undefined) parts.push(quoted(g.label));
  if (g.parent) parts.push(`parent=${g.parent}`);
  if (g.role !== 'cluster') parts.push(`role=${g.role}`);
  if (showCells && g.cell) parts.push(cellTag(g.cell));
  if (summarised) {
    const count = descendantsOf(d, g.id).filter((id) => index.nodes.has(id)).length;
    parts.push(`nodes=${count}`);
  }
  return parts.join(' ');
}

function nodeLine(n: DiagramNode, s: Settings, showCells: boolean): string {
  const parts = ['node', n.id, quoted(n.label), `type=${n.type}`];
  const kind = (n.type === 'participant' || n.type === 'state') && n.data?.kind;
  if (typeof kind === 'string') parts.push(`kind=${kind}`);
  if (n.type === 'line') {
    const axis = n.data?.axis;
    if (typeof axis === 'string' && axis !== 'horizontal') parts.push(`axis=${axis}`);
    const arrow = n.data?.arrow;
    if (typeof arrow === 'string' && arrow !== 'none') parts.push(`arrow=${arrow}`);
  }
  if (n.role) parts.push(`role=${n.role}`);
  if (n.parent) parts.push(`in=${n.parent}`);
  if (showCells && n.cell) parts.push(cellTag(n.cell));
  if (n.pinned) parts.push('pinned');
  if (s.includeDescriptions && n.description) {
    const text = oneLine(n.description);
    const cut = text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 1)}…` : text;
    parts.push(`desc=${quoted(cut)}`);
  }
  if (s.includeGeometry && n.position) {
    let geometry = `@${Math.round(n.position.x)},${Math.round(n.position.y)}`;
    if (n.size) geometry += ` ${Math.round(n.size.w)}x${Math.round(n.size.h)}`;
    parts.push(geometry);
  }
  return parts.join(' ');
}

interface EntityColumn {
  name: string;
  type?: string;
  pk?: boolean;
  fk?: string;
  nullable?: boolean;
}

function nodeExtraLine(n: DiagramNode): string | null {
  if (n.type !== 'entity') return null;
  const columns = n.data?.columns;
  if (!Array.isArray(columns) || columns.length === 0) return null;
  const rendered = (columns as EntityColumn[]).map((c) => {
    let text = c.name;
    if (c.type) text += `:${c.type}`;
    if (c.pk) text += ' pk';
    if (c.fk) text += ` fk->${c.fk}`;
    if (c.nullable) text += ' null';
    return text;
  });
  return `  columns: ${rendered.join(', ')}`;
}

function edgeLine(e: DiagramEdge): string {
  const parts = ['edge', e.id, e.source, '->', e.target];
  if (e.label !== undefined) parts.push(quoted(e.label));
  if (e.type !== 'flow') parts.push(`type=${e.type}`);
  if (e.direction !== 'forward') parts.push(`dir=${e.direction}`);
  const stroke = e.style?.stroke;
  if (stroke && stroke !== 'solid') parts.push(`style=${stroke}`);
  if (e.type === 'message' && typeof e.data?.order === 'number')
    parts.push(`order=${e.data.order}`);
  if (e.type === 'relation' && typeof e.data?.cardinality === 'string') {
    parts.push(`card=${e.data.cardinality}`);
  }
  return parts.join(' ');
}
