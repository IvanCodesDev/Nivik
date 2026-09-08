import { PROXY_HEADERS, type RuntimeError } from '@nivik/protocol';
import type { Context } from 'hono';
import { checkUpstream, type UpstreamRejection } from '../ssrf';

export type ProxyFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ProxyLogEntry {
  upstreamHost: string;
  status: number;
  durationMs: number;
}

export interface ProxyOptions {
  fetch: ProxyFetch;
  allowLocalhost: boolean;
  /** The only thing the proxy records (spec 06 §6.2): never bodies, never credentials. */
  log(entry: ProxyLogEntry): void;
  now?(): number;
  /** Upper bound for the client-requested timeout. */
  maxTimeoutMs?: number;
}

export type ProxyOutcome =
  | { kind: 'response'; response: Response }
  | {
      kind: 'error';
      status: 400 | 403 | 502;
      code: RuntimeError['error']['code'];
      message: string;
    };

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TIMEOUT_MS = 300_000;
/** Spec 06 §6.2: upstream timeout = client timeout + 5s. */
const TIMEOUT_GRACE_MS = 5_000;

/** Never forwarded: hop-by-hop, browser-context, or our own envelope. */
const DROPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'origin',
  'referer',
  'cookie',
  'authorization',
  'accept-encoding',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  ...Object.values(PROXY_HEADERS),
]);

/** The only upstream response headers that reach the browser. */
const PASSED_RESPONSE_HEADERS = [
  'content-type',
  'x-request-id',
  'anthropic-ratelimit-requests-remaining',
];

const REJECTION_MESSAGE: Record<UpstreamRejection, string> = {
  invalid: 'x-nivik-upstream is not a valid URL',
  scheme: 'Upstream must use https (http is only allowed for loopback hosts)',
  userinfo: 'Upstream URL must not contain credentials',
  localhost: 'Loopback upstreams are disabled on this runtime',
  private: 'Upstream resolves to a private or link-local address',
};

function parseExtraHeaders(raw: string | undefined): Record<string, string> | null {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== 'string' || !/^[a-z0-9-]+$/i.test(name)) return null;
      out[name] = value;
    }
    return out;
  } catch {
    return null;
  }
}

function upstreamHeaders(request: Request, extra: Record<string, string>): Headers {
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (!DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  });
  const authorization = request.headers.get(PROXY_HEADERS.authorization);
  if (authorization) headers.set('authorization', authorization);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

function timeoutFor(raw: string | undefined, max: number): number {
  const requested = Number(raw);
  const base =
    Number.isFinite(requested) && requested > 0 ? Math.min(requested, max) : DEFAULT_TIMEOUT_MS;
  return base + TIMEOUT_GRACE_MS;
}

/**
 * Spec 06 §6.2: forwards one LLM request to the upstream named in `x-nivik-upstream` with the
 * credentials from `x-nivik-authorization` / `x-nivik-headers`, streams the reply back and keeps no
 * state. Pure with respect to Hono so it is testable with a plain `Request`.
 */
export async function proxyLlm(request: Request, opts: ProxyOptions): Promise<ProxyOutcome> {
  const now = opts.now ?? (() => Date.now());
  const upstreamRaw = request.headers.get(PROXY_HEADERS.upstream);
  if (!upstreamRaw) {
    return {
      kind: 'error',
      status: 400,
      code: 'BAD_REQUEST',
      message: 'x-nivik-upstream header is required',
    };
  }
  const verdict = checkUpstream(upstreamRaw, { allowLocalhost: opts.allowLocalhost });
  if (!verdict.ok) {
    const status = verdict.reason === 'invalid' ? 400 : 403;
    const code = verdict.reason === 'invalid' ? 'BAD_REQUEST' : 'FORBIDDEN';
    return { kind: 'error', status, code, message: REJECTION_MESSAGE[verdict.reason] };
  }
  const extra = parseExtraHeaders(request.headers.get(PROXY_HEADERS.headers) ?? undefined);
  if (extra === null) {
    return {
      kind: 'error',
      status: 400,
      code: 'BAD_REQUEST',
      message: 'x-nivik-headers must be a JSON object of header strings',
    };
  }

  const timeoutMs = timeoutFor(
    request.headers.get(PROXY_HEADERS.timeoutMs) ?? undefined,
    opts.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS,
  );
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  const started = now();
  let upstream: Response;
  try {
    upstream = await opts.fetch(verdict.url, {
      method: request.method,
      headers: upstreamHeaders(request, extra),
      ...(body && body.byteLength > 0 ? { body } : {}),
      signal,
      redirect: 'error',
    });
  } catch (error) {
    opts.log({ upstreamHost: verdict.url.host, status: 0, durationMs: now() - started });
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      kind: 'error',
      status: 502,
      code: 'UPSTREAM',
      message: timedOut ? 'Upstream timed out' : 'Upstream request failed',
    };
  }
  opts.log({
    upstreamHost: verdict.url.host,
    status: upstream.status,
    durationMs: now() - started,
  });

  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of PASSED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return {
    kind: 'response',
    response: new Response(upstream.body, { status: upstream.status, headers }),
  };
}

/** Adapts the pure handler to a Hono route. */
export function proxyHandler(opts: ProxyOptions) {
  return async (c: Context): Promise<Response> => {
    const outcome = await proxyLlm(c.req.raw, opts);
    if (outcome.kind === 'response') return outcome.response;
    const body: RuntimeError = { error: { code: outcome.code, message: outcome.message } };
    return c.json(body, outcome.status);
  };
}
