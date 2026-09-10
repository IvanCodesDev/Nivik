/** FNV-1a 32-bit over the canonical JSON; the same in browsers and Node, no crypto needed. */
export function hashOf(value: unknown): string {
  const text = typeof value === 'string' ? value : stableJson(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** JSON with object keys sorted so equal values hash equal regardless of construction order. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
}

export interface RecordedToolCall {
  call: string;
  name: string;
  input: unknown;
  /** Hash of the tool's output; the output itself is kept when `keepOutputs` is on (replay). */
  resultHash: string | null;
  output?: unknown;
  durationMs: number;
  error?: string;
}

export interface RecordedStep {
  index: number;
  /** Prose the model produced in this step (may be empty when it only called tools). */
  text: string;
  toolCalls: RecordedToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  finishReason: string;
  elapsedMs: number;
}

/** Spec 05 §12.2: everything needed to replay a run without a model or the real tools. */
export interface Transcript {
  startedAt: number;
  steps: RecordedStep[];
}

export interface RecorderOptions {
  now(): number;
  /** Keep tool outputs verbatim (needed for replay); off for compact RunRecords. */
  keepOutputs?: boolean;
}

export interface Recorder {
  readonly transcript: Transcript;
  stepStarted(): void;
  text(delta: string): void;
  toolCalled(call: string, name: string, input: unknown): void;
  toolReturned(call: string, output: unknown): void;
  toolFailed(call: string, error: string): void;
  stepFinished(usage: { inputTokens: number; outputTokens: number }, finishReason: string): void;
}

/** Collects the loop's stream into a `Transcript`; one step = one model call and its tool results. */
export function createRecorder(opts: RecorderOptions): Recorder {
  const transcript: Transcript = { startedAt: opts.now(), steps: [] };
  let current: RecordedStep | null = null;
  let stepStartedAt = opts.now();
  const callStarted = new Map<string, number>();

  const ensureStep = (): RecordedStep => {
    if (current) return current;
    stepStartedAt = opts.now();
    current = {
      index: transcript.steps.length,
      text: '',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: 'unknown',
      elapsedMs: 0,
    };
    return current;
  };

  return {
    transcript,
    stepStarted() {
      ensureStep();
    },
    text(delta) {
      ensureStep().text += delta;
    },
    toolCalled(call, name, input) {
      callStarted.set(call, opts.now());
      ensureStep().toolCalls.push({ call, name, input, resultHash: null, durationMs: 0 });
    },
    toolReturned(call, output) {
      const entry = ensureStep().toolCalls.find((c) => c.call === call);
      if (!entry) return;
      entry.resultHash = hashOf(output);
      entry.durationMs = opts.now() - (callStarted.get(call) ?? opts.now());
      if (opts.keepOutputs) entry.output = output;
    },
    toolFailed(call, error) {
      const entry = ensureStep().toolCalls.find((c) => c.call === call);
      if (!entry) return;
      entry.error = error;
      entry.durationMs = opts.now() - (callStarted.get(call) ?? opts.now());
    },
    stepFinished(usage, finishReason) {
      const step = ensureStep();
      step.usage = usage;
      step.finishReason = finishReason;
      step.elapsedMs = opts.now() - stepStartedAt;
      transcript.steps.push(step);
      current = null;
    },
  };
}
