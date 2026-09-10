import type { BudgetPhase, RunEventOf, Usage } from '@nivik/protocol';

/** Spec 05 §12.5; `0` on either axis means unlimited. */
export interface SoftBudgetLimits {
  maxTokens: number;
  maxMs: number;
}

export interface SoftBudgetOptions {
  /** Share of the budget at which the model is asked to wrap up. */
  wrapUpAt?: number;
  /** Model steps the loop may still take after the wrap-up notice before the harness finishes for it. */
  graceSteps?: number;
}

/**
 * The safety net around a loop with no step limit (D14′, Q4c): it never stops the model from
 * thinking, only from spending. Time spent waiting for the user is paused out.
 */
export class SoftBudget {
  readonly limits: SoftBudgetLimits;
  readonly #now: () => number;
  readonly #wrapUpAt: number;
  readonly #graceSteps: number;
  readonly #startedAt: number;
  #pausedAt: number | null = null;
  #pausedTotal = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  #calls = 0;
  #wrappingUp = false;
  #stepsSinceWrapUp = 0;

  constructor(limits: SoftBudgetLimits, now: () => number, opts: SoftBudgetOptions = {}) {
    this.limits = limits;
    this.#now = now;
    this.#wrapUpAt = opts.wrapUpAt ?? 0.85;
    this.#graceSteps = opts.graceSteps ?? 2;
    this.#startedAt = now();
  }

  addTokens(usage: { inputTokens: number; outputTokens: number }): void {
    this.#inputTokens += usage.inputTokens;
    this.#outputTokens += usage.outputTokens;
  }

  addCall(): void {
    this.#calls += 1;
  }

  /** While the model waits for a person the clock does not run (spec 05 §12.5). */
  pause(): void {
    this.#pausedAt ??= this.#now();
  }

  resume(): void {
    if (this.#pausedAt === null) return;
    this.#pausedTotal += this.#now() - this.#pausedAt;
    this.#pausedAt = null;
  }

  elapsedMs(): number {
    const pausedNow = this.#pausedAt === null ? 0 : this.#now() - this.#pausedAt;
    return this.#now() - this.#startedAt - this.#pausedTotal - pausedNow;
  }

  usage(): Usage {
    return { inputTokens: this.#inputTokens, outputTokens: this.#outputTokens, calls: this.#calls };
  }

  /** Largest share consumed on any limited axis; 0 when nothing is limited. */
  ratio(): number {
    const tokens =
      this.limits.maxTokens > 0
        ? (this.#inputTokens + this.#outputTokens) / this.limits.maxTokens
        : 0;
    const time = this.limits.maxMs > 0 ? this.elapsedMs() / this.limits.maxMs : 0;
    return Math.max(tokens, time);
  }

  /** Call once per model step, after its usage was added. */
  stepDone(): void {
    if (this.#wrappingUp) this.#stepsSinceWrapUp += 1;
    else if (this.ratio() >= this.#wrapUpAt) this.#wrappingUp = true;
  }

  phase(): BudgetPhase {
    const ratio = this.ratio();
    if (ratio >= 1) return 'exhausted';
    if (!this.#wrappingUp && ratio >= this.#wrapUpAt) this.#wrappingUp = true;
    if (this.#wrappingUp) {
      return this.#stepsSinceWrapUp >= this.#graceSteps ? 'exhausted' : 'wrapping-up';
    }
    return 'normal';
  }

  toEvent(): RunEventOf<'budget'> {
    return {
      type: 'budget',
      used: { ...this.usage(), elapsedMs: this.elapsedMs() },
      limit: {
        inputTokens: this.limits.maxTokens,
        outputTokens: 0,
        calls: 0,
        elapsedMs: this.limits.maxMs,
      },
      phase: this.phase(),
    };
  }
}
