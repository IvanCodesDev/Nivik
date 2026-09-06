import { createDefaultDeps, createMockAgent } from '@nivik/agent';
import { createDiagram } from '@nivik/ir';
import {
  HealthResponseSchema,
  parseNdjsonStream,
  RUN_ID_HEADER,
  type RunEvent,
  RunEventSchema,
  RunSummarySchema,
  RuntimeErrorSchema,
} from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { RunRegistry } from './runs/registry';

const ORIGIN = 'http://localhost:3000';

function build(paceMs = 0) {
  const agent = createMockAgent(createDefaultDeps(), { paceMs });
  return createApp({ agent, registry: new RunRegistry(), webOrigins: [ORIGIN], version: 't' });
}

function postRun(app: ReturnType<typeof build>['app'], body: unknown) {
  return app.request('/v1/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function readEvents(response: Response): Promise<RunEvent[]> {
  if (!response.body) throw new Error('no body');
  const events: RunEvent[] = [];
  for await (const event of parseNdjsonStream(response.body, RunEventSchema)) events.push(event);
  return events;
}

const VALID = {
  diagram: createDiagram({
    name: 'Login',
    type: 'flow',
    id: 'd_app_test01',
    now: 1_700_000_000_000,
  }),
  prompt: 'Login → Verify → Home',
  hints: { renderer: 'excalidraw' },
};

describe('GET /healthz', () => {
  it('reports service identity, protocol version and run counts', async () => {
    const { app } = build();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.runs).toEqual({ running: 0, retained: 0 });
  });
});

describe('POST /v1/runs', () => {
  it('streams NDJSON RunEvents and exposes the run id in a header', async () => {
    const { app, registry } = build();
    const res = await postRun(app, VALID);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-ndjson');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const runId = res.headers.get(RUN_ID_HEADER);
    expect(runId).toMatch(/^run_/);

    const events = await readEvents(res);
    expect(events[0]).toEqual({ type: 'status', stage: 'understanding' });
    expect(events.filter((e) => e.type === 'action')).toHaveLength(5);
    expect(events.at(-1)).toEqual({ type: 'done', runId });

    const summary = RunSummarySchema.parse(registry.get(runId ?? ''));
    expect(summary.status).toBe('done');
    expect(summary.events).toBe(events.length);
  });

  it('rejects malformed bodies with 400 and field-level issues', async () => {
    const { app } = build();
    const invalid = await postRun(app, { diagram: {}, prompt: '', hints: { renderer: 'visio' } });
    expect(invalid.status).toBe(400);
    const body = RuntimeErrorSchema.parse(await invalid.json());
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.issues?.map((i) => i.path)).toEqual(
      expect.arrayContaining(['diagram.schema', 'prompt', 'hints.renderer']),
    );

    const notJson = await postRun(app, '{nope');
    expect(notJson.status).toBe(400);
  });

  it('refuses a duplicate client-supplied run id with 409', async () => {
    const { app } = build(20);
    const first = await postRun(app, { ...VALID, runId: 'run_dup_00001' });
    expect(first.status).toBe(200);
    const second = await postRun(app, { ...VALID, runId: 'run_dup_00001' });
    expect(second.status).toBe(409);
    await readEvents(first);
  });

  it('blocks origins outside the allow list', async () => {
    const { app } = build();
    const res = await app.request('/v1/runs', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('run lifecycle', () => {
  it('cancels a running run and reports it as aborted', async () => {
    const { app, registry } = build(30);
    const res = await postRun(app, {
      ...VALID,
      runId: 'run_cancel_001',
      prompt: 'A → B → C → D → E',
    });
    expect(res.status).toBe(200);

    const events: RunEvent[] = [];
    if (!res.body) throw new Error('no body');
    for await (const event of parseNdjsonStream(res.body, RunEventSchema)) {
      events.push(event);
      if (event.type === 'status' && event.stage === 'building') {
        const cancel = await app.request('/v1/runs/run_cancel_001/cancel', { method: 'POST' });
        expect(cancel.status).toBe(202);
      }
    }
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'E_ABORTED' });
    expect(registry.get('run_cancel_001')?.status).toBe('aborted');
  });

  it('returns 404 for unknown runs', async () => {
    const { app } = build();
    expect((await app.request('/v1/runs/run_missing_01')).status).toBe(404);
    expect((await app.request('/v1/runs/run_missing_01/cancel', { method: 'POST' })).status).toBe(
      404,
    );
  });

  it('marks the run aborted when the consumer drops the stream', async () => {
    const { app, registry } = build(30);
    const res = await postRun(app, { ...VALID, runId: 'run_drop_00001', prompt: 'A → B → C → D' });
    if (!res.body) throw new Error('no body');
    const reader = res.body.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(registry.get('run_drop_00001')?.status).toBe('aborted');
  });
});
