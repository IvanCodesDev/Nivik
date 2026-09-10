import { DiagramSchema, IdSchema, RendererIdSchema } from '@nivik/ir';
import { z } from 'zod';

export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const RunIdSchema = z.string().regex(RUN_ID_PATTERN, 'runId must be 8–64 url-safe chars');

/** Renderer vocabulary is owned by the IR (`diagram.renderer.preferred`); re-exported for hosts. */
export { type RendererId, RendererIdSchema } from '@nivik/ir';
export const RENDERER_IDS = RendererIdSchema.options;

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

/**
 * Only what the agent cannot infer from the prompt and the document. The diagram type is
 * deliberately absent: it is a plan-stage decision (spec 05 §3), never a client preset. Strict so
 * a stray `diagramType` is rejected at the boundary instead of being silently dropped.
 */
export const RunHintsSchema = z
  .object({
    renderer: RendererIdSchema,
  })
  .strict();
export type RunHints = z.infer<typeof RunHintsSchema>;

/** One earlier exchange on this diagram, as the agent gets to see it (spec 09 §5.3, D14′). */
export const SessionTurnSchema = z.object({
  runId: z.string().min(1),
  at: z.number().int(),
  user: z.string().max(4_000),
  agent: z.object({
    replies: z.array(z.string().max(2_000)).max(10).default([]),
    questions: z
      .array(z.object({ text: z.string().max(600), answer: z.string().max(2_000).nullable() }))
      .max(10)
      .default([]),
    changes: z
      .array(
        z.object({
          documentId: IdSchema,
          summary: z.string().max(300),
          counts: z.record(z.string(), z.number().int().min(0)).default({}),
        }),
      )
      .max(10)
      .default([]),
    outcome: z.string().max(40),
  }),
});
export type SessionTurn = z.infer<typeof SessionTurnSchema>;

/** Cross-run memory: a rolling summary plus the most recent turns verbatim. */
export const SessionSchema = z.object({
  recentTurns: z.array(SessionTurnSchema).max(6).default([]),
  summary: z.string().max(4_000).nullable().default(null),
});
export type Session = z.infer<typeof SessionSchema>;

/** What the host registered beyond the isomorphic core (spec 05 §9.4: Node-only tools live in the runtime). */
export const RunCapabilitiesSchema = z.object({
  runtimeTools: z.boolean().default(false),
});
export type RunCapabilities = z.infer<typeof RunCapabilitiesSchema>;

/** Spec 05 §12.5 soft budget; `0` means unlimited (JSON has no Infinity). */
export const RunBudgetSchema = z.object({
  maxTokens: z.number().int().min(0).default(400_000),
  maxMs: z.number().int().min(0).default(600_000),
});
export type RunBudget = z.infer<typeof RunBudgetSchema>;

export const DEFAULT_RUN_BUDGET: RunBudget = { maxTokens: 400_000, maxMs: 600_000 };

/** Wire form of spec 05 §2 `RunInput`. Validated on both ends of the transport. */
export const RunRequestSchema = z.object({
  /** Client-generated so it can cancel before the first event arrives; runtime mints one if absent. */
  runId: RunIdSchema.optional(),
  /** The full Diagram IR (spec 01); structural rules are enforced at parse time. */
  diagram: DiagramSchema,
  prompt: z.string().trim().min(1).max(8_000),
  selection: z.array(IdSchema).max(2_000).default([]),
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
  /** D14′: cross-run memory, host capabilities and the soft budget; all optional on the wire. */
  session: SessionSchema.default({ recentTurns: [], summary: null }),
  capabilities: RunCapabilitiesSchema.default({ runtimeTools: false }),
  budget: RunBudgetSchema.default(DEFAULT_RUN_BUDGET),
});

export type RunRequestInput = z.input<typeof RunRequestSchema>;
export type RunRequest = z.output<typeof RunRequestSchema>;

/** Body of `POST /v1/runs/:id/answer` and of the Worker `answer` message: the user's reply to an `ask`. */
export const AnswerRequestSchema = z.object({
  questionId: z.string().min(1),
  text: z.string().max(4_000),
});
export type AnswerRequest = z.infer<typeof AnswerRequestSchema>;
