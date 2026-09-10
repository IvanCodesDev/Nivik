import { createDefaultDeps, createMockAgent } from '@nivik/agent';
import { createDiagram } from '@nivik/ir';
import type { RunEvent, RunRequestInput } from '@nivik/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../agent/src/app';
import { HttpAgentClient, WorkerAgentClient, type WorkerLike } from './agent-client';
import { createWorkerHost, type WorkerOutbound } from './agent-worker-protocol';
import { buildRunRequest } from './run-request';

const NOW = 1_700_000_000_000;
const settings = { defaultModel: '', providers: [] };

const request = (prompt: string, runId = 'run_worker_0001'): RunRequestInput => ({
  ...buildRunRequest({
    diagram: createDiagram({ id: 'd_worker', name: 'x', type: 'generic', now: NOW }),
    prompt,
    renderer: 'excalidraw',
    settings,
  }),
  runId,
});

const mockAgent = () => (deps: Parameters<typeof createMockAgent>[0]) =>
  createMockAgent(deps, { paceMs: 0 });

const bootstrap = {
  providers: [],
  keys: {},
  defaultProviderId: null,
  fastProviderId: null,
  runtimeUrl: null,
};

describe('createWorkerHost', () => {
  it('streams the run as event messages and closes with end', async () => {
    const posted: WorkerOutbound[] = [];
    const host = createWorkerHost((m) => posted.push(m), mockAgent(), { deps: { now: () => NOW } });
    await host.handle({ type: 'start', request: request('A -> B'), ...bootstrap });
    expect(posted[0]).toEqual({ type: 'event', event: { type: 'status', stage: 'understanding' } });
    expect(posted.some((m) => m.type === 'event' && m.event.type === 'changeSet')).toBe(true);
    expect(posted.at(-2)).toMatchObject({ type: 'event', event: { type: 'done' } });
    expect(posted.at(-1)).toEqual({ type: 'end' });
    expect(host.running).toBe(false);
  });

  it('cancel aborts the run in flight', async () => {
    const posted: WorkerOutbound[] = [];
    const host = createWorkerHost(
      (m) => {
        posted.push(m);
        if (m.type === 'event' && m.event.type === 'status' && m.event.stage === 'building') {
          void host.handle({ type: 'cancel' });
        }
      },
      (deps) => createMockAgent(deps, { paceMs: 20 }),
    );
    await host.handle({ type: 'start', request: request('A -> B -> C'), ...bootstrap });
    const events = posted.flatMap((m) => (m.type === 'event' ? [m.event] : []));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'E_ABORTED' });
    expect(events.some((e) => e.type === 'changeSet')).toBe(false);
    expect(posted.at(-1)).toEqual({ type: 'end' });
  });

  it('rejects malformed messages and a second start while running', async () => {
    const posted: WorkerOutbound[] = [];
    const host = createWorkerHost(
      (m) => posted.push(m),
      (deps) => createMockAgent(deps, { paceMs: 30 }),
    );
    await host.handle({ type: 'nope' });
    expect(posted).toEqual([{ type: 'error', message: 'Malformed worker message' }]);

    const first = host.handle({ type: 'start', request: request('A -> B'), ...bootstrap });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await host.handle({ type: 'start', request: request('C', 'run_worker_0002'), ...bootstrap });
    expect(posted.some((m) => m.type === 'error' && /already in progress/.test(m.message))).toBe(
      true,
    );
    await first;
  });

  it('produces the same event sequence as the HTTP runtime for the same request', async () => {
    const deps = { now: () => NOW, sleep: async () => {} };
    const posted: WorkerOutbound[] = [];
    const host = createWorkerHost((m) => posted.push(m), mockAgent(), { deps });
    await host.handle({ type: 'start', request: request('Login -> Verify -> Done'), ...bootstrap });
    const viaWorker = posted.flatMap((m) => (m.type === 'event' ? [m.event] : []));

    const { app } = createApp({
      agent: createMockAgent(createDefaultDeps(deps), { paceMs: 0 }),
      webOrigins: ['http://localhost:3000'],
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
      app.request(input instanceof Request ? input : String(input), init)) as typeof fetch;
    const viaHttp: RunEvent[] = [];
    try {
      const client = new HttpAgentClient('http://runtime.test');
      for await (const event of client.start(request('Login -> Verify -> Done')))
        viaHttp.push(event);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(viaHttp.length).toBeGreaterThan(5);
    expect(viaWorker).toEqual(viaHttp);
  });
});

describe('WorkerAgentClient', () => {
  /** A Worker double wired straight to a host, with the async hop a real Worker would have. */
  function fakeWorker(paceMs = 0) {
    const worker: WorkerLike & { terminated: boolean } = {
      terminated: false,
      onmessage: null,
      onerror: null,
      postMessage(message) {
        void host.handle(message);
      },
      terminate() {
        this.terminated = true;
      },
    };
    const host = createWorkerHost(
      (m) => queueMicrotask(() => worker.onmessage?.({ data: m } as MessageEvent<unknown>)),
      (deps) => createMockAgent(deps, { paceMs }),
    );
    return worker;
  }

  afterEach(() => vi.restoreAllMocks());

  it('yields the run events and terminates the worker when the stream ends', async () => {
    const worker = fakeWorker();
    const client = new WorkerAgentClient(
      () => bootstrap,
      () => worker,
    );
    const events: RunEvent[] = [];
    for await (const event of client.start(request('A -> B'))) events.push(event);
    expect(events[0]).toEqual({ type: 'status', stage: 'understanding' });
    expect(events.at(-1)).toMatchObject({ type: 'done', runId: 'run_worker_0001' });
    expect(worker.terminated).toBe(true);
  });

  it('forwards an abort as a cancel and still terminates', async () => {
    const worker = fakeWorker(20);
    const client = new WorkerAgentClient(
      () => bootstrap,
      () => worker,
    );
    const controller = new AbortController();
    const events: RunEvent[] = [];
    for await (const event of client.start(request('A -> B -> C'), { signal: controller.signal })) {
      events.push(event);
      if (event.type === 'status' && event.stage === 'building') controller.abort();
    }
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'E_ABORTED' });
    expect(worker.terminated).toBe(true);
  });

  it('surfaces worker-level failures as thrown errors', async () => {
    const worker: WorkerLike & { terminated: boolean } = {
      terminated: false,
      onmessage: null,
      onerror: null,
      postMessage() {
        queueMicrotask(() => this.onerror?.(new Error('crash')));
      },
      terminate() {
        this.terminated = true;
      },
    };
    const client = new WorkerAgentClient(
      () => bootstrap,
      () => worker,
    );
    await expect(async () => {
      for await (const _event of client.start(request('A'))) {
        // never reached
      }
    }).rejects.toThrow('Agent worker crashed');
    expect(worker.terminated).toBe(true);
  });
});
