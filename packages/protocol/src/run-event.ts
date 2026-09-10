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

/**
 * PRD §9.1 stages. `connecting` is layout + render performed by the orchestrator, not the LLM.
 * D14′ (spec 05 §2) adds the tool-loop stages — `thinking` / `reading` / `building` / `reviewing`
 * / `asking` — derived by the loop from the most recent tool call; the workflow-era names stay
 * until the mock agent retires (task 1.7).
 */
export const RUN_STAGES = [
  'understanding',
  'planning',
  'thinking',
  'reading',
  'building',
  'reviewing',
  'asking',
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

/** How a run ended (D14′, spec 05 §2): the model's own `finish`, the budget safety net, or an interruption. */
export const DONE_OUTCOMES = [
  'finished',
  'budget-exhausted',
  'no-changes',
  'clarify-pending',
] as const;
export const DoneOutcomeSchema = z.enum(DONE_OUTCOMES);
export type DoneOutcome = z.infer<typeof DoneOutcomeSchema>;

/** Spec 05 §12.5 soft budget phases. */
export const BUDGET_PHASES = ['normal', 'wrapping-up', 'exhausted'] as const;
export const BudgetPhaseSchema = z.enum(BUDGET_PHASES);
export type BudgetPhase = z.infer<typeof BudgetPhaseSchema>;

/** Usage plus wall-clock, as reported on `budget` events. */
export const BudgetUsageSchema = UsageSchema.extend({ elapsedMs: z.number().min(0) });
export type BudgetUsage = z.infer<typeof BudgetUsageSchema>;

/** Tool call as shown in the run trace; `input` is the model's arguments, kept opaque here. */
export const ToolCallStatusSchema = z.enum(['start', 'end']);

export const SubagentRoleSchema = z.enum(['review', 'critiquePlan']);
export type SubagentRole = z.infer<typeof SubagentRoleSchema>;

/** Identity of a staging document the loop works on; the initial diagram plus anything it created. */
export const DocumentInfoSchema = z.object({
  id: IdSchema,
  name: z.string().max(120),
  type: DiagramTypeSchema,
});
export type DocumentInfo = z.infer<typeof DocumentInfoSchema>;

/**
 * Spec 05 §2. Every line of the NDJSON stream is exactly one of these. D14′ additions are
 * additive: new events and optional fields sit next to the workflow-era `repair` / `review`
 * events until task 1.7 retires those.
 */
export const RunEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), stage: RunStageSchema }),
  z.object({ type: z.literal('plan'), plan: PlanSchema }),
  /** The model's prose (explanations, progress notes); streamed in pieces, never written to the IR. */
  z.object({ type: z.literal('reply'), text: z.string(), final: z.boolean() }),
  z.object({
    type: z.literal('action'),
    /** Staging document the action was applied to; absent = the run's initial diagram. */
    documentId: IdSchema.optional(),
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
  z.object({
    type: z.literal('document'),
    op: z.enum(['create', 'switch']),
    document: DocumentInfoSchema,
  }),
  /** The model asked the user something (`ask` tool) and is waiting. */
  z.object({
    type: z.literal('question'),
    questionId: z.string().min(1),
    text: z.string().min(1).max(600),
    choices: z.array(z.string().min(1).max(120)).max(5).optional(),
    allowFreeText: z.boolean(),
  }),
  /** Echo of the user's answer, so the transcript is complete. */
  z.object({ type: z.literal('answer'), questionId: z.string().min(1), text: z.string() }),
  z.object({
    type: z.literal('subagent'),
    role: SubagentRoleSchema,
    status: ToolCallStatusSchema,
    issues: z.array(ReviewIssueSchema).optional(),
    usage: UsageSchema.optional(),
  }),
  z.object({
    type: z.literal('changeSet'),
    documentId: IdSchema.optional(),
    changeSet: ChangeSetSchema,
  }),
  z.object({
    type: z.literal('validation'),
    documentId: IdSchema.optional(),
    result: ValidationResultSchema,
  }),
  z.object({ type: z.literal('review'), issues: z.array(ReviewIssueSchema) }),
  z.object({
    type: z.literal('budget'),
    used: BudgetUsageSchema,
    limit: BudgetUsageSchema,
    phase: BudgetPhaseSchema,
  }),
  z.object({ type: z.literal('usage'), usage: UsageSchema }),
  z.object({
    type: z.literal('tool'),
    name: z.string().min(1),
    durationMs: z.number().min(0),
    /** Correlates `start` / `end` of one call; absent on workflow-era events. */
    call: z.string().min(1).optional(),
    input: z.unknown().optional(),
    status: ToolCallStatusSchema.optional(),
    summary: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal('error'),
    code: RunErrorCodeSchema,
    message: z.string(),
    recoverable: z.boolean(),
  }),
  z.object({
    type: z.literal('done'),
    runId: RunIdSchema,
    outcome: DoneOutcomeSchema.optional(),
    summary: z.string().max(600).optional(),
    unresolved: z.array(z.string().max(300)).max(10).optional(),
  }),
]);

export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventOf<T extends RunEvent['type']> = Extract<RunEvent, { type: T }>;

/** A stream is complete once one of these has been emitted; nothing may follow it. */
export function isTerminalEvent(event: RunEvent): boolean {
  return event.type === 'done' || (event.type === 'error' && !event.recoverable);
}
