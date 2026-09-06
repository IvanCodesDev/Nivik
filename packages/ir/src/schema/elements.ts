import { z } from 'zod';
import { IdSchema } from '../ids';
import { EDGE_DATA_SCHEMAS, NODE_DATA_SCHEMAS, refineTypedData } from './data';
import {
  EdgeDirectionSchema,
  EdgeTypeSchema,
  GroupRoleSchema,
  NodeTypeSchema,
  OriginSchema,
  RoleSchema,
  SideSchema,
} from './enums';
import { PointSchema, SizeSchema } from './geometry';
import { StyleTokensSchema } from './style';

/** Maintained by `applyChangeSet`; never written by the LLM or the UI directly. */
export const ElementMetaSchema = z.object({
  createdBy: OriginSchema,
  runId: z.string().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  rev: z.number().int().nonnegative(),
});
export type ElementMeta = z.infer<typeof ElementMetaSchema>;

const FreeFormDataSchema = z.record(z.string(), z.unknown());

export const DiagramNodeSchema = z
  .object({
    id: IdSchema,
    type: NodeTypeSchema,
    label: z.string().max(200),
    description: z.string().max(1000).optional(),
    role: RoleSchema.optional(),
    parent: IdSchema.nullable().default(null),
    position: PointSchema.optional(),
    size: SizeSchema.optional(),
    pinned: z.boolean().default(false),
    style: StyleTokensSchema.optional(),
    data: FreeFormDataSchema.optional(),
    semantic: z
      .object({
        tags: z.array(z.string().max(32)).max(16).optional(),
        note: z.string().max(500).optional(),
        sourceRef: z.string().max(200).optional(),
      })
      .optional(),
    meta: ElementMetaSchema,
  })
  .superRefine((node, ctx) => refineTypedData(NODE_DATA_SCHEMAS, node, ctx));
export type DiagramNode = z.infer<typeof DiagramNodeSchema>;
export type DiagramNodeInput = z.input<typeof DiagramNodeSchema>;

export const DiagramEdgeSchema = z
  .object({
    id: IdSchema,
    source: IdSchema,
    target: IdSchema,
    type: EdgeTypeSchema.default('flow'),
    label: z.string().max(120).optional(),
    direction: EdgeDirectionSchema.default('forward'),
    sourceSide: SideSchema.default('auto'),
    targetSide: SideSchema.default('auto'),
    route: z.object({ points: z.array(PointSchema).min(2) }).optional(),
    style: StyleTokensSchema.optional(),
    data: FreeFormDataSchema.optional(),
    meta: ElementMetaSchema,
  })
  .superRefine((edge, ctx) => refineTypedData(EDGE_DATA_SCHEMAS, edge, ctx));
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>;
export type DiagramEdgeInput = z.input<typeof DiagramEdgeSchema>;

export const DiagramGroupSchema = z.object({
  id: IdSchema,
  label: z.string().max(120).optional(),
  role: GroupRoleSchema.default('cluster'),
  parent: IdSchema.nullable().default(null),
  collapsed: z.boolean().default(false),
  position: PointSchema.optional(),
  size: SizeSchema.optional(),
  style: StyleTokensSchema.optional(),
  meta: ElementMetaSchema,
});
export type DiagramGroup = z.infer<typeof DiagramGroupSchema>;
export type DiagramGroupInput = z.input<typeof DiagramGroupSchema>;
