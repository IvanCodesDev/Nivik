import {
  createLanguageModel,
  createTransportFetch,
  type FetchLike,
  listModels,
  probeProvider,
  toProviderError,
} from '@nivik/agent/providers';
import {
  inferProviderKind,
  type ProbeReport,
  type ProviderConfig,
  ProviderConfigSchema,
  type RunError,
} from '@nivik/protocol';
import { APICallError, generateText } from 'ai';
import type { ApiCompatibility } from '@/lib/stores/settings-store';

/**
 * Vendor presets only prefill the form (endpoint, wire format, display name); the saved
 * `ProviderConfig` never references them, so a relay and a first-party account look the same.
 */
export interface ProviderPreset {
  id: string;
  /** Vendor name — a proper noun, hence not localized. */
  name: string;
  url: string;
  compatibility: ApiCompatibility;
}

export const CUSTOM_PRESET: ProviderPreset = {
  id: 'custom',
  name: '',
  url: '',
  compatibility: 'openai',
};

export const PRESETS: readonly ProviderPreset[] = [
  CUSTOM_PRESET,
  { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1', compatibility: 'openai' },
  {
    id: 'anthropic',
    name: 'Anthropic',
    url: 'https://api.anthropic.com/v1',
    compatibility: 'anthropic',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta',
    compatibility: 'gemini',
  },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', compatibility: 'openai' },
  {
    id: 'qwen',
    name: 'Qwen',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    compatibility: 'openai',
  },
  { id: 'moonshot', name: 'Moonshot', url: 'https://api.moonshot.cn/v1', compatibility: 'openai' },
  { id: 'glm', name: 'GLM', url: 'https://open.bigmodel.cn/api/paas/v4', compatibility: 'openai' },
  { id: 'minimax', name: 'MiniMax', url: 'https://api.minimax.chat/v1', compatibility: 'openai' },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1',
    compatibility: 'openai',
  },
];

export function presetFor(id: string): ProviderPreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/** Display name proposed for a new model: the vendor for a preset, otherwise the endpoint host. */
export function suggestName(preset: ProviderPreset | undefined, url: string): string {
  if (preset?.name) return preset.name;
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return '';
  }
}

/** Why a probe failed; the UI maps each code to localized copy. */
export type ProbeErrorCode =
  | 'url-required'
  | 'url-invalid'
  | 'url-credentials'
  | 'url-query'
  | 'url-scheme'
  | 'http-400'
  | 'http-401'
  | 'http-403'
  | 'http-404'
  | 'http-429'
  | 'http-other'
  | 'timeout'
  | 'network'
  | 'shape'
  | 'unexpected';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Accepts https URLs, or plain http only for loopback hosts. Rejects credentials,
 * query strings and fragments so keys can never leak through the URL.
 */
export function validateBaseUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; code: ProbeErrorCode } {
  const value = raw.trim();
  if (!value) return { ok: false, code: 'url-required' };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, code: 'url-invalid' };
  }
  if (parsed.username || parsed.password) return { ok: false, code: 'url-credentials' };
  if (parsed.search || parsed.hash) return { ok: false, code: 'url-query' };
  const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    return { ok: false, code: 'url-scheme' };
  }
  return { ok: true, url: value.replace(/\/+$/, '') };
}

export interface ProbeTarget {
  url: string;
  apiKey: string;
  compatibility: ApiCompatibility;
}

/** Probes are tiny requests; anything slower than this is a connectivity problem worth reporting. */
const PROBE_TIMEOUT_MS = 30_000;

export interface ProbeSuccess<T> {
  ok: true;
  data: T;
  elapsedMs: number;
}

export interface ProbeFailure {
  ok: false;
  code: ProbeErrorCode;
  /** Raw error text for `unexpected` failures, with the API key redacted. */
  detail?: string;
  elapsedMs: number;
}

export type ProbeResult<T> = ProbeSuccess<T> | ProbeFailure;

export interface ProbeOptions {
  /** Agent Runtime to fall back to when the vendor refuses the browser (spec 05 §9.4 `auto`). */
  runtimeUrl?: string | null;
  fetch?: FetchLike;
  signal?: AbortSignal;
}

