import type { DoneOutcome, RunEvent } from '@nivik/protocol';
import { hashOf, type Transcript } from './recorder';

/** Spec 05 §12.2 / design §7: how the loop behaved, not only what it produced. */
export interface ProcessMetrics {
  modelCalls: number;
  toolCalls: {
    total: number;
    byName: Record<string, number>;
    /** Calls repeating an earlier (name, input) pair exactly — the smell of a loop going in circles. */
    repeatedIdentical: number;
  };
  questions: number;
  /** `applyActions` rounds: how many times the model went back to the drawing. */
  applyRounds: number;
  /** Rejected actions over all actions the model tried; 0 when it tried none. */
  rejectedRatio: number;
  tokens: { input: number; output: number };
  elapsedMs: number;
  outcome: DoneOutcome | 'aborted' | 'error' | 'unknown';
}

export function processMetrics(
  transcript: Transcript,
  events: readonly RunEvent[],
  opts: { applyToolName?: string } = {},
): ProcessMetrics {
  const applyTool = opts.applyToolName ?? 'applyActions';
  const byName: Record<string, number> = {};
  const seen = new Set<string>();
  let total = 0;
  let repeated = 0;
  let input = 0;
  let output = 0;
  let elapsedMs = 0;
  for (const step of transcript.steps) {
    input += step.usage.inputTokens;
    output += step.usage.outputTokens;
    elapsedMs += step.elapsedMs;
    for (const call of step.toolCalls) {
      total += 1;
      byName[call.name] = (byName[call.name] ?? 0) + 1;
      const key = `${call.name}:${hashOf(call.input)}`;
      if (seen.has(key)) repeated += 1;
      else seen.add(key);
    }
  }

  let tried = 0;
  let rejected = 0;
  let outcome: ProcessMetrics['outcome'] = 'unknown';
  for (const event of events) {
    if (event.type === 'action') {
      tried += 1;
      if (!event.ok) rejected += 1;
    } else if (event.type === 'done') {
      outcome = event.outcome ?? 'finished';
    } else if (event.type === 'error' && !event.recoverable) {
      outcome = event.code === 'E_ABORTED' ? 'aborted' : 'error';
    }
  }

  return {
    modelCalls: transcript.steps.length,
    toolCalls: { total, byName, repeatedIdentical: repeated },
    questions: byName.ask ?? 0,
    applyRounds: byName[applyTool] ?? 0,
    rejectedRatio: tried === 0 ? 0 : rejected / tried,
    tokens: { input, output },
    elapsedMs,
    outcome,
  };
}
