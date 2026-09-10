import type { ModelMessage } from 'ai';

export interface TrimOptions {
  /** Steps (assistant turn + its tool results) kept verbatim at the tail. */
  keepRecentSteps?: number;
  /** One line standing in for an older tool result; defaults to name + truncated JSON. */
  summarize?(toolName: string, output: unknown): string;
  maxSummaryChars?: number;
}

const defaultSummarize = (toolName: string, output: unknown): string => {
  let text: string;
  try {
    text = typeof output === 'string' ? output : JSON.stringify(output);
  } catch {
    text = String(output);
  }
  return `${toolName} → ${text ?? ''}`;
};

interface ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: unknown;
}

const isToolResultPart = (part: unknown): part is ToolResultPart =>
  typeof part === 'object' &&
  part !== null &&
  (part as { type?: unknown }).type === 'tool-result' &&
  typeof (part as { toolName?: unknown }).toolName === 'string';

/**
 * Spec 05 §12.4 / design §2.5: a tool loop's conversation grows with every round trip. Older tool
 * results are replaced by one-line summaries; the last `keepRecentSteps` steps stay verbatim so the
 * model still sees what it just did. Messages from the user and the assistant are never touched.
 */
export function trimMessages(messages: ModelMessage[], opts: TrimOptions = {}): ModelMessage[] {
  const keep = opts.keepRecentSteps ?? 3;
  const summarize = opts.summarize ?? defaultSummarize;
  const maxChars = opts.maxSummaryChars ?? 120;

  const assistantIndexes = messages.flatMap((m, i) => (m.role === 'assistant' ? [i] : []));
  if (assistantIndexes.length <= keep) return messages;
  const boundary = assistantIndexes[assistantIndexes.length - keep] ?? messages.length;

  return messages.map((message, index) => {
    if (index >= boundary || message.role !== 'tool' || !Array.isArray(message.content)) {
      return message;
    }
    const content = message.content.map((part) => {
      if (!isToolResultPart(part)) return part;
      const raw = (part.output as { value?: unknown } | undefined)?.value ?? part.output;
      const line = summarize(part.toolName, raw).slice(0, maxChars);
      return { ...part, output: { type: 'text', value: line } };
    });
    return { ...message, content } as ModelMessage;
  });
}
