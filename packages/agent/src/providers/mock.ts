import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

/** One scripted model response; a turn is consumed per model call (generate or stream). */
export interface MockTurn {
  text?: string;
  /** Serialised as the text content so `Output.object` parses it. */
  json?: unknown;
  /** A single tool call (kept for the probe tests); `toolCalls` for several in one step. */
  toolCall?: { name: string; input: unknown };
  toolCalls?: { name: string; input: unknown }[];
  usage?: { input: number; output: number };
  /** Throw instead of answering (provider failures, timeouts). */
  error?: unknown;
}

export interface MockModelOptions {
  modelId?: string;
  provider?: string;
  /** Observes each call with the prompt the SDK sent (system + messages), for assertions. */
  onCall?(index: number, prompt: unknown): void;
}

const usageOf = (turn: MockTurn) => ({
  inputTokens: {
    total: turn.usage?.input ?? 10,
    noCache: turn.usage?.input ?? 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: turn.usage?.output ?? 5,
    text: turn.usage?.output ?? 5,
    reasoning: undefined,
  },
});

const toolCallsOf = (turn: MockTurn) => [
  ...(turn.toolCall ? [turn.toolCall] : []),
  ...(turn.toolCalls ?? []),
];

const textOf = (turn: MockTurn): string | null => {
  if (turn.json !== undefined) return JSON.stringify(turn.json);
  if (turn.text !== undefined) return turn.text;
  return toolCallsOf(turn).length === 0 ? '' : null;
};

/**
 * A `LanguageModel` that answers from a script (spec 05 §9 "mock provider"). Stages, probes and
 * the tool loop run against it in tests without a network; once the script is exhausted the last
 * turn repeats. Streams deliver the text in word-sized deltas so streaming consumers are exercised.
 */
export function createMockModel(turns: MockTurn[], opts: MockModelOptions = {}): LanguageModel {
  if (turns.length === 0) throw new Error('createMockModel needs at least one turn');
  let calls = 0;
  const next = (prompt: unknown): { turn: MockTurn; index: number } => {
    const index = calls;
    const turn = turns[Math.min(calls, turns.length - 1)] as MockTurn;
    opts.onCall?.(index, prompt);
    calls += 1;
    if (turn.error !== undefined) throw turn.error;
    return { turn, index };
  };
  const finishReason = (turn: MockTurn) => ({
    unified: toolCallsOf(turn).length > 0 ? ('tool-calls' as const) : ('stop' as const),
    raw: undefined,
  });

  return new MockLanguageModelV4({
    modelId: opts.modelId ?? 'mock-model',
    provider: opts.provider ?? 'nivik-mock',
    doGenerate: async (options) => {
      const { turn, index } = next(options.prompt);
      const text = textOf(turn);
      const content = [
        ...(text !== null ? [{ type: 'text' as const, text }] : []),
        ...toolCallsOf(turn).map((call, i) => ({
          type: 'tool-call' as const,
          toolCallId: `call_${index + 1}_${i + 1}`,
          toolName: call.name,
          input: JSON.stringify(call.input ?? {}),
        })),
      ];
      return { content, finishReason: finishReason(turn), usage: usageOf(turn), warnings: [] };
    },
    doStream: async (options) => {
      const { turn, index } = next(options.prompt);
      const text = textOf(turn);
      const textId = `text_${index + 1}`;
      const parts: unknown[] = [{ type: 'stream-start', warnings: [] }];
      if (text !== null && text !== '') {
        parts.push({ type: 'text-start', id: textId });
        for (const delta of text.match(/\S+\s*|\s+/g) ?? [text]) {
          parts.push({ type: 'text-delta', id: textId, delta });
        }
        parts.push({ type: 'text-end', id: textId });
      }
      toolCallsOf(turn).forEach((call, i) => {
        parts.push({
          type: 'tool-call',
          toolCallId: `call_${index + 1}_${i + 1}`,
          toolName: call.name,
          input: JSON.stringify(call.input ?? {}),
        });
      });
      parts.push({ type: 'finish', finishReason: finishReason(turn), usage: usageOf(turn) });
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }) as never,
      };
    },
  });
}
