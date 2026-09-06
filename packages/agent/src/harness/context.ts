import { RunError } from '@nivik/protocol';
import type { AgentDeps } from '../deps';
import { abortError } from '../deps';
import { type BudgetLimits, BudgetTracker } from './budget';
import { redact } from './redact';

/** Run-scoped state shared by every stage of one run. */
export interface RunContext {
  readonly runId: string;
  readonly deps: AgentDeps;
  readonly budget: BudgetTracker;
  readonly signal: AbortSignal;
  redact(text: string): string;
}

export interface CreateRunContextOptions {
  runId: string;
  deps: AgentDeps;
  limits: BudgetLimits;
  signal?: AbortSignal;
}

export function createRunContext(options: CreateRunContextOptions): RunContext {
  return {
    runId: options.runId,
    deps: options.deps,
    budget: new BudgetTracker(options.limits, options.deps.now),
    signal: options.signal ?? new AbortController().signal,
    redact,
  };
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** Normalises anything thrown inside the core into a `RunError` (spec 05 §10). */
export function toRunError(error: unknown): RunError {
  if (error instanceof RunError) return error;
  if (error instanceof Error) {
    if (error.name === 'AbortError') return new RunError('E_ABORTED', 'Run cancelled');
    if (error.name === 'TimeoutError') {
      return new RunError('E_BUDGET_EXCEEDED', 'Stage time budget exceeded');
    }
    return new RunError('E_INTERNAL', error.message || error.name, { cause: error });
  }
  return new RunError('E_INTERNAL', typeof error === 'string' ? error : 'Unknown error');
}
