import { type Agent, createDefaultDeps, createMockAgent } from '@nivik/agent';
import {
  type HealthResponse,
  HealthResponseSchema,
  PROTOCOL_VERSION,
  parseNdjsonStream,
  RUNTIME_ROUTES,
  type RunEvent,
  RunEventSchema,
  type RunRequestInput,
  RunRequestSchema,
  RuntimeErrorSchema,
} from '@nivik/protocol';

/** Build-time default for development; users override it in Settings → AI & Models. */
export const DEFAULT_AGENT_RUNTIME_URL =
  process.env.NEXT_PUBLIC_NIVIK_AGENT_URL ?? 'http://localhost:3400';

export interface StartRunOptions {
  signal?: AbortSignal;
}

/**
 * Spec 07 §1.1: the UI only ever sees this interface. `HttpAgentClient` talks to `apps/agent`;
 * a Worker-backed client for the local (BYOK, no server) mode arrives with task 1.5.
 */
export interface AgentClient {
  start(request: RunRequestInput, options?: StartRunOptions): AsyncGenerator<RunEvent>;
}

/** The runtime could not be reached at all (offline, wrong URL, CORS). */
export class AgentRuntimeUnavailableError extends Error {
  readonly baseUrl: string;

  constructor(baseUrl: string, options?: { cause?: unknown }) {
    super(`Agent Runtime at ${baseUrl} is unreachable`, options);
    this.name = 'AgentRuntimeUnavailableError';
    this.baseUrl = baseUrl;
  }
}

/** The runtime answered with a non-2xx JSON error (spec `RuntimeError`). */
export class AgentRuntimeError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.status = status;
    this.code = code;
  }
}

export function normalizeRuntimeUrl(raw: string): string {
  const trimmed = raw.trim();
  const base = trimmed.length > 0 ? trimmed : DEFAULT_AGENT_RUNTIME_URL;
  return base.replace(/\/+$/, '');
}

export class HttpAgentClient implements AgentClient {
  readonly baseUrl: string;

  constructor(baseUrl: string = DEFAULT_AGENT_RUNTIME_URL) {
    this.baseUrl = normalizeRuntimeUrl(baseUrl);
  }

  async health(signal?: AbortSignal): Promise<HealthResponse> {
    const response = await this.#fetch(RUNTIME_ROUTES.health, { signal });
    if (!response.ok) await throwRuntimeError(response);
    const health = HealthResponseSchema.parse(await response.json());
    if (health.protocol !== PROTOCOL_VERSION) {
      throw new AgentRuntimeError(
        200,
        'PROTOCOL_MISMATCH',
        `Runtime speaks protocol v${health.protocol}, this app expects v${PROTOCOL_VERSION}`,
      );
    }
    return health;
  }

  async *start(request: RunRequestInput, options: StartRunOptions = {}): AsyncGenerator<RunEvent> {
    const runId = request.runId ?? newRunId();
    const response = await this.#fetch(RUNTIME_ROUTES.runs, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, runId }),
      signal: options.signal,
    });
    if (!response.ok) await throwRuntimeError(response);
    if (!response.body) throw new AgentRuntimeError(response.status, 'EMPTY_BODY', 'No stream');
    // Aborting the fetch signal tears down the body stream, which the runtime treats as cancel.
    yield* parseNdjsonStream(response.body, RunEventSchema);
  }

  async cancel(runId: string): Promise<void> {
    await this.#fetch(RUNTIME_ROUTES.cancel(runId), { method: 'POST', keepalive: true });
  }

  async #fetch(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, credentials: 'omit' });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new AgentRuntimeUnavailableError(this.baseUrl, { cause: error });
    }
  }
}

/** Pacing of the in-page mock agent: fast enough to feel live, slow enough to show the stages. */
const LOCAL_PACE_MS = 80;

/**
 * Spec 07 §1.1 local mode, minimal form: the same `@nivik/agent` code the runtime runs, executed in
 * the page. The canvas falls back to it when the runtime is unreachable, and end-to-end tests run
 * on it without a server. A Worker host arrives with the provider layer (task 1.5).
 */
export class LocalAgentClient implements AgentClient {
  readonly #agent: Agent;

  constructor(agent: Agent = createMockAgent(createDefaultDeps(), { paceMs: LOCAL_PACE_MS })) {
    this.#agent = agent;
  }

  async *start(request: RunRequestInput, options: StartRunOptions = {}): AsyncGenerator<RunEvent> {
    const parsed = RunRequestSchema.parse({ ...request, runId: request.runId ?? newRunId() });
    yield* this.#agent.run(parsed, options.signal ? { signal: options.signal } : {});
  }
}

async function throwRuntimeError(response: Response): Promise<never> {
  let code = 'HTTP_ERROR';
  let message = `${response.status} ${response.statusText}`.trim();
  try {
    const parsed = RuntimeErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      code = parsed.data.error.code;
      message = parsed.data.error.message;
    }
  } catch {
    // Non-JSON error body; keep the HTTP status text.
  }
  throw new AgentRuntimeError(response.status, code, message);
}

function newRunId(): string {
  return `run_${crypto.randomUUID()}`;
}