/** The provider-layer view of a Settings form target; the model is whatever the user typed. */
export function targetConfig(target: ProbeTarget, model: string): ProviderConfig {
  return ProviderConfigSchema.parse({
    id: 'probe',
    name: 'probe',
    kind: inferProviderKind(target.url, target.compatibility),
    baseUrl: target.url,
    model,
    transport: 'auto',
  });
}

function httpCode(status: number): ProbeErrorCode {
  switch (status) {
    case 400:
    case 401:
    case 403:
    case 404:
    case 429:
      return `http-${status}`;
    default:
      return 'http-other';
  }
}

/** Spec 05 §10 codes → the Settings page's failure vocabulary. */
export function probeFailureFor(error: unknown, elapsedMs: number): ProbeFailure {
  const runError: RunError = toProviderError(error);
  const cause = runError.cause;
  if (APICallError.isInstance(cause) && cause.statusCode) {
    return { ok: false, code: httpCode(cause.statusCode), elapsedMs };
  }
  switch (runError.code) {
    case 'E_PROVIDER_AUTH':
      return { ok: false, code: 'http-401', elapsedMs };
    case 'E_PROVIDER_RATE_LIMIT':
      return { ok: false, code: 'http-429', elapsedMs };
    case 'E_PROVIDER_TIMEOUT':
    case 'E_ABORTED':
      return { ok: false, code: 'timeout', elapsedMs };
    case 'E_PROVIDER_CORS':
      return { ok: false, code: 'network', elapsedMs };
    case 'E_NO_OBJECT':
      return { ok: false, code: 'shape', elapsedMs };
    default: {
      const detail =
        runError.message.length > 240 ? `${runError.message.slice(0, 237)}…` : runError.message;
      return { ok: false, code: 'unexpected', detail, elapsedMs };
    }
  }
}

function transportFor(target: ProbeTarget, model: string, opts: ProbeOptions) {
  const config = targetConfig(target, model);
  const transport = createTransportFetch({
    mode: 'auto',
    runtimeUrl: opts.runtimeUrl ?? null,
    timeoutMs: PROBE_TIMEOUT_MS,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  return { config, transport };
}

/** Lists model ids exposed by the provider (probe P1). */
export async function fetchModels(
  target: ProbeTarget,
  opts: ProbeOptions = {},
): Promise<ProbeResult<string[]>> {
  const started = performance.now();
  const { config, transport } = transportFor(target, 'probe', opts);
  try {
    const result = await listModels(config, target.apiKey, {
      transport,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return { ok: true, data: result.models, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    return probeFailureFor(error, Math.round(performance.now() - started));
  }
}

/** Sends one tiny completion request to prove the key + model pair works (probe P2). */
export async function testConnection(
  target: ProbeTarget,
  model: string,
  opts: ProbeOptions = {},
): Promise<ProbeResult<true>> {
  const started = performance.now();
  const { config, transport } = transportFor(target, model, opts);
  try {
    const languageModel = createLanguageModel(config, {
      apiKey: target.apiKey,
      fetch: transport.fetch,
      transport: 'direct',
    });
    await generateText({
      model: languageModel,
      prompt: 'Reply with OK',
      maxOutputTokens: 8,
      maxRetries: 0,
      timeout: PROBE_TIMEOUT_MS,
      ...(opts.signal ? { abortSignal: opts.signal } : {}),
    });
    return { ok: true, data: true, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    return probeFailureFor(error, Math.round(performance.now() - started));
  }
}

/** The full spec 05 §9.3 report (P1–P4, P5 on request) for the Settings capability panel (task 1.10). */
export function probeCapabilities(
  target: ProbeTarget,
  model: string,
  opts: ProbeOptions & { vision?: boolean } = {},
): Promise<ProbeReport> {
  const { config, transport } = transportFor(target, model, opts);
  return probeProvider(config, target.apiKey, {
    transport,
    ...(opts.vision ? { vision: true } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}
