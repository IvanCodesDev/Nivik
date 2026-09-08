import { generateText, Output, stepCountIs, tool } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMockModel } from './mock';

describe('createMockModel (AI SDK v7 contract lock)', () => {
  it('answers text turns with usage the SDK reports flat', async () => {
    const calls: number[] = [];
    const model = createMockModel(
      [
        { text: 'first', usage: { input: 3, output: 4 } },
        { text: 'second', usage: { input: 5, output: 6 } },
      ],
      { onCall: (i) => calls.push(i) },
    );
    const a = await generateText({ model, prompt: 'hi' });
    const b = await generateText({ model, prompt: 'hi' });
    const c = await generateText({ model, prompt: 'hi' });
    expect([a.text, b.text, c.text]).toEqual(['first', 'second', 'second']);
    expect(a.usage.inputTokens).toBe(3);
    expect(a.usage.outputTokens).toBe(4);
    expect(a.usage.totalTokens).toBe(7);
    expect(calls).toEqual([0, 1, 2]);
  });

  it('json turns parse through Output.object', async () => {
    const model = createMockModel([{ json: { ok: true } }]);
    const result = await generateText({
      model,
      prompt: 'Return {"ok": true}',
      output: Output.object({ schema: z.object({ ok: z.literal(true) }) }),
    });
    expect(result.output).toEqual({ ok: true });
  });

  it('tool turns show up as tool calls and stop after the configured step count', async () => {
    const model = createMockModel([{ toolCall: { name: 'ping', input: {} } }, { text: 'done' }]);
    const result = await generateText({
      model,
      prompt: 'Call the ping tool.',
      tools: {
        ping: tool({
          description: 'no-op',
          inputSchema: z.object({}),
          execute: async () => 'pong',
        }),
      },
      stopWhen: stepCountIs(2),
    });
    expect(result.steps.some((step) => step.toolCalls.length > 0)).toBe(true);
    expect(result.text).toBe('done');
  });

  it('error turns throw from the call', async () => {
    const model = createMockModel([{ error: new Error('boom') }]);
    await expect(generateText({ model, prompt: 'hi', maxRetries: 0 })).rejects.toThrow('boom');
  });
});
