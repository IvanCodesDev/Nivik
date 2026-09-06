import { isTerminalEvent, type RunEvent, type RunStatus, type RunSummary } from '@nivik/protocol';

interface RunEntry {
  summary: RunSummary;
  controller: AbortController;
}

export interface RunRegistryOptions {
  /** How long finished runs stay queryable via `GET /v1/runs/:id`. */
  retainMs?: number;
  maxRunning?: number;
  now?: () => number;
}

export class RunConflictError extends Error {
  constructor(runId: string) {
    super(`Run "${runId}" already exists`);
    this.name = 'RunConflictError';
  }
}

export class RunCapacityError extends Error {
  constructor(max: number) {
    super(`Runtime is at capacity (${max} concurrent runs)`);
    this.name = 'RunCapacityError';
  }
}

/**
 * In-memory table of runs (spec 07 §1.2). The runtime is stateless across restarts by design:
 * RunRecords are persisted by the web app, this only serves cancellation and status polling.
 */
export class RunRegistry {
  readonly #entries = new Map<string, RunEntry>();
  readonly #retainMs: number;
  readonly #maxRunning: number;
  readonly #now: () => number;

  constructor(options: RunRegistryOptions = {}) {
    this.#retainMs = options.retainMs ?? 10 * 60_000;
    this.#maxRunning = options.maxRunning ?? 8;
    this.#now = options.now ?? Date.now;
  }

  start(runId: string): AbortController {
    this.sweep();
    if (this.#entries.has(runId)) throw new RunConflictError(runId);
    if (this.counts().running >= this.#maxRunning) throw new RunCapacityError(this.#maxRunning);
    const controller = new AbortController();
    this.#entries.set(runId, {
      controller,
      summary: { runId, status: 'running', startedAt: this.#now(), events: 0 },
    });
    return controller;
  }

  record(runId: string, event: RunEvent): void {
    const entry = this.#entries.get(runId);
    if (!entry) return;
    entry.summary.events += 1;
    if (!isTerminalEvent(event)) return;
    if (event.type === 'done') {
      this.#end(entry, 'done');
    } else if (event.type === 'error') {
      entry.summary.errorCode = event.code;
      this.#end(entry, event.code === 'E_ABORTED' ? 'aborted' : 'error');
    }
  }

  /** Marks a run finished if its stream ended without a terminal event (e.g. client went away). */
  finish(runId: string): void {
    const entry = this.#entries.get(runId);
    if (entry?.summary.status !== 'running') return;
    this.#end(entry, entry.controller.signal.aborted ? 'aborted' : 'error');
  }

  abort(runId: string): boolean {
    const entry = this.#entries.get(runId);
    if (entry?.summary.status !== 'running') return false;
    entry.controller.abort();
    return true;
  }

  get(runId: string): RunSummary | undefined {
    const entry = this.#entries.get(runId);
    return entry ? { ...entry.summary } : undefined;
  }

  counts(): { running: number; retained: number } {
    let running = 0;
    for (const entry of this.#entries.values()) {
      if (entry.summary.status === 'running') running += 1;
    }
    return { running, retained: this.#entries.size - running };
  }

  /** Drops finished runs older than `retainMs`; called on every start so no timers are needed. */
  sweep(): void {
    const cutoff = this.#now() - this.#retainMs;
    for (const [runId, entry] of this.#entries) {
      const endedAt = entry.summary.endedAt;
      if (endedAt !== undefined && endedAt < cutoff) this.#entries.delete(runId);
    }
  }

  #end(entry: RunEntry, status: RunStatus): void {
    entry.summary.status = status;
    entry.summary.endedAt = this.#now();
  }
}
