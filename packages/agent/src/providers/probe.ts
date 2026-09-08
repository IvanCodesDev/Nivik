import type { ProbeName, ProbeReport, ProviderConfig } from '@nivik/protocol';
import { APICallError, generateText, Output, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { redact } from '../harness/redact';
import { toProviderError } from './errors';
import { createLanguageModel } from './factory';
import { createTransportFetch, type FetchLike, type TransportFetch } from './transport';

export interface ProbeOptions {
  fetch?: FetchLike;
  /** Reuse a transport (and its direct → proxy memory); built from the config otherwise. */
  transport?: TransportFetch;
  runtimeUrl?: string | null;
  /** Run the vision probe (spec 05 §9.3 P5); off by default because it costs a real call. */
  vision?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  now?(): number;
}

export interface ListModelsResult {
  models: string[];
  /** Per-model context window where the vendor publishes it. */
  contextLength: Map<string, number>;
}

/** Approximate context windows by model-id prefix, used when the vendor list says nothing. */
export const KNOWN_CONTEXT_LENGTHS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4.1': 1_047_576,
  'gpt-5': 400_000,
  o1: 200_000,
  o3: 200_000,
  o4: 200_000,
  'claude-3': 200_000,
  'claude-4': 200_000,
  'claude-sonnet': 200_000,
  'claude-opus': 200_000,
  'claude-haiku': 200_000,
  'gemini-1.5': 1_000_000,
  'gemini-2': 1_048_576,
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
  'kimi-k2': 131_072,
  'moonshot-v1-128k': 131_072,
  'qwen-max': 32_768,
  'qwen-plus': 131_072,
  'qwen-turbo': 1_000_000,
  'glm-4': 128_000,
};

export const DEFAULT_CONTEXT_LENGTH = 32_768;
const PROBE_TIMEOUT_MS = 30_000;
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const trimSlash = (url: string) => url.replace(/\/+$/, '');

function authHeaders(config: ProviderConfig, apiKey: string): Record<string, string> {
  switch (config.kind) {
    case 'anthropic':
      return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    case 'google':
      return { 'x-goog-api-key': apiKey };
    default:
      return { authorization: `Bearer ${apiKey}` };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function parseModelList(config: ProviderConfig, data: unknown): ListModelsResult {
  const models: string[] = [];
  const contextLength = new Map<string, number>();
  if (!isRecord(data)) return { models, contextLength };
  const rows = config.kind === 'google' ? data.models : data.data;
  if (!Array.isArray(rows)) return { models, contextLength };
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const rawId = config.kind === 'google' ? row.name : row.id;
    if (typeof rawId !== 'string' || rawId.length === 0) continue;
    const id = rawId.replace(/^models\//, '');
    models.push(id);
    const limit =
      row.inputTokenLimit ?? row.context_length ?? row.context_window ?? row.max_context_length;
    if (typeof limit === 'number' && limit > 0) contextLength.set(id, limit);
  }
  return { models: [...new Set(models)].sort(), contextLength };
}

/** Spec 05 §9.3 P1: `GET {baseUrl}/models` in the vendor's own auth dialect. */
export async function listModels(
  config: ProviderConfig,
  apiKey: string,
  opts: ProbeOptions = {},
): Promise<ListModelsResult> {
  const fetch =
    opts.transport?.fetch ?? opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const url = `${trimSlash(config.baseUrl)}/models`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...authHeaders(config, apiKey) },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (error) {
    throw toProviderError(error);
  }
  if (!response.ok) {
    throw toProviderError(
      new APICallError({
        message: `GET /models failed with ${response.status}`,
        url,
        requestBodyValues: {},
        statusCode: response.status,
        responseHeaders: {},
        responseBody: await response.text().catch(() => ''),
      }),
    );
  }
  return parseModelList(config, await response.json());
}

/** Vendor figure first, then the known-model table by prefix, then the documented default. */
export function contextLengthFor(
  model: string,
  fromVendor: Map<string, number>,
): NonNullable<ProbeReport['contextLength']> {
  const exact = fromVendor.get(model);
  if (exact) return { value: exact, estimated: false };
  const known = Object.keys(KNOWN_CONTEXT_LENGTHS)
    .filter((prefix) => model.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];
  if (known) return { value: KNOWN_CONTEXT_LENGTHS[known] as number, estimated: true };
  return { value: DEFAULT_CONTEXT_LENGTH, estimated: true };
}

/**
 * Spec 05 §9.3: what "Test Connection" establishes. Every probe is independent — a failure is
 * recorded against its name and the next one still runs — and nothing in the report can carry
 * the key (messages are redacted).
 */
export async function probeProvider(
  config: ProviderConfig,
  apiKey: string,
  opts: ProbeOptions = {},
): Promise<ProbeReport> {
  const now = opts.now ?? (() => Date.now());
  const transport =
    opts.transport ??
    createTransportFetch({
      mode: config.transport,
      runtimeUrl: opts.runtimeUrl ?? null,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  const model = createLanguageModel(config, {
    apiKey,
    fetch: transport.fetch,
    transport: config.transport === 'proxy' ? 'proxy' : 'direct',
  });
  const timeout = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const call = { maxRetries: 0, timeout, ...(opts.signal ? { abortSignal: opts.signal } : {}) };
  const report: ProbeReport = {
    models: null,
    text: false,
    json: false,
    tools: false,
    vision: null,
    latencyMs: null,
    contextLength: null,
    errors: [],
  };
  const fail = (probe: ProbeName, error: unknown) => {
    const runError = toProviderError(error);
    report.errors.push({ probe, code: runError.code, message: redact(runError.message) });
  };

  let vendorLimits = new Map<string, number>();
  try {
    const listed = await listModels(config, apiKey, { ...opts, transport });
    report.models = listed.models;
    vendorLimits = listed.contextLength;
  } catch (error) {
    fail('models', error);
  }

  try {
    const started = now();
    await generateText({ model, prompt: 'Reply with OK', maxOutputTokens: 8, ...call });
    report.latencyMs = Math.max(0, Math.round(now() - started));
    report.text = true;
  } catch (error) {
    fail('text', error);
  }

  try {
    const result = await generateText({
      model,
      prompt: 'Return exactly this JSON object and nothing else: {"ok": true}',
      output: Output.object({ schema: z.object({ ok: z.literal(true) }) }),
      ...call,
    });
    report.json = result.output.ok === true;
  } catch (error) {
    fail('json', error);
  }

  try {
    const result = await generateText({
      model,
      prompt: 'Call the ping tool once, then say done.',
      tools: {
        ping: tool({
          description: 'A no-op tool used to check tool calling.',
          inputSchema: z.object({}),
          execute: async () => 'pong',
        }),
      },
      stopWhen: stepCountIs(2),
      ...call,
    });
    report.tools = result.steps.some((step) => step.toolCalls.length > 0);
  } catch (error) {
    fail('tools', error);
  }

  if (opts.vision) {
    try {
      await generateText({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What color is this image? Answer with one word.' },
              { type: 'image', image: TINY_PNG, mediaType: 'image/png' },
            ],
          },
        ],
        maxOutputTokens: 8,
        ...call,
      });
      report.vision = true;
    } catch (error) {
      report.vision = false;
      fail('vision', error);
    }
  }

  report.contextLength = contextLengthFor(config.model, vendorLimits);
  return report;
}
