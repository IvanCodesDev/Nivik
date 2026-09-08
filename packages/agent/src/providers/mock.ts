import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

/** One scripted model response; a turn is consumed per `generateText` call. */
export interface MockTurn {
  text?: string;
  /** Serialised as the text content so `Output.object` parses it. */
  json?: unknown;
  toolCall?: { name: string; input: unknown };
  usage?: { input: number; output: number };
  /** Throw instead of answering (provider failures, timeouts). */
  error?: unknown;
}

export interface MockModelOptions {
  modelId?: string;
  provider?: string;
  onCall?(index: number): void;
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

/**
 * A `LanguageModel` that answers from a script (spec 05 §9 "mock provider"). Stages and probes
 * run against it in tests without a network; once the script is exhausted the last turn repeats.
 */
export function createMockModel(turns: MockTurn[], opts: MockModelOptions = {}): LanguageModel {
  if (turns.length === 0) throw new Error('createMockModel needs at least one turn');
  let calls = 0;
  return new MockLanguageModelV4({
    modelId: opts.modelId ?? 'mock-model',
    provider: opts.provider ?? 'nivik-mock',
    doGenerate: async () => {
      const turn = turns[Math.min(calls, turns.length - 1)] as MockTurn;
      opts.onCall?.(calls);
      calls += 1;
      if (turn.error !== undefined) throw turn.error;
      const content = turn.toolCall
        ? [
            {
              type: 'tool-call' as const,
              toolCallId: `call_${calls}`,
              toolName: turn.toolCall.name,
              input: JSON.stringify(turn.toolCall.input ?? {}),
            },
          ]
        : [
            {
              type: 'text' as const,
              text: turn.json !== undefined ? JSON.stringify(turn.json) : (turn.text ?? ''),
            },
          ];
      return {
        content,
        finishReason: {
          unified: turn.toolCall ? ('tool-calls' as const) : ('stop' as const),
          raw: undefined,
        },
        usage: usageOf(turn),
        warnings: [],
      };
    },
  });
}
