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

describe('POST /v1/proxy/llm (spec 06 §6.2)', () => {
  interface Upstream {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  }

  function buildProxy(
    respond: (seen: Upstream) => Response | Error = () =>
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    proxyAllowLocalhost = false,
  ) {
    const seen: Upstream[] = [];
    const logs: Record<string, unknown>[] = [];
    const fetch = async (input: string | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const headers: Record<string, string> = {};
      request.headers.forEach((value, name) => {
        headers[name] = value;
      });
      const entry = {
        url: request.url,
        method: request.method,
        headers,
        body: await request.text(),
      };
      seen.push(entry);
      const out = respond(entry);
      if (out instanceof Error) throw out;
      return out;
    };
    const ctx = createApp({
      agent: createMockAgent(createDefaultDeps(), { paceMs: 0 }),
      registry: new RunRegistry(),
      webOrigins: [ORIGIN],
      fetch,
      proxyAllowLocalhost,
      log: (message, data) => {
        if (message === 'proxy' && data) logs.push(data);
      },
    });
    return { app: ctx.app, seen, logs };
  }

  const UPSTREAM = 'https://api.moonshot.cn/v1/chat/completions';
  const call = (
    app: ReturnType<typeof buildProxy>['app'],
    headers: Record<string, string>,
    body = '{"a":1}',
  ) =>
    app.request('/v1/proxy/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
      body,
    });

  it('forwards body and credentials to the upstream and passes the reply through', async () => {
    const { app, seen, logs } = buildProxy();
    const res = await call(app, {
      'x-nivik-upstream': UPSTREAM,
      'x-nivik-authorization': 'Bearer sk-1',
      'x-nivik-headers': JSON.stringify({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' }),
      'x-nivik-timeout-ms': '30000',
      cookie: 'session=abc',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const upstream = seen[0];
    expect(upstream?.url).toBe(UPSTREAM);
    expect(upstream?.method).toBe('POST');
    expect(upstream?.body).toBe('{"a":1}');
    expect(upstream?.headers.authorization).toBe('Bearer sk-1');
    expect(upstream?.headers['x-api-key']).toBe('k');
    expect(upstream?.headers['anthropic-version']).toBe('2023-06-01');
    expect(upstream?.headers['content-type']).toBe('application/json');
    for (const name of Object.keys(upstream?.headers ?? {})) {
      expect(name.startsWith('x-nivik-')).toBe(false);
    }
    expect(upstream?.headers.origin).toBeUndefined();
    expect(upstream?.headers.cookie).toBeUndefined();

    expect(logs).toEqual([
      { upstreamHost: 'api.moonshot.cn', status: 200, durationMs: expect.any(Number) },
    ]);
    expect(JSON.stringify(logs)).not.toContain('sk-1');
  });

  it('streams the upstream body chunk by chunk', async () => {
    const chunks = ['data: 1\n\n', 'data: 2\n\n', 'data: [DONE]\n\n'];
    const { app } = buildProxy(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const res = await call(app, {
      'x-nivik-upstream': UPSTREAM,
      'x-nivik-authorization': 'Bearer x',
    });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await res.text()).toBe(chunks.join(''));
  });

  it('rejects requests without an upstream or with a malformed header envelope', async () => {
    const { app, seen } = buildProxy();
    const missing = await call(app, {});
    expect(missing.status).toBe(400);
    expect(RuntimeErrorSchema.parse(await missing.json()).error.code).toBe('BAD_REQUEST');

    const badHeaders = await call(app, {
      'x-nivik-upstream': UPSTREAM,
      'x-nivik-headers': '[1,2]',
    });
    expect(badHeaders.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('refuses private, loopback (when disabled) and plain-http upstreams', async () => {
    const { app, seen } = buildProxy();
    for (const upstream of [
      'https://10.0.0.1/v1/chat/completions',
      'https://169.254.169.254/latest/meta-data',
      'https://[fd00::1]/v1',
      'http://localhost:11434/v1/chat/completions',
      'http://api.openai.com/v1/chat/completions',
    ]) {
      const res = await call(app, { 'x-nivik-upstream': upstream });
      expect(res.status).toBe(403);
      expect(RuntimeErrorSchema.parse(await res.json()).error.code).toBe('FORBIDDEN');
    }
    expect(seen).toHaveLength(0);
  });

  it('allows loopback upstreams when the runtime enables them', async () => {
    const { app, seen } = buildProxy(undefined, true);
    const res = await call(app, {
      'x-nivik-upstream': 'http://localhost:11434/v1/chat/completions',
    });
    expect(res.status).toBe(200);
    expect(seen[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('reports upstream failures as 502 without leaking details', async () => {
    const { app, logs } = buildProxy(() => new TypeError('connect ECONNREFUSED sk-secret'));
    const res = await call(app, {
      'x-nivik-upstream': UPSTREAM,
      'x-nivik-authorization': 'Bearer sk-secret',
    });
    expect(res.status).toBe(502);
    const body = RuntimeErrorSchema.parse(await res.json());
    expect(body.error.code).toBe('UPSTREAM');
    expect(JSON.stringify(body)).not.toContain('sk-secret');
    expect(logs[0]).toMatchObject({ upstreamHost: 'api.moonshot.cn', status: 0 });
  });

  it('is only reachable from the allowed web origin', async () => {
    const { app } = buildProxy();
    const preflight = await app.request('/v1/proxy/llm', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-nivik-upstream',
      },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();

    const allowed = await app.request('/v1/proxy/llm', {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-nivik-upstream',
      },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(allowed.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-nivik-upstream',
    );
  });
});
