import type { RunErrorCode, RunEvent } from '@nivik/protocol';
import type { LanguageModel } from 'ai';
import type { BudgetLimits, BudgetTracker } from './budget';

export type StageName = 'plan' | 'build' | 'repair' | 'review' | 'explain';

/**
 * Spec 05 §12.1. A stage is a generator: it yields RunEvents while it works and returns its
 * typed output. It knows nothing about transports, retries or budgets — `runStage` adds those.
 */
export interface Stage<I, O> {
  readonly name: StageName;
  readonly budget: BudgetLimits;
  readonly retry: { attempts: number; on: readonly RunErrorCode[] };
  run(ctx: StageContext, input: I): AsyncGenerator<RunEvent, O>;
}

/** What a stage sees: run identity, its own budget, and cancellation. */
export interface StageContext {
  readonly runId: string;
  readonly attempt: number;
  readonly budget: BudgetTracker;
  readonly signal: AbortSignal;
  now(): number;
  sleep(ms: number): Promise<void>;
  redact(text: string): string;
  log(message: string, data?: Record<string, unknown>): void;
  /** The model this stage should call (spec 05 §9.5 routing happens in the host's resolver). */
  model(): LanguageModel;
}
