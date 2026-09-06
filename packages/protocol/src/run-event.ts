import {
  AgentActionSchema,
  ChangeSetSchema,
  DiagramTypeSchema,
  IdSchema,
  LayoutPatchSchema,
  ValidationResultSchema,
} from '@nivik/ir';
import { z } from 'zod';
import { RunErrorCodeSchema } from './error-codes';
import { RunIdSchema } from './run-request';

/** PRD §9.1 stages; `connecting` is layout + render performed by the orchestrator, not the LLM. */
export const RUN_STAGES = [
  'understanding',
  'planning',
  'building',
  'connecting',
  'validating',
  'done',
] as const;
export const RunStageSchema = z.enum(RUN_STAGES);
export type RunStage = z.infer<typeof RunStageSchema>;

export const PLAN_INTENTS = [
  'generate',
  'edit',
  'relayout',
  'convert',
  'style',
  'explain',
  'review',
] as const;
export const PlanIntentSchema = z.enum(PLAN_INTENTS);
export type PlanIntent = z.infer<typeof PlanIntentSchema>;

/** Spec 05 §3; `diagramType` and `layout` use the IR vocabularies. */
export const PlanSchema = z.object({
  intent: PlanIntentSchema,
  diagramType: DiagramTypeSchema,
  scope: z.object({
    kind: z.enum(['all', 'selection', 'ids']),
    ids: z.array(IdSchema).optional(),
  }),
  summary: z.string().max(200),
  steps: z.array(z.string().max(120)).max(8),
  layout: LayoutPatchSchema.pick({ algorithm: true, direction: true }),
  estimatedNodes: z.number().int().min(0).max(300),
  needsClarification: z.string().max(200).optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const ReviewIssueSchema = z.object({
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().max(500),
  ids: z.array(z.string().min(1)).default([]),
});
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  calls: z.number().int().min(0),
});
export type Usage = z.infer<typeof UsageSchema>;

/** Spec 05 §2. Every line of the NDJSON stream is exactly one of these. */
export const RunEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), stage: RunStageSchema }),
  z.object({ type: z.literal('plan'), plan: PlanSchema }),
  z.object({
    type: z.literal('action'),
    index: z.number().int().min(0),
    /** One model-emitted action (spec 02 §3); user / system ops never travel on this event. */
    action: AgentActionSchema,
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('repair'),
    attempted: z.number().int().min(0),
    fixed: z.number().int().min(0),
  }),
  z.object({ type: z.literal('changeSet'), changeSet: ChangeSetSchema }),
  z.object({ type: z.literal('validation'), result: ValidationResultSchema }),
  z.object({ type: z.literal('review'), issues: z.array(ReviewIssueSchema) }),
  z.object({ type: z.literal('usage'), usage: UsageSchema }),
  z.object({ type: z.literal('tool'), name: z.string().min(1), durationMs: z.number().min(0) }),
  z.object({
    type: z.literal('error'),
    code: RunErrorCodeSchema,
    message: z.string(),
    recoverable: z.boolean(),
  }),
  z.object({ type: z.literal('done'), runId: RunIdSchema }),
]);

export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventOf<T extends RunEvent['type']> = Extract<RunEvent, { type: T }>;

/** A stream is complete once one of these has been emitted; nothing may follow it. */
export function isTerminalEvent(event: RunEvent): boolean {
  return event.type === 'done' || (event.type === 'error' && !event.recoverable);
}
