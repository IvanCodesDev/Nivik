import { RunError, type RunEvent } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { type AgentDeps, createDefaultDeps } from '../deps';
import { BudgetTracker } from './budget';
import { createRunContext } from './context';
import { runPipeline, runStage } from './pipeline';
import { redact } from './redact';
import type { Stage } from './stage';

function testDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  return createDefaultDeps({ sleep: async () => {}, ...overrides });
}

async function collect(iterable: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

const LIMITS = { maxTokens: 1_000, maxCalls: 3, timeoutMs: 5_000 };

/** A stage that fails before producing any event. */
function failingStage(
  name: Stage<void, void>['name'],
  retry: Stage<void, void>['retry'],
  fail: () => never,
): Stage<void, void> {
  return {
    name,
    budget: { maxTokens: 100, maxCalls: 5, timeoutMs: 1_000 },
    retry,
    async *run() {
      yield* [];
      fail();
    },
  };
}

describe('BudgetTracker', () => {
  it('counts usage at both the stage and the run level', () => {
    let now = 0;
    const run = new BudgetTracker(LIMITS, () => now);
    const stage = run.fork({ maxTokens: 500, maxCalls: 1, timeoutMs: 1_000 });
    stage.addCall();
    stage.addTokens({ inputTokens: 100, outputTokens: 50 });
    now = 200;
    expect(stage.usage()).toEqual({ inputTokens: 100, outputTokens: 50, calls: 1 });
    expect(run.usage()).toEqual({ inputTokens: 100, outputTokens: 50, calls: 1 });
    expect(run.elapsedMs()).toBe(200);
    expect(run.remainingMs()).toBe(4_800);
  });

  it('throws E_BUDGET_EXCEEDED when any limit is crossed', () => {
    const run = new BudgetTracker(LIMITS, () => 0);
    const stage = run.fork({ maxTokens: 100, maxCalls: 5, timeoutMs: 1_000 });
    expect(() => stage.addTokens({ inputTokens: 101, outputTokens: 0 })).toThrowError(
      expect.objectContaining({ code: 'E_BUDGET_EXCEEDED' }),
    );
    const calls = new BudgetTracker({ ...LIMITS, maxCalls: 1 }, () => 0);
    calls.addCall();
    expect(() => calls.addCall()).toThrow(RunError);
  });
});

describe('redact', () => {
  it('masks credentials in every supported shape', () => {
    const input = [
      'key sk-abcdefghijklmnop123',
      'Authorization: Bearer eyJhbGciOi.payload.sig',
      'x-api-key: 9f8e7d6c5b4a',
      'goog AIzaSyA-1234567890abcdefghijklmn',
    ].join(' | ');
    const output = redact(input);
    expect(output).not.toContain('sk-abcdefghijklmnop123');
    expect(output).not.toContain('eyJhbGciOi');
    expect(output).not.toContain('9f8e7d6c5b4a');
    expect(output).not.toContain('AIzaSyA-1234567890abcdefghijklmn');
    expect(output).toContain('Bearer ***');
    expect(output).toContain('x-api-key: ***');
  });
});

describe('runStage / runPipeline', () => {
  const okStage: Stage<number, number> = {
    name: 'plan',
    budget: { maxTokens: 100, maxCalls: 1, timeoutMs: 1_000 },
    retry: { attempts: 0, on: [] },
    async *run(ctx, input) {
      ctx.budget.addCall();
      ctx.budget.addTokens({ inputTokens: 10, outputTokens: 5 });
      yield { type: 'status', stage: 'planning' };
      return input * 2;
    },
  };

  it('threads stage output through the program and terminates with usage + done', async () => {
    const ctx = createRunContext({ runId: 'run_test_0001', deps: testDeps(), limits: LIMITS });
    let doubled = 0;
    const events = await collect(
      runPipeline(ctx, async function* program() {
        doubled = yield* runStage(ctx, okStage, 21);
      }),
    );
    expect(doubled).toBe(42);
    expect(events).toEqual([
      { type: 'status', stage: 'planning' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, calls: 1 } },
      { type: 'done', runId: 'run_test_0001' },
    ]);
  });

  it('retries recoverable errors listed in the policy and surfaces them as non-terminal', async () => {
    let attempts = 0;
    const flaky: Stage<void, string> = {
      name: 'build',
      budget: { maxTokens: 100, maxCalls: 5, timeoutMs: 1_000 },
      retry: { attempts: 2, on: ['E_PROVIDER_RATE_LIMIT'] },
      async *run() {
        attempts += 1;
        if (attempts < 3)
          throw new RunError('E_PROVIDER_RATE_LIMIT', 'slow down sk-secretkey123456');
        yield { type: 'status', stage: 'building' };
        return 'ok';
      },
    };
    const sleeps: number[] = [];
    const deps = testDeps({
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const ctx = createRunContext({ runId: 'run_test_0002', deps, limits: LIMITS });
    const events = await collect(
      runPipeline(ctx, async function* program() {
        yield* runStage(ctx, flaky, undefined);
      }),
    );
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([1_000, 2_000]);
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.type === 'error' && e.recoverable)).toBe(true);
    expect(errors[0]?.type === 'error' && errors[0].message).toBe('slow down ***');
    expect(events.at(-1)).toEqual({ type: 'done', runId: 'run_test_0002' });
  });

  it('gives up with a terminal error when retries are exhausted', async () => {
    const failing = failingStage('build', { attempts: 1, on: ['E_PROVIDER_TIMEOUT'] }, () => {
      throw new RunError('E_PROVIDER_TIMEOUT', 'timed out');
    });
    const ctx = createRunContext({ runId: 'run_test_0003', deps: testDeps(), limits: LIMITS });
    const events = await collect(
      runPipeline(ctx, async function* program() {
        yield* runStage(ctx, failing, undefined);
      }),
    );
    expect(events.map((e) => e.type)).toEqual(['error', 'usage', 'error']);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'E_PROVIDER_TIMEOUT',
      recoverable: false,
    });
  });

  it('maps unknown exceptions to E_INTERNAL', async () => {
    const boom = failingStage('plan', { attempts: 0, on: [] }, () => {
      throw new TypeError('undefined is not a function');
    });
    const ctx = createRunContext({ runId: 'run_test_0004', deps: testDeps(), limits: LIMITS });
    const events = await collect(
      runPipeline(ctx, async function* program() {
        yield* runStage(ctx, boom, undefined);
      }),
    );
    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'E_INTERNAL',
      message: 'undefined is not a function',
      recoverable: false,
    });
  });

  it('ends with E_ABORTED when the signal fires mid-stage', async () => {
    const controller = new AbortController();
    const slow: Stage<void, void> = {
      name: 'build',
      budget: { maxTokens: 100, maxCalls: 5, timeoutMs: 1_000 },
      retry: { attempts: 0, on: [] },
      async *run(ctx) {
        yield { type: 'status', stage: 'building' };
        await ctx.sleep(10_000);
        yield { type: 'status', stage: 'validating' };
      },
    };
    const ctx = createRunContext({
      runId: 'run_test_0005',
      deps: createDefaultDeps(),
      limits: LIMITS,
      signal: controller.signal,
    });
    const events: RunEvent[] = [];
    for await (const event of runPipeline(ctx, async function* program() {
      yield* runStage(ctx, slow, undefined);
    })) {
      events.push(event);
      if (event.type === 'status' && event.stage === 'building') controller.abort();
    }
    expect(events.map((e) => e.type)).toEqual(['status', 'usage', 'error']);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'E_ABORTED', recoverable: false });
  });

  it('converts a stage timeout into E_BUDGET_EXCEEDED', async () => {
    const hang: Stage<void, void> = {
      name: 'build',
      budget: { maxTokens: 100, maxCalls: 5, timeoutMs: 20 },
      retry: { attempts: 0, on: [] },
      async *run(ctx) {
        await ctx.sleep(5_000);
        yield { type: 'status', stage: 'validating' };
      },
    };
    const ctx = createRunContext({
      runId: 'run_test_0006',
      deps: createDefaultDeps(),
      limits: LIMITS,
    });
    const events = await collect(
      runPipeline(ctx, async function* program() {
        yield* runStage(ctx, hang, undefined);
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'E_BUDGET_EXCEEDED' });
  });
});
