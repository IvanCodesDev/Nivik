import { APICallError, generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { type AgentDeps, createDefaultDeps } from '../deps';
import { createMockModel } from '../providers/mock';
import { createRunContext } from './context';
import { callModel } from './model';
import { runPipeline, runStage } from './pipeline';
import type { Stage } from './stage';

const LIMITS = { maxTokens: 1_000, maxCalls: 3, timeoutMs: 5_000 };

/** A stage that asks the model one question and returns its answer. */
const askStage = (
  budget = { maxTokens: 500, maxCalls: 1, timeoutMs: 1_000 },
): Stage<string, string> => ({
  name: 'plan',
  budget,
  retry: { attempts: 0, on: [] },
  async *run(ctx, prompt) {
    yield { type: 'status', stage: 'planning' };
    const { value } = await callModel(ctx, async (model, signal) => {
      const result = await generateText({ model, prompt, abortSignal: signal, maxRetries: 0 });
      return { value: result.text, usage: result.usage };
    });
    return value;
  },
});

async function runOnce(deps: AgentDeps, stage = askStage()) {
  const ctx = createRunContext({ runId: 'run_test_model', deps, limits: LIMITS });
  const events = [];
  let output: string | undefined;
  for await (const event of runPipeline(ctx, async function* program() {
    output = yield* runStage(ctx, stage, 'hello');
  })) {
    events.push(event);
  }
  return { ctx, events, output };
}

describe('callModel / ctx.model (spec 05 §12.1)', () => {
  it('routes the stage to the host-resolved model and charges call + tokens to the budgets', async () => {
    const stages: string[] = [];
    const deps = createDefaultDeps({
      sleep: async () => {},
      model: (stage) => {
        stages.push(stage);
        return createMockModel([{ text: 'OK', usage: { input: 5, output: 7 } }]);
      },
    });
    const { ctx, events, output } = await runOnce(deps);
    expect(output).toBe('OK');
    expect(stages).toEqual(['plan']);
    expect(ctx.budget.usage()).toEqual({ inputTokens: 5, outputTokens: 7, calls: 1 });
    expect(events.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      usage: { inputTokens: 5, outputTokens: 7, calls: 1 },
    });
    expect(events.at(-1)?.type).toBe('done');
  });

  it('fails with E_INTERNAL when the host provided no model', async () => {
    const { events } = await runOnce(createDefaultDeps({ sleep: async () => {} }));
    const terminal = events.at(-1);
    expect(terminal).toMatchObject({ type: 'error', code: 'E_INTERNAL', recoverable: false });
    if (terminal?.type === 'error') expect(terminal.message).toContain('No model configured');
  });

  it('refuses the call when the stage has no call budget left', async () => {
    const deps = createDefaultDeps({
      sleep: async () => {},
      model: () => createMockModel([{ text: 'never' }]),
    });
    const { events, ctx } = await runOnce(
      deps,
      askStage({ maxTokens: 500, maxCalls: 0, timeoutMs: 1_000 }),
    );
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'E_BUDGET_EXCEEDED' });
    expect(ctx.budget.usage().inputTokens).toBe(0);
  });

  it('maps provider failures to run errors (401 is not retried)', async () => {
    const deps = createDefaultDeps({
      sleep: async () => {},
      model: () =>
        createMockModel([
          {
            error: new APICallError({
              message: 'unauthorized',
              url: 'https://x',
              requestBodyValues: {},
              statusCode: 401,
              responseHeaders: {},
              responseBody: '',
            }),
          },
        ]),
    });
    const { events } = await runOnce(deps);
    expect(events.filter((e) => e.type === 'error')).toEqual([
      expect.objectContaining({ type: 'error', code: 'E_PROVIDER_AUTH', recoverable: false }),
    ]);
  });

  it('cancelling the run aborts the in-flight model call', async () => {
    const controller = new AbortController();
    const deps = createDefaultDeps({
      sleep: async () => {},
      model: () =>
        createMockModel([{ text: 'late' }], {
          onCall: () => controller.abort(),
        }),
    });
    const ctx = createRunContext({
      runId: 'run_abort',
      deps,
      limits: LIMITS,
      signal: controller.signal,
    });
    const events = [];
    for await (const event of runPipeline(ctx, async function* program() {
      yield* runStage(ctx, askStage(), 'hello');
    })) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'E_ABORTED' });
  });
});
