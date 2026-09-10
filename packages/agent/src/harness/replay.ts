import type { LanguageModel } from 'ai';
import { createMockModel, type MockTurn } from '../providers/mock';
import type { Transcript } from './recorder';

/** The model side of a transcript as a script the mock provider can play back. */
export function replayTurns(transcript: Transcript): MockTurn[] {
  return transcript.steps.map((step) => ({
    ...(step.text ? { text: step.text } : {}),
    toolCalls: step.toolCalls.map((c) => ({ name: c.name, input: c.input })),
    usage: { input: step.usage.inputTokens, output: step.usage.outputTokens },
  }));
}

/**
 * Spec 05 §12.2 replay: a `LanguageModel` that returns exactly what the recorded model said, step
 * by step. Pair it with tools whose `execute` also answers from the transcript (`replayToolOutputs`)
 * and the run is deterministic with no network and no cost.
 */
export function createReplayModel(transcript: Transcript): LanguageModel {
  const turns = replayTurns(transcript);
  if (turns.length === 0) throw new Error('Cannot replay an empty transcript');
  return createMockModel(turns, { modelId: 'replay', provider: 'nivik-replay' });
}

/** Tool outputs by call id, for tool wrappers that must not recompute during replay. */
export function replayToolOutputs(transcript: Transcript): Map<string, unknown> {
  const outputs = new Map<string, unknown>();
  for (const step of transcript.steps) {
    for (const call of step.toolCalls) {
      if ('output' in call) outputs.set(call.call, call.output);
    }
  }
  return outputs;
}
