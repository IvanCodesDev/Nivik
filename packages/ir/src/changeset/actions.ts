import { z } from 'zod';
import { IdSchema } from '../ids';
import { EDGE_DATA_SCHEMAS, NODE_DATA_SCHEMAS, refineTypedData } from '../schema/data';
import { DiagramBaseSchema, LayoutSpecSchema, ThemeSpecSchema } from '../schema/diagram';
import {
  DiagramEdgeBaseSchema,
  DiagramGroupSchema,
  DiagramNodeBaseSchema,
  FreeFormDataSchema,
  NodeSemanticSchema,
} from '../schema/elements';
import {
  DiagramTypeSchema,
  EdgeDirectionSchema,
  EdgeTypeSchema,
  GroupRoleSchema,
  NodeTypeSchema,
  RoleSchema,
  SideSchema,
} from '../schema/enums';
import { PointSchema, SizeSchema } from '../schema/geometry';
import {
  EmphasisSchema,
  FillStyleSchema,
  HexColorSchema,
  IconNameSchema,
  PaletteSchema,
  StrokeStyleSchema,
} from '../schema/style';

/** In a patch, `null` clears an optional field (JSON cannot carry `undefined`). */
const clearable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

// ---------------------------------------------------------------------------
// *Input variants: what may be created through a Change Set. Server-filled fields (meta, geometry,
// pinned) are omitted and `.strict()` turns any attempt to set them into a schema error, so an LLM
// that emits coordinates lands in the repair loop instead of the diagram (spec 02 §2).
// ---------------------------------------------------------------------------

export const NodeInputSchema = DiagramNodeBaseSchema.omit({
  position: true,
  size: true,
  meta: true,
  pinned: true,
})
  .extend({
    /** Layout hint only: place the new node close to this existing node. Never stored. */
    near: IdSchema.optional(),
  })
  .strict()
  .superRefine((node, ctx) => refineTypedData(NODE_DATA_SCHEMAS, node, ctx));
export type NodeInput = z.infer<typeof NodeInputSchema>;

export const EdgeInputSchema = DiagramEdgeBaseSchema.omit({ route: true, meta: true })
  .strict()
  .superRefine((edge, ctx) => refineTypedData(EDGE_DATA_SCHEMAS, edge, ctx));
export type EdgeInput = z.infer<typeof EdgeInputSchema>;

export const GroupInputSchema = DiagramGroupSchema.omit({
  position: true,
  size: true,
  meta: true,
}).strict();
export type GroupInput = z.infer<typeof GroupInputSchema>;

// ---------------------------------------------------------------------------
// Patches (shallow merge; `null` clears).
// ---------------------------------------------------------------------------

export const NodePatchSchema = z
  .object({
    label: DiagramNodeBaseSchema.shape.label.optional(),
    description: clearable(DiagramNodeBaseSchema.shape.description.unwrap()),
    role: clearable(RoleSchema),
    type: NodeTypeSchema.optional(),
    data: clearable(FreeFormDataSchema),
    semantic: clearable(NodeSemanticSchema),
  })
  .strict();
export type NodePatch = z.infer<typeof NodePatchSchema>;

export const EdgePatchSchema = z
  .object({
    label: clearable(DiagramEdgeBaseSchema.shape.label.unwrap()),
    type: EdgeTypeSchema.optional(),
    direction: EdgeDirectionSchema.optional(),
    sourceSide: SideSchema.optional(),
    targetSide: SideSchema.optional(),
    data: clearable(FreeFormDataSchema),
    source: IdSchema.optional(),
    target: IdSchema.optional(),
  })
  .strict();
export type EdgePatch = z.infer<typeof EdgePatchSchema>;

export const GroupPatchSchema = z
  .object({
    label: clearable(DiagramGroupSchema.shape.label.unwrap()),
    role: GroupRoleSchema.optional(),
    collapsed: z.boolean().optional(),
  })
  .strict();
export type GroupPatch = z.infer<typeof GroupPatchSchema>;

export const StylePatchSchema = z
  .object({
    palette: clearable(PaletteSchema),
    emphasis: clearable(EmphasisSchema),
    stroke: clearable(StrokeStyleSchema),
    fill: clearable(FillStyleSchema),
    icon: clearable(IconNameSchema),
    override: clearable(
      z
        .object({
          fill: clearable(HexColorSchema),
          stroke: clearable(HexColorSchema),
          text: clearable(HexColorSchema),
        })
        .strict(),
    ),
  })
  .strict();
export type StylePatch = z.infer<typeof StylePatchSchema>;

