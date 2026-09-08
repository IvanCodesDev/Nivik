import { z } from 'zod';
import { RunErrorCodeSchema } from './error-codes';
import { RunIdSchema } from './run-request';

/** HTTP surface of `apps/agent` (spec 07 §1.2). Paths are relative to the runtime origin. */
export const RUNTIME_ROUTES = {
  health: '/healthz',
  runs: '/v1/runs',
  run: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}`,
  cancel: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}/cancel`,
  /** Spec 06 §6.2 stateless LLM proxy; upstream and credentials travel in `PROXY_HEADERS`. */
  proxy: '/v1/proxy/llm',
} as const;

/** Request headers understood by the LLM proxy (spec 06 §6.2). */
export const PROXY_HEADERS = {
  upstream: 'x-nivik-upstream',
  authorization: 'x-nivik-authorization',
  /** JSON object of extra credential headers (`x-api-key`, `anthropic-version`, …). */
  headers: 'x-nivik-headers',
  timeoutMs: 'x-nivik-timeout-ms',
} as const;

/** Response header carrying the runId of a streaming `POST /v1/runs`. */
export const RUN_ID_HEADER = 'x-nivik-run-id';
export const NDJSON_CONTENT_TYPE = 'application/x-ndjson';

export const RUN_STATUSES = ['running', 'done', 'error', 'aborted'] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunSummarySchema = z.object({
  runId: RunIdSchema,
  status: RunStatusSchema,
  startedAt: z.number().int(),
  endedAt: z.number().int().optional(),
  events: z.number().int().min(0),
  errorCode: RunErrorCodeSchema.optional(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('nivik-agent-runtime'),
  version: z.string(),
  protocol: z.number().int(),
  runs: z.object({ running: z.number().int().min(0), retained: z.number().int().min(0) }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Body of every non-2xx JSON response from the runtime. */
export const RuntimeErrorSchema = z.object({
  error: z.object({
    code: z.enum(['BAD_REQUEST', 'NOT_FOUND', 'CONFLICT', 'FORBIDDEN', 'UPSTREAM', 'INTERNAL']),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type RuntimeError = z.infer<typeof RuntimeErrorSchema>;

/** Bumped on any incompatible change to RunRequest / RunEvent; clients refuse to talk across versions. */
export const PROTOCOL_VERSION = 1;
