import { RunError, type RunEvent } from '@nivik/protocol';
import { abortError } from '../deps';
import { type RunContext, throwIfAborted, toRunError } from './context';
import type { Stage, StageContext } from './stage';

const BACKOFF_BASE_MS = 1_000;

/**
 * Runs one stage with its budget, timeout and retry policy. Recoverable errors listed in
 * `stage.retry.on` are surfaced as non-terminal `error` events and retried with exponential
 * backoff; anything else propagates to the pipeline, which ends the run.
 */
export async function* runStage<I, O>(
  ctx: RunContext,
  stage: Stage<I, O>,
  input: I,
): AsyncGenerator<RunEvent, O> {
  for (let attempt = 0; ; attempt += 1) {
    throwIfAborted(ctx.signal);
    const budget = ctx.budget.fork(stage.budget);
    const timeoutMs = Math.min(stage.budget.timeoutMs, ctx.budget.remainingMs());
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([ctx.signal, timeout]);
    const stageCtx: StageContext = {
      runId: ctx.runId,
      attempt,
      budget,
      signal,
      now: ctx.deps.now,
      sleep: (ms) => ctx.deps.sleep(ms, signal),
      redact: ctx.redact,
      log: (message, data) => ctx.deps.log('debug', `[${stage.name}] ${message}`, data),
    };

    try {
      const generator = stage.run(stageCtx, input);
      for (;;) {
        const next = await generator.next();
        if (next.done) return next.value;
        throwIfAborted(ctx.signal);
        yield next.value;
      }
    } catch (error) {
      if (ctx.signal.aborted) throw abortError();
      const runError = timeout.aborted
        ? new RunError('E_BUDGET_EXCEEDED', `Stage "${stage.name}" exceeded ${timeoutMs}ms`)
        : toRunError(error);
      const retryable =
        runError.recoverable &&
        stage.retry.on.includes(runError.code) &&
        attempt < stage.retry.attempts;
      if (!retryable) throw runError;

      ctx.deps.log('warn', `[${stage.name}] attempt ${attempt + 1} failed, retrying`, {
        code: runError.code,
      });
      yield {
        type: 'error',
        code: runError.code,
        message: ctx.redact(runError.message),
        recoverable: true,
      };
      await ctx.deps.sleep(BACKOFF_BASE_MS * 2 ** attempt, ctx.signal);
    }
  }
}

/**
 * Spec 05 §12.1: the pipeline is plain TypeScript. `program` composes stages with
 * `yield* runStage(...)`; this wrapper guarantees the stream ends with exactly one terminal
 * event (`done`, or an `error` with `recoverable: false`) and that usage is reported.
 */
export async function* runPipeline(
  ctx: RunContext,
  program: (ctx: RunContext) => AsyncGenerator<RunEvent, void>,
): AsyncGenerator<RunEvent> {
  try {
    for await (const event of program(ctx)) {
      throwIfAborted(ctx.signal);
      yield event;
    }
    yield { type: 'usage', usage: ctx.budget.usage() };
    yield { type: 'done', runId: ctx.runId };
  } catch (error) {
    const runError = ctx.signal.aborted ? abortError() : toRunError(error);
    ctx.deps.log(runError.code === 'E_ABORTED' ? 'info' : 'error', 'run ended with error', {
      runId: ctx.runId,
      code: runError.code,
      message: ctx.redact(runError.message),
    });
    yield { type: 'usage', usage: ctx.budget.usage() };
    yield {
      type: 'error',
      code: runError.code,
      message: ctx.redact(runError.message),
      recoverable: false,
    };
  }
}