const layout = LayoutSpecSchema.shape;
export const LayoutPatchSchema = z
  .object({
    algorithm: layout.algorithm.removeDefault().optional(),
    direction: layout.direction.removeDefault().optional(),
    spacing: layout.spacing.removeDefault().optional(),
    edgeRouting: layout.edgeRouting.removeDefault().optional(),
    autoLayout: layout.autoLayout.removeDefault().optional(),
  })
  .strict();
export type LayoutPatch = z.infer<typeof LayoutPatchSchema>;

const theme = ThemeSpecSchema.shape;
export const ThemePatchSchema = z
  .object({
    preset: theme.preset.removeDefault().optional(),
    strokeStyle: theme.strokeStyle.removeDefault().optional(),
    fontScale: theme.fontScale.removeDefault().optional(),
  })
  .strict();
export type ThemePatch = z.infer<typeof ThemePatchSchema>;

export const DiagramPatchSchema = z
  .object({
    name: DiagramBaseSchema.shape.name.optional(),
    description: clearable(DiagramBaseSchema.shape.description.unwrap()),
    type: DiagramTypeSchema.optional(),
    layout: LayoutPatchSchema.optional(),
    theme: ThemePatchSchema.optional(),
    semantic: clearable(DiagramBaseSchema.shape.semantic.unwrap()),
  })
  .strict();
export type DiagramPatch = z.infer<typeof DiagramPatchSchema>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const agentActionOptions = [
  z.object({ op: z.literal('addNode'), node: NodeInputSchema }),
  z.object({ op: z.literal('updateNode'), id: IdSchema, patch: NodePatchSchema }),
  z.object({ op: z.literal('deleteNode'), id: IdSchema }),
  z.object({ op: z.literal('pinNodes'), ids: z.array(IdSchema).min(1), pinned: z.boolean() }),
  z.object({ op: z.literal('addEdge'), edge: EdgeInputSchema }),
  z.object({ op: z.literal('updateEdge'), id: IdSchema, patch: EdgePatchSchema }),
  z.object({ op: z.literal('deleteEdge'), id: IdSchema }),
  z.object({
    op: z.literal('addGroup'),
    group: GroupInputSchema,
    members: z.array(IdSchema).default([]),
  }),
  z.object({ op: z.literal('updateGroup'), id: IdSchema, patch: GroupPatchSchema }),
  z.object({
    op: z.literal('deleteGroup'),
    id: IdSchema,
    mode: z.enum(['ungroup', 'cascade']).default('ungroup'),
  }),
  z.object({
    op: z.literal('setParent'),
    ids: z.array(IdSchema).min(1),
    parent: IdSchema.nullable(),
  }),
  z.object({
    op: z.literal('setStyle'),
    targets: z.array(IdSchema).min(1),
    style: StylePatchSchema,
  }),
  z.object({
    op: z.literal('relayout'),
    scope: z.union([z.literal('all'), z.array(IdSchema).min(1)]).default('all'),
    layout: LayoutPatchSchema.optional(),
    /** existing node id -> node it should end up close to (the AI's only positioning tool). */
    near: z.record(IdSchema, IdSchema).optional(),
  }),
  z.object({ op: z.literal('setDiagram'), patch: DiagramPatchSchema }),
] as const;

/** User-only: explicit coordinates produced by renderer reconcile (drag / resize). */
const userActionOptions = [
  z.object({ op: z.literal('moveNode'), id: IdSchema, position: PointSchema }),
  z.object({ op: z.literal('resizeNode'), id: IdSchema, size: SizeSchema }),
] as const;

/**
 * System-only: the layout engine writing geometry back, so history replays without re-running ELK.
 * A `null` value clears that piece of geometry (used by inverses to return to "awaiting layout").
 */
export const ApplyLayoutActionSchema = z.object({
  op: z.literal('applyLayout'),
  positions: z.record(IdSchema, PointSchema.nullable()),
  sizes: z.record(IdSchema, SizeSchema.nullable()).default({}),
  routes: z.record(IdSchema, z.array(PointSchema).min(2).nullable()).default({}),
});

/** The 14 ops an LLM may emit (structured output uses this schema directly). */
export const AgentActionSchema = z.discriminatedUnion('op', [...agentActionOptions]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

/** All 17 ops accepted by `applyChangeSet`. */
export const ActionSchema = z.discriminatedUnion('op', [
  ...agentActionOptions,
  ...userActionOptions,
  ApplyLayoutActionSchema,
]);
export type Action = z.infer<typeof ActionSchema>;
export type ActionOp = Action['op'];
export type ActionOf<Op extends ActionOp> = Extract<Action, { op: Op }>;

export const AGENT_ACTION_OPS: readonly AgentAction['op'][] = agentActionOptions.map(
  (option) => option.shape.op.value,
);
export const ACTION_OPS: readonly ActionOp[] = ActionSchema.options.map(
  (option) => option.shape.op.value,
);
