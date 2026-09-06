import { z } from 'zod';

/**
 * A diagram's type is an open label the model chooses (spec 01 §3.1, D16): a lowercase slug of
 * 1–40 chars. Code never branches on it except the Mermaid export template and the four soft
 * `W_TYPE_MISMATCH` checks; layout, validation and rendering bind to primitives instead.
 */
export const DIAGRAM_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
export const DiagramTypeSchema = z
  .string()
  .regex(DIAGRAM_TYPE_PATTERN, 'Expected a lowercase slug such as "flow" or "customer-journey"');
export type DiagramType = z.infer<typeof DiagramTypeSchema>;

/**
 * Well-known types grouped by spatial arrangement family. Suggestions for the model and keys for
 * optional hint packs — not a closed list. `generic` belongs to no family.
 */
export const DIAGRAM_FAMILIES = {
  graph: [
    'architecture',
    'flow',
    'dataflow',
    'network',
    'deployment',
    'component',
    'c4',
    'usecase',
    'dependency',
    'pipeline',
    'state',
    'activity',
    'decision-tree',
    'erd',
    'class',
    'concept',
    'fishbone',
  ],
  tree: ['mindmap', 'orgchart', 'tree', 'sitemap', 'wbs'],
  time: ['sequence', 'timeline', 'gantt', 'roadmap'],
  grid: ['swimlane', 'bpmn', 'journey', 'kanban', 'swot', 'matrix', 'quadrant', 'raci', 'canvas'],
  arrangement: ['cycle', 'pyramid', 'funnel', 'venn', 'infographic'],
} as const satisfies Record<string, readonly string[]>;
export type DiagramFamily = keyof typeof DIAGRAM_FAMILIES;
export type WellKnownDiagramType = (typeof DIAGRAM_FAMILIES)[DiagramFamily][number] | 'generic';

export const WELL_KNOWN_DIAGRAM_TYPES: readonly WellKnownDiagramType[] = [
  ...Object.values(DIAGRAM_FAMILIES).flat(),
  'generic',
];

const FAMILY_BY_TYPE: ReadonlyMap<string, DiagramFamily> = new Map(
  (Object.keys(DIAGRAM_FAMILIES) as DiagramFamily[]).flatMap((family) =>
    DIAGRAM_FAMILIES[family].map((type): [string, DiagramFamily] => [type, family]),
  ),
);

/** Arrangement family of a well-known type; `null` for `generic` and anything outside the vocabulary. */
export const familyOf = (type: string): DiagramFamily | null => FAMILY_BY_TYPE.get(type) ?? null;

export const NodeTypeSchema = z.enum([
  'box',
  'rounded',
  'ellipse',
  'diamond',
  'cylinder',
  'parallelogram',
  'hexagon',
  'note',
  'text',
  'image',
  'line',
  'entity',
  'participant',
  'state',
  'class',
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

/** Node types that annotate rather than participate in the graph (exempt from orphan / type-mismatch checks). */
export const ANNOTATION_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  'note',
  'text',
  'image',
  'line',
]);

export const EdgeTypeSchema = z.enum([
  'flow',
  'data',
  'dependency',
  'association',
  'inheritance',
  'composition',
  'aggregation',
  'message',
  'relation',
  'transition',
  'link',
]);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

/** Edge types for which `source === target` is legal (self-transition, self-message). */
export const SELF_LOOP_EDGE_TYPES: ReadonlySet<EdgeType> = new Set(['transition', 'message']);

export const EdgeDirectionSchema = z.enum(['forward', 'backward', 'both', 'none']);
export type EdgeDirection = z.infer<typeof EdgeDirectionSchema>;

export const SideSchema = z.enum(['top', 'right', 'bottom', 'left', 'auto']);
export type Side = z.infer<typeof SideSchema>;

export const RendererIdSchema = z.enum(['excalidraw', 'drawio', 'nivik', 'mermaid', 'plantuml']);
export type RendererId = z.infer<typeof RendererIdSchema>;

export const OriginSchema = z.enum(['ai', 'user', 'system', 'import']);
export type Origin = z.infer<typeof OriginSchema>;

export const GroupRoleSchema = z.enum(['layer', 'boundary', 'lane', 'cluster', 'frame']);
export type GroupRole = z.infer<typeof GroupRoleSchema>;

/**
 * Recommended semantic roles for nodes. Shared by LLM prompts and renderer icon mapping; roles
 * outside this list are still valid (renderers fall back to the node `type`).
 */
export const ROLE_VOCABULARY = [
  'service',
  'gateway',
  'client',
  'web',
  'mobile',
  'database',
  'cache',
  'queue',
  'topic',
  'storage',
  'function',
  'job',
  'scheduler',
  'external',
  'user',
  'actor',
  'process',
  'decision',
  'start',
  'end',
  'lb',
  'cdn',
  'auth',
  'monitor',
  'log',
  'config',
  'file',
  'document',
  'api',
  'library',
  'module',
] as const;
export type KnownRole = (typeof ROLE_VOCABULARY)[number];

export const RoleSchema = z.string().max(32);
