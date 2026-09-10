import type { RunEvent, RunStage } from '@nivik/protocol';
import {
  hasToolCall,
  type LanguageModel,
  type ModelMessage,
  type StopCondition,
  streamText,
  type ToolSet,
} from 'ai';
import { abortError } from '../deps';
import { toRunError } from './context';
import { createRecorder, type Recorder, type Transcript } from './recorder';
import type { SoftBudget } from './soft-budget';
import { type TrimOptions, trimMessages } from './trim';

export interface ToolLoopOptions {
  model: LanguageModel;
  /** Static, or re-read before every step (hint packs join once the plan names a type). */
  system: string | (() => string);
  messages: ModelMessage[];
  tools: ToolSet;
  budget: SoftBudget;
  signal: AbortSignal;
  emit(event: RunEvent): void;
  now(): number;
  /** The tool whose call ends the loop; default `finish`. */
  finishTool?: string;
  /** Appended to the system prompt once the budget enters `wrapping-up`. */
  wrapUpNotice?: string;
  /** Which status a tool call implies (domain knowledge; the loop only forwards it). */
  stageOf?(toolName: string): RunStage | null;
  /** One-line rendering of a tool result for the trace and for trimmed history. */
  summarize?(toolName: string, output: unknown): string;
  trim?: Omit<TrimOptions, 'summarize'>;
  temperature?: number;
  maxOutputTokens?: number;
  /** Keep tool outputs in the transcript (replay); default true. */
  keepOutputs?: boolean;
}

export interface ToolLoopResult {
  /** The model called the finish tool. */
  finished: boolean;
  /** The soft budget ended the loop instead (design §2.6). */
  exhausted: boolean;
  aborted: boolean;
  steps: number;
  transcript: Transcript;
}

const DEFAULT_WRAP_UP =
  'Budget notice: you are almost out of budget. Stop exploring, call finish now and list anything left undone in `unresolved`.';

/**
 * D14′ / spec 05 §12.1: one open tool loop on top of AI SDK's multi-step `streamText`. Stops when
 * the model calls the finish tool, when the soft budget is exhausted, or when the host aborts.
 * Everything the model says or does becomes a `RunEvent`; the transcript makes it replayable.
 */
export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const finishTool = opts.finishTool ?? 'finish';
  const summarize = opts.summarize ?? defaultSummary;
  const recorder: Recorder = createRecorder({
    now: opts.now,
    keepOutputs: opts.keepOutputs ?? true,
  });
  const budgetExhausted: StopCondition<ToolSet> = () => opts.budget.phase() === 'exhausted';

  const callStarted = new Map<string, number>();
  const callInputs = new Map<string, unknown>();
  let stepText = '';
  let finished = false;
  let aborted = false;
  let steps = 0;

  const systemNow = () => (typeof opts.system === 'function' ? opts.system() : opts.system);

  const result = streamText({
    model: opts.model,
    system: systemNow(),
    messages: opts.messages,
    tools: opts.tools,
    abortSignal: opts.signal,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
    stopWhen: [hasToolCall(finishTool), budgetExhausted],
    prepareStep: ({ messages }) => {
      const trimmed = trimMessages(messages, { ...opts.trim, summarize });
      const wrappingUp = opts.budget.phase() !== 'normal';
      const system = systemNow();
      return {
        messages: trimmed,
        system: wrappingUp ? `${system}\n\n${opts.wrapUpNotice ?? DEFAULT_WRAP_UP}` : system,
      };
    },
  });

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'start-step':
          recorder.stepStarted();
          stepText = '';
          break;
        case 'text-delta':
          stepText += part.text;
          recorder.text(part.text);
          opts.emit({ type: 'reply', text: part.text, final: false });
          break;
        case 'tool-call': {
          callStarted.set(part.toolCallId, opts.now());
          callInputs.set(part.toolCallId, part.input);
          recorder.toolCalled(part.toolCallId, part.toolName, part.input);
          if (part.toolName === finishTool) finished = true;
          const stage = opts.stageOf?.(part.toolName);
          if (stage) opts.emit({ type: 'status', stage });
          opts.emit({
            type: 'tool',
            name: part.toolName,
            call: part.toolCallId,
            input: part.input,
            status: 'start',
            durationMs: 0,
          });
          break;
        }
        case 'tool-result': {
          const durationMs = opts.now() - (callStarted.get(part.toolCallId) ?? opts.now());
          recorder.toolReturned(part.toolCallId, part.output);
          opts.emit({
            type: 'tool',
            name: part.toolName,
            call: part.toolCallId,
            input: callInputs.get(part.toolCallId),
            status: 'end',
            durationMs,
            summary: summarize(part.toolName, part.output).slice(0, 300),
          });
          break;
        }
        case 'tool-error': {
          const durationMs = opts.now() - (callStarted.get(part.toolCallId) ?? opts.now());
          const message = part.error instanceof Error ? part.error.message : String(part.error);
          recorder.toolFailed(part.toolCallId, message);
          opts.emit({
            type: 'tool',
            name: part.toolName,
            call: part.toolCallId,
            input: callInputs.get(part.toolCallId),
            status: 'end',
            durationMs,
            summary: `error: ${message}`.slice(0, 300),
          });
          break;
        }
        case 'finish-step': {
          const usage = {
            inputTokens: part.usage.inputTokens ?? 0,
            outputTokens: part.usage.outputTokens ?? 0,
          };
          steps += 1;
          opts.budget.addTokens(usage);
          opts.budget.addCall();
          opts.budget.stepDone();
          recorder.stepFinished(usage, part.finishReason);
          if (stepText) opts.emit({ type: 'reply', text: '', final: true });
          opts.emit({ type: 'usage', usage: opts.budget.usage() });
          opts.emit(opts.budget.toEvent());
          break;
        }
        case 'abort':
          aborted = true;
          break;
        case 'error':
          throw toRunError(part.error);
        default:
          break;
      }
    }
  } catch (error) {
    if (opts.signal.aborted) throw abortError();
    throw toRunError(error);
  }
  if (opts.signal.aborted) throw abortError();

  return {
    finished,
    exhausted: !finished && !aborted && opts.budget.phase() === 'exhausted',
    aborted,
    steps,
    transcript: recorder.transcript,
  };
}

function defaultSummary(toolName: string, output: unknown): string {
  try {
    return `${toolName} → ${typeof output === 'string' ? output : JSON.stringify(output)}`;
  } catch {
    return toolName;
  }
}
