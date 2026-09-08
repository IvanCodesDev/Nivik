import type { LanguageModel, LanguageModelUsage } from 'ai';
import { abortError } from '../deps';
import { toProviderError } from '../providers/errors';
import type { StageContext } from './stage';

export interface ModelCallResult<T> {
  value: T;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Spec 05 §12.1: every model call a stage makes goes through here so the call and its tokens are
 * charged to the stage (and, through the fork, the run) budget, the stage's signal cancels it, and
 * whatever the provider throws comes back as a `RunError` the recovery policy understands.
 */
export async function callModel<T>(
  ctx: StageContext,
  fn: (
    model: LanguageModel,
    signal: AbortSignal,
  ) => Promise<{ value: T; usage: LanguageModelUsage | undefined }>,
): Promise<ModelCallResult<T>> {
  ctx.budget.addCall();
  const model = ctx.model();
  try {
    const result = await fn(model, ctx.signal);
    // A provider may ignore the signal and answer anyway; a cancelled run must not continue.
    if (ctx.signal.aborted) throw abortError();
    const usage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    };
    ctx.budget.addTokens(usage);
    return { value: result.value, usage };
  } catch (error) {
    throw toProviderError(error);
  }
}
