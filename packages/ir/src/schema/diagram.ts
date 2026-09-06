import { z } from 'zod';
import { IdSchema } from '../ids';
import { structuralIssues } from '../structural';
import { DiagramEdgeSchema, DiagramGroupSchema, DiagramNodeSchema } from './elements';
import { DiagramTypeSchema, RendererIdSchema } from './enums';

export const DIAGRAM_SCHEMA_VERSION = 'nivik.diagram/1';

export const LayoutSpecSchema = z.object({
  algorithm: z.enum(['layered', 'sequence', 'grid', 'radial', 'manual']).default('layered'),
  direction: z.enum(['RIGHT', 'DOWN', 'LEFT', 'UP']).default('RIGHT'),
  spacing: z.enum(['compact', 'normal', 'loose']).default('normal'),
  edgeRouting: z.enum(['orthogonal', 'polyline', 'straight']).default('orthogonal'),
  autoLayout: z.boolean().default(true),
});
export type LayoutSpec = z.infer<typeof LayoutSpecSchema>;

export const ThemeSpecSchema = z.object({
  preset: z.enum(['nivik-soft', 'nivik-contrast', 'mono']).default('nivik-soft'),
  strokeStyle: z.enum(['clean', 'sketch']).default('clean'),
  fontScale: z.enum(['s', 'm', 'l']).default('m'),
});
export type ThemeSpec = z.infer<typeof ThemeSpecSchema>;

export const SourceRefSchema = z.object({
  id: IdSchema,
  kind: z.enum(['doc', 'repo', 'url', 'diagram', 'image', 'text']),
  title: z.string().max(200),
  ref: z.string().max(2000),
  digest: z.string().max(64).optional(),
  addedAt: z.number().int(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const DiagramMetaSchema = z.object({
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  lastRunId: z.string().optional(),
  generator: z.string().optional(),
});
export type DiagramMeta = z.infer<typeof DiagramMetaSchema>;

/** The object shape without structural cross-reference checks; `DiagramSchema` adds them. */
export const DiagramBaseSchema = z.object({
  schema: z.literal(DIAGRAM_SCHEMA_VERSION),
  id: IdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  type: DiagramTypeSchema,
  version: z.number().int().positive(),
  nodes: z.array(DiagramNodeSchema),
  edges: z.array(DiagramEdgeSchema),
  groups: z.array(DiagramGroupSchema),
  layout: LayoutSpecSchema,
  theme: ThemeSpecSchema,
  renderer: z.object({
    preferred: RendererIdSchema.default('excalidraw'),
    // Opaque per-renderer private state (annotation layer, viewport); passed through, never interpreted.
    state: z.partialRecord(RendererIdSchema, z.unknown()).default({}),
  }),
  sources: z.array(SourceRefSchema).default([]),
  semantic: z
    .object({
      summary: z.string().max(1000).optional(),
      domain: z.string().max(64).optional(),
      tags: z.array(z.string().max(32)).max(16).optional(),
    })
    .optional(),
  meta: DiagramMetaSchema,
});

export type Diagram = z.infer<typeof DiagramBaseSchema>;
export type DiagramInput = z.input<typeof DiagramBaseSchema>;

/** Full contract: shape + structural cross-reference rules (spec 01 §6.1). */
export const DiagramSchema = DiagramBaseSchema.superRefine((d, ctx) => {
  for (const issue of structuralIssues(d)) {
    ctx.addIssue({
      code: 'custom',
      message: issue.message,
      path: issue.path,
      params: { code: issue.code, ids: issue.ids },
    });
  }
});
