import type { Agent } from '@nivik/agent';
import {
  type HealthResponse,
  NDJSON_CONTENT_TYPE,
  ndjsonReadableStream,
  PROTOCOL_VERSION,
  PROXY_HEADERS,
  RUN_ID_HEADER,
  RUNTIME_ROUTES,
  type RunEvent,
  RunRequestSchema,
  type RuntimeError,
} from '@nivik/protocol';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type ProxyFetch, proxyHandler } from './routes/proxy';
import { RunCapacityError, RunConflictError, RunRegistry } from './runs/registry';

export interface AppOptions {
  agent: Agent;
  registry?: RunRegistry;
  webOrigins?: string[];
  version?: string;
  log?: (message: string, data?: Record<string, unknown>) => void;
  /** Outbound fetch for the LLM proxy; injected so tests never leave the process. */
  fetch?: ProxyFetch;
  /** Spec 06 §6.2: loopback upstreams (self-hosted models) — off in production unless enabled. */
  proxyAllowLocalhost?: boolean;
}

export interface AppContext {
  app: Hono;
  registry: RunRegistry;
}

export function createApp(options: AppOptions): AppContext {
  const registry = options.registry ?? new RunRegistry();
  const webOrigins = options.webOrigins ?? ['http://localhost:3000'];
  const log = options.log ?? (() => {});
  const app = new Hono();

  app.use(
    '/v1/*',
    cors({
      origin: webOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['content-type', 'accept', ...Object.values(PROXY_HEADERS)],
      exposeHeaders: [RUN_ID_HEADER, 'x-request-id'],
      maxAge: 600,
    }),
  );

  app.post(
    RUNTIME_ROUTES.proxy,
    proxyHandler({
      fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      allowLocalhost: options.proxyAllowLocalhost ?? false,
      log: (entry) => log('proxy', { ...entry }),
    }),
  );

  app.get('/healthz', (c) => {
    const body: HealthResponse = {
      ok: true,
      service: 'nivik-agent-runtime',
      version: options.version ?? '0.0.0',
      protocol: PROTOCOL_VERSION,
      runs: registry.counts(),
    };
    return c.json(body);
  });

  app.post('/v1/runs', async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return error(c, 400, 'BAD_REQUEST', 'Body must be JSON');
    }
    const parsed = RunRequestSchema.safeParse(json);
    if (!parsed.success) {
      return error(
        c,
        400,
        'BAD_REQUEST',
        'Invalid RunRequest',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }

    const request = parsed.data;
    const runId = request.runId ?? `run_${crypto.randomUUID()}`;
    let controller: AbortController;
    try {
      controller = registry.start(runId);
    } catch (err) {
      if (err instanceof RunConflictError) return error(c, 409, 'CONFLICT', err.message);
      if (err instanceof RunCapacityError) return error(c, 503, 'INTERNAL', err.message);
      throw err;
    }

    // A client that disconnects mid-stream cancels the run.
    c.req.raw.signal.addEventListener('abort', () => registry.abort(runId), { once: true });
    log('run started', { runId, prompt: request.prompt.length });

    const events = options.agent.run({ ...request, runId }, { signal: controller.signal });
    const tracked = trackEvents(registry, runId, events, log);

    return new Response(ndjsonReadableStream(tracked), {
      status: 200,
      headers: {
        'content-type': NDJSON_CONTENT_TYPE,
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
        [RUN_ID_HEADER]: runId,
      },
    });
  });

  app.get('/v1/runs/:id', (c) => {
    const summary = registry.get(c.req.param('id'));
    if (!summary) return error(c, 404, 'NOT_FOUND', 'Unknown run');
    return c.json(summary);
  });

  app.post('/v1/runs/:id/cancel', (c) => {
    const runId = c.req.param('id');
    const summary = registry.get(runId);
    if (!summary) return error(c, 404, 'NOT_FOUND', 'Unknown run');
    registry.abort(runId);
    return c.json({ runId, status: registry.get(runId)?.status ?? summary.status }, 202);
  });

  app.notFound((c) => error(c, 404, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`));
  app.onError((err, c) => {
    log('unhandled error', { message: err.message });
    return error(c, 500, 'INTERNAL', 'Internal error');
  });

  return { app, registry };
}

async function* trackEvents(
  registry: RunRegistry,
  runId: string,
  events: AsyncIterable<RunEvent>,
  log: NonNullable<AppOptions['log']>,
): AsyncGenerator<RunEvent> {
  try {
    for await (const event of events) {
      registry.record(runId, event);
      yield event;
    }
  } finally {
    // Reached without a terminal event only when the consumer dropped the stream.
    registry.abort(runId);
    registry.finish(runId);
    log('run finished', { runId, status: registry.get(runId)?.status });
  }
}

type ErrorCode = RuntimeError['error']['code'];

function error(
  c: Context,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
  issues?: RuntimeError['error']['issues'],
): Response {
  const body: RuntimeError = { error: { code, message, ...(issues ? { issues } : {}) } };
  return c.json(body, status);
}
