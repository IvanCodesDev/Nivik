import { RunError, type RunEvent } from '@nivik/protocol';
import { tool } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMockModel } from '../providers/mock';
import { runToolLoop } from './loop';
import { processMetrics } from './metrics';
import { createQuestions } from './questions';
import { createReplayModel } from './replay';
import { SoftBudget } from './soft-budget';
import { trimMessages } from './trim';

function clock() {
  let t = 1_000;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
    },
  };
}

/** A tiny tool set: a lookup, a counter with side effects, and finish. */
function tools(log: string[]) {
  return {
    lookup: tool({
      description: 'Look something up',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        log.push(`lookup:${query}`);
        return { hits: [`${query}-1`, `${query}-2`] };
      },
    }),
    finish: tool({
      description: 'Done',
      inputSchema: z.object({ summary: z.string() }),
      execute: async ({ summary }) => {
        log.push(`finish:${summary}`);
        return { ok: true };
      },
    }),
  };
}

describe('runToolLoop', () => {
  it('runs tool steps until the model calls finish, emitting a full trace', async () => {
    const c = clock();
    const log: string[] = [];
    const events: RunEvent[] = [];
    const model = createMockModel([
      { text: 'Let me check.', toolCalls: [{ name: 'lookup', input: { query: 'login' } }] },
      { toolCalls: [{ name: 'finish', input: { summary: 'All good' } }] },
    ]);
    const budget = new SoftBudget({ maxTokens: 0, maxMs: 0 }, c.now);

    const result = await runToolLoop({
      model,
      system: 'You are a test.',
      messages: [{ role: 'user', content: 'Go' }],
      tools: tools(log),
      budget,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      now: c.now,
      stageOf: (name) => (name === 'lookup' ? 'reading' : null),
    });

    expect(result).toMatchObject({ finished: true, exhausted: false, aborted: false, steps: 2 });
    expect(log).toEqual(['lookup:login', 'finish:All good']);
    const kinds = events.map((e) => e.type);
    expect(kinds.filter((k) => k === 'reply').length).toBeGreaterThan(1);
    expect(kinds).toContain('status');
    expect(events.filter((e) => e.type === 'tool')).toHaveLength(4);
    expect(
      events.find((e) => e.type === 'tool' && e.status === 'end' && e.name === 'lookup'),
    ).toMatchObject({
      summary: 'lookup → {"hits":["login-1","login-2"]}',
    });
    expect(events.filter((e) => e.type === 'usage')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'budget')).toHaveLength(2);
    expect(budget.usage()).toEqual({ inputTokens: 20, outputTokens: 10, calls: 2 });

    const replies = events.filter((e) => e.type === 'reply');
    expect(replies.map((r) => r.text).join('')).toBe('Let me check.');
    expect(replies.at(-1)).toMatchObject({ final: true });

    expect(result.transcript.steps).toHaveLength(2);
    expect(result.transcript.steps[0]).toMatchObject({
      text: 'Let me check.',
      toolCalls: [{ name: 'lookup', input: { query: 'login' } }],
      finishReason: 'tool-calls',
    });
    expect(result.transcript.steps[0]?.toolCalls[0]?.output).toEqual({
      hits: ['login-1', 'login-2'],
    });

    const metrics = processMetrics(result.transcript, events);
    expect(metrics).toMatchObject({
      modelCalls: 2,
      toolCalls: { total: 2, byName: { lookup: 1, finish: 1 }, repeatedIdentical: 0 },
      questions: 0,
      tokens: { input: 20, output: 10 },
    });
  });

  it('stops for the budget: the wrap-up notice reaches the system prompt and the loop ends exhausted', async () => {
    const c = clock();
    const log: string[] = [];
    const model = createMockModel([
      { toolCalls: [{ name: 'lookup', input: { query: 'a' } }], usage: { input: 80, output: 10 } },
      { toolCalls: [{ name: 'lookup', input: { query: 'b' } }], usage: { input: 1, output: 1 } },
      { toolCalls: [{ name: 'lookup', input: { query: 'c' } }], usage: { input: 1, output: 1 } },
      { toolCalls: [{ name: 'lookup', input: { query: 'd' } }], usage: { input: 1, output: 1 } },
    ]);
    const budget = new SoftBudget({ maxTokens: 100, maxMs: 0 }, c.now);
    const events: RunEvent[] = [];
    const result = await runToolLoop({
      model,
      system: 'SYS',
      messages: [{ role: 'user', content: 'Go' }],
      tools: {
        ...tools(log),
        lookup: tool({
          description: 'Look',
          inputSchema: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            log.push(query);
            return { query };
          },
        }),
      },
      budget,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      now: c.now,
      wrapUpNotice: 'WRAP UP NOW',
    });
    // 90 of 100 tokens after step 1 → wrapping-up; two grace steps → exhausted after step 3.
    expect(result.finished).toBe(false);
    expect(result.exhausted).toBe(true);
    expect(result.steps).toBe(3);
    expect(log).toEqual(['a', 'b', 'c']);
    const phases = events.filter((e) => e.type === 'budget').map((e) => e.phase);
    expect(phases).toEqual(['wrapping-up', 'wrapping-up', 'exhausted']);
    // The notice is in the system prompt from the second step on.
    const calls = (
      model as unknown as { doStreamCalls: { prompt: { role: string; content: unknown }[] }[] }
    ).doStreamCalls;
    const systemOf = (i: number) =>
      String(calls[i]?.prompt.find((m) => m.role === 'system')?.content ?? '');
    expect(systemOf(0)).not.toContain('WRAP UP NOW');
    expect(systemOf(1)).toContain('WRAP UP NOW');
    expect(systemOf(2)).toContain('WRAP UP NOW');
  });

  it('aborts cleanly while a tool waits for an answer', async () => {
    const c = clock();
    const controller = new AbortController();
    const questions = createQuestions({ signal: controller.signal, now: c.now, newId: () => 'q1' });
    const model = createMockModel([
      { toolCalls: [{ name: 'ask', input: { text: 'Which colour?' } }] },
      { toolCalls: [{ name: 'finish', input: { summary: 'x' } }] },
    ]);
    const events: RunEvent[] = [];
    const run = runToolLoop({
      model,
      system: 'SYS',
      messages: [{ role: 'user', content: 'Go' }],
      tools: {
        ask: tool({
          description: 'Ask',
          inputSchema: z.object({ text: z.string() }),
          execute: async ({ text }) => {
            const { answer } = questions.ask({ text, allowFreeText: true });
            return { answer: await answer };
          },
        }),
        finish: tools([]).finish,
      },
      budget: new SoftBudget({ maxTokens: 0, maxMs: 0 }, c.now),
      signal: controller.signal,
      emit: (e) => events.push(e),
      now: c.now,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(questions.pending().map((q) => q.text)).toEqual(['Which colour?']);
    controller.abort();
    await expect(run).rejects.toMatchObject({ code: 'E_ABORTED' });
    expect(questions.pending()).toEqual([]);
  });

  it('lets an answer resume the loop', async () => {
    const c = clock();
    const controller = new AbortController();
    const questions = createQuestions({ signal: controller.signal, now: c.now, newId: () => 'q1' });
    const log: string[] = [];
    const model = createMockModel([
      { toolCalls: [{ name: 'ask', input: { text: 'Which colour?' } }] },
      { text: 'Blue it is.', toolCalls: [{ name: 'finish', input: { summary: 'blue' } }] },
    ]);
    const run = runToolLoop({
      model,
      system: 'SYS',
      messages: [{ role: 'user', content: 'Go' }],
      tools: {
        ask: tool({
          description: 'Ask',
          inputSchema: z.object({ text: z.string() }),
          execute: async ({ text }) => {
            const { answer } = questions.ask({ text, allowFreeText: true });
            const reply = await answer;
            log.push(`answered:${reply}`);
            return { answer: reply };
          },
        }),
        finish: tools(log).finish,
      },
      budget: new SoftBudget({ maxTokens: 0, maxMs: 0 }, c.now),
      signal: controller.signal,
      emit: () => {},
      now: c.now,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(questions.answer('nope', 'x')).toBe(false);
    expect(questions.answer('q1', 'Blue')).toBe(true);
    const result = await run;
    expect(result.finished).toBe(true);
    expect(log).toEqual(['answered:Blue', 'finish:blue']);
  });

  it('replays a transcript into the same events', async () => {
    const c = clock();
    const log: string[] = [];
    const first: RunEvent[] = [];
    const scripted = createMockModel([
      { text: 'Checking.', toolCalls: [{ name: 'lookup', input: { query: 'x' } }] },
      { toolCalls: [{ name: 'finish', input: { summary: 'done' } }] },
    ]);
    const base = {
      system: 'SYS',
      messages: [{ role: 'user' as const, content: 'Go' }],
      signal: new AbortController().signal,
      now: c.now,
    };
    const recorded = await runToolLoop({
      ...base,
      model: scripted,
      tools: tools(log),
      budget: new SoftBudget({ maxTokens: 0, maxMs: 0 }, c.now),
      emit: (e) => first.push(e),
    });

    const second: RunEvent[] = [];
    const replayed = await runToolLoop({
      ...base,
      model: createReplayModel(recorded.transcript),
      tools: tools([]),
      budget: new SoftBudget({ maxTokens: 0, maxMs: 0 }, c.now),
      emit: (e) => second.push(e),
    });
    expect(replayed.finished).toBe(true);
    const strip = (events: RunEvent[]) =>
      events.map((e) => (e.type === 'tool' ? { ...e, durationMs: 0 } : e));
    expect(strip(second)).toEqual(strip(first));
  });

  it('surfaces model failures as run errors', async () => {
    const c = clock();
    const model = createMockModel([{ error: new RunError('E_PROVIDER_RATE_LIMIT', 'slow down') }]);
    await expect(
      runToolLoop({
        model,
        system: 'SYS',
        messages: [{ role: 'user', content: 'Go' }],
        tools: tools([]),
        budget: new SoftBudget({ maxTokens: 0, maxMs: 0 }, c.now),
        signal: new AbortController().signal,
        emit: () => {},
        now: c.now,
      }),
    ).rejects.toBeInstanceOf(RunError);
  });
});

describe('trimMessages', () => {
  it('summarises tool results older than the recent steps and leaves the rest alone', () => {
    const step = (i: number) => [
      {
        role: 'assistant' as const,
        content: [
          { type: 'tool-call' as const, toolCallId: `c${i}`, toolName: 'lookup', input: { q: i } },
        ],
      },
      {
        role: 'tool' as const,
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: `c${i}`,
            toolName: 'lookup',
            output: { type: 'json' as const, value: { hits: [i, i, i] } },
          },
        ],
      },
    ];
    const messages = [
      { role: 'user' as const, content: 'Go' },
      ...step(1),
      ...step(2),
      ...step(3),
      ...step(4),
    ];
    const trimmed = trimMessages(messages, { keepRecentSteps: 2 });
    const outputs = trimmed
      .filter((m) => m.role === 'tool')
      .map((m) => (Array.isArray(m.content) ? (m.content[0] as { output: unknown }).output : null));
    expect(outputs[0]).toEqual({ type: 'text', value: 'lookup → {"hits":[1,1,1]}' });
    expect(outputs[1]).toEqual({ type: 'text', value: 'lookup → {"hits":[2,2,2]}' });
    expect(outputs[2]).toEqual({ type: 'json', value: { hits: [3, 3, 3] } });
    expect(outputs[3]).toEqual({ type: 'json', value: { hits: [4, 4, 4] } });
    expect(trimmed[0]).toEqual(messages[0]);
    const short = messages.slice(0, 5);
    expect(trimMessages(short, { keepRecentSteps: 3 })).toBe(short);
  });
});
