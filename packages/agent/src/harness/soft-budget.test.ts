import { describe, expect, it } from 'vitest';
import { SoftBudget } from './soft-budget';

function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
    },
  };
}

describe('SoftBudget (spec 05 §12.5)', () => {
  it('moves normal → wrapping-up at 85% → exhausted at 100%', () => {
    const c = clock();
    const budget = new SoftBudget({ maxTokens: 1000, maxMs: 0 }, c.now);
    budget.addTokens({ inputTokens: 500, outputTokens: 300 });
    budget.stepDone();
    expect(budget.phase()).toBe('normal');
    budget.addTokens({ inputTokens: 50, outputTokens: 0 });
    budget.stepDone();
    expect(budget.phase()).toBe('wrapping-up');
    budget.addTokens({ inputTokens: 200, outputTokens: 0 });
    expect(budget.phase()).toBe('exhausted');
  });

  it('gives the model two more steps after the notice, then declares exhaustion', () => {
    const c = clock();
    const budget = new SoftBudget({ maxTokens: 1000, maxMs: 0 }, c.now);
    budget.addTokens({ inputTokens: 860, outputTokens: 0 });
    budget.stepDone(); // notice raised at the end of this step
    expect(budget.phase()).toBe('wrapping-up');
    budget.stepDone();
    expect(budget.phase()).toBe('wrapping-up');
    budget.stepDone();
    expect(budget.phase()).toBe('exhausted');
  });

  it('counts wall-clock but not time spent waiting for the user', () => {
    const c = clock(1000);
    const budget = new SoftBudget({ maxTokens: 0, maxMs: 10_000 }, c.now);
    c.tick(4_000);
    budget.pause();
    c.tick(60_000);
    budget.resume();
    c.tick(2_000);
    expect(budget.elapsedMs()).toBe(6_000);
    expect(budget.phase()).toBe('normal');
    c.tick(3_000);
    expect(budget.phase()).toBe('wrapping-up');
    expect(budget.toEvent()).toMatchObject({
      type: 'budget',
      used: { elapsedMs: 9_000 },
      limit: { inputTokens: 0, elapsedMs: 10_000 },
      phase: 'wrapping-up',
    });
  });

  it('is unlimited when both axes are 0', () => {
    const budget = new SoftBudget({ maxTokens: 0, maxMs: 0 }, () => 0);
    budget.addTokens({ inputTokens: 10_000_000, outputTokens: 0 });
    for (let i = 0; i < 50; i += 1) budget.stepDone();
    expect(budget.ratio()).toBe(0);
    expect(budget.phase()).toBe('normal');
  });
});
