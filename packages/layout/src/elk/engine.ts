import type { ElkLayoutArguments, ElkNode } from 'elkjs/lib/elk-api';
import type { ElkEngine } from '../types';

let bundled: Promise<ElkEngine> | null = null;

/**
 * In-thread ELK from `elkjs/lib/elk.bundled.js`, loaded on first use so bundlers can split the
 * 1.6 MB chunk. Runs in Node (tests, CI, scripts) and inside a browser Worker alike; `apps/web`
 * injects a Worker-backed engine through `LayoutOptions.engine` instead (spec 03 §5.4).
 */
export function createBundledEngine(): Promise<ElkEngine> {
  bundled ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => {
    const elk = new ELK();
    return {
      layout: (graph: ElkNode, args?: ElkLayoutArguments) => elk.layout(graph, args),
      terminate: () => elk.terminateWorker(),
    };
  });
  return bundled;
}

export class LayoutTimeoutError extends Error {
  constructor(ms: number) {
    super(`ELK did not answer within ${ms} ms`);
    this.name = 'LayoutTimeoutError';
  }
}

export class LayoutAbortedError extends Error {
  constructor() {
    super('layout aborted');
    this.name = 'AbortError';
  }
}

/** Races the engine against the time budget and the abort signal (spec 03 §5.4). */
export async function runElk(
  engine: ElkEngine,
  graph: ElkNode,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ElkNode> {
  if (signal?.aborted) throw new LayoutAbortedError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LayoutTimeoutError(timeoutMs)), timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new LayoutAbortedError());
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([engine.layout(graph), timeout, aborted]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
