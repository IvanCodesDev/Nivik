import { RunError } from '@nivik/protocol';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Everything the core needs from its host. Both hosts (browser Worker and the Node runtime)
 * implement this; the core itself never touches timers, crypto or the network directly.
 * The model factory (`model(stage)`) joins this interface with the provider layer (task 1.5).
 */
export interface AgentDeps {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  newRunId(): string;
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void;
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
