import { RunError, type Usage } from '@nivik/protocol';

export interface BudgetLimits {
  maxTokens: number;
  maxCalls: number;
  timeoutMs: number;
}

/**
 * Spec 05 §12.1: token / call / wall-clock budget. A stage tracker is forked from the run tracker
 * so every addition is counted at both levels and either limit can trip `E_BUDGET_EXCEEDED`.
 */
export class BudgetTracker {
  readonly limits: BudgetLimits;
  readonly #startedAt: number;
  readonly #now: () => number;
  readonly #parent: BudgetTracker | null;
  #inputTokens = 0;
  #outputTokens = 0;
  #calls = 0;

  constructor(limits: BudgetLimits, now: () => number, parent: BudgetTracker | null = null) {
    this.limits = limits;
    this.#now = now;
    this.#startedAt = now();
    this.#parent = parent;
  }

  fork(limits: BudgetLimits): BudgetTracker {
    return new BudgetTracker(limits, this.#now, this);
  }

  usage(): Usage {
    return { inputTokens: this.#inputTokens, outputTokens: this.#outputTokens, calls: this.#calls };
  }

  elapsedMs(): number {
    return this.#now() - this.#startedAt;
  }

  remainingMs(): number {
    return Math.max(0, this.limits.timeoutMs - this.elapsedMs());
  }

  addCall(): void {
    this.#calls += 1;
    this.#parent?.addCall();
    this.assertWithin();
  }

  addTokens(usage: Pick<Usage, 'inputTokens' | 'outputTokens'>): void {
    this.#inputTokens += usage.inputTokens;
    this.#outputTokens += usage.outputTokens;
    this.#parent?.addTokens(usage);
    this.assertWithin();
  }

  assertWithin(): void {
    const total = this.#inputTokens + this.#outputTokens;
    if (total > this.limits.maxTokens) {
      throw new RunError(
        'E_BUDGET_EXCEEDED',
        `Token budget exceeded: ${total} > ${this.limits.maxTokens}`,
      );
    }
    if (this.#calls > this.limits.maxCalls) {
      throw new RunError(
        'E_BUDGET_EXCEEDED',
        `Call budget exceeded: ${this.#calls} > ${this.limits.maxCalls}`,
      );
    }
    if (this.elapsedMs() > this.limits.timeoutMs) {
      throw new RunError(
        'E_BUDGET_EXCEEDED',
        `Time budget exceeded: ${this.elapsedMs()}ms > ${this.limits.timeoutMs}ms`,
      );
    }
  }
}
