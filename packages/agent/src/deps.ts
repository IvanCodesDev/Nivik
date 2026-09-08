import { RunError } from '@nivik/protocol';
import type { LanguageModel } from 'ai';
import type { StageName } from './harness/stage';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Spec 05 §9.5 / §12.1: which model a stage talks to; the host builds it from the provider layer. */
export type ModelResolver = (stage: StageName) => LanguageModel;

/**
 * Everything the core needs from its host. Both hosts (browser Worker and the Node runtime)
 * implement this; the core itself never touches timers, crypto or the network directly.
 * `model` is optional so model-free agents (the mock) keep working; stages that need one get
 * `E_INTERNAL` when it is missing.
 */
export interface AgentDeps {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  newRunId(): string;
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void;
  model?: ModelResolver;
}

/** Standard-library implementation; works unchanged in browsers, Workers and Node ≥ 20. */
export function createDefaultDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  return {
    now: () => Date.now(),
    sleep: sleepWithSignal,
    newRunId: () => `run_${globalThis.crypto.randomUUID()}`,
    log: () => {},
    ...overrides,
  };
}

export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function abortError(): RunError {
  return new RunError('E_ABORTED', 'Run cancelled');
}
