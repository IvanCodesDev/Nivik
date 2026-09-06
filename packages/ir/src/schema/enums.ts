import { z } from 'zod';

export const DiagramTypeSchema = z.enum([
  'architecture',
  'flow',
  'dataflow',
  'sequence',
  'erd',
  'state',
  'class',
  'mindmap',
  'network',
  'generic',
]);
export type DiagramType = z.infer<typeof DiagramTypeSchema>;

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
  'entity',
  'participant',
  'state',
  'class',
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

/** Node types that annotate rather than participate in the graph (exempt from orphan / type-mismatch checks). */
export const ANNOTATION_NODE_TYPES: ReadonlySet<NodeType> = new Set(['note', 'text', 'image']);

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
