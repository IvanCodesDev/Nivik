import { z } from 'zod';

export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const RunIdSchema = z.string().regex(RUN_ID_PATTERN, 'runId must be 8–64 url-safe chars');

export const RENDERER_IDS = ['excalidraw', 'drawio', 'mermaid', 'nivik'] as const;
export const RendererIdSchema = z.enum(RENDERER_IDS);
export type RendererId = z.infer<typeof RendererIdSchema>;

/**
 * Placeholder for the Diagram IR (spec 01). Replaced by `DiagramSchema` from `@nivik/ir`
 * in roadmap task 0.3; until then any JSON object is accepted so the transport can be built.
 */
export const DiagramPayloadSchema = z.record(z.string(), z.unknown());
export type DiagramPayload = z.infer<typeof DiagramPayloadSchema>;

export const ModelRefSchema = z.union([
  z.literal('auto'),
  z.object({ providerId: z.string().min(1), model: z.string().min(1) }),
]);
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const RunSettingsSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().int().min(256).max(200_000).default(8_192),
  timeoutMs: z.number().int().min(5_000).max(300_000).default(120_000),
  retries: z.number().int().min(0).max(3).default(1),
  thinking: z.boolean().default(false),
});
export type RunSettings = z.infer<typeof RunSettingsSchema>;

/** Spec 05 §8: sources are resolved (text extracted) on the client before the run starts. */
export const ResolvedSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['text', 'doc', 'url', 'diagram', 'image', 'repo']),
  title: z.string().max(200),
  text: z.string().max(200_000),
});
export type ResolvedSource = z.infer<typeof ResolvedSourceSchema>;

export const RunHintsSchema = z.object({
  diagramType: z.string().min(1).optional(),
  renderer: RendererIdSchema,
});

/** Wire form of spec 05 §2 `RunInput`. Validated on both ends of the transport. */
export const RunRequestSchema = z.object({
  /** Client-generated so it can cancel before the first event arrives; runtime mints one if absent. */
  runId: RunIdSchema.optional(),
  diagram: DiagramPayloadSchema,
  prompt: z.string().trim().min(1).max(8_000),
  selection: z.array(z.string().min(1)).max(2_000).default([]),
  sources: z.array(ResolvedSourceSchema).max(20).default([]),
  hints: RunHintsSchema,
  model: ModelRefSchema.default('auto'),
  settings: RunSettingsSchema.default({
    temperature: 0.3,
    maxTokens: 8_192,
    timeoutMs: 120_000,
    retries: 1,
    thinking: false,
  }),
});

export type RunRequestInput = z.input<typeof RunRequestSchema>;
export type RunRequest = z.output<typeof RunRequestSchema>;
