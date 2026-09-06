import type { RunEvent, RunRequest } from '@nivik/protocol';

export interface RunOptions {
  signal?: AbortSignal;
}

/**
 * What a host drives: one call, one event stream, ending with a terminal event. The runtime
 * (`apps/agent`) and the browser Worker wrap the same implementation.
 */
export interface Agent {
  run(request: RunRequest, options?: RunOptions): AsyncGenerator<RunEvent>;
}
