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

function authHeaders(target: ProbeTarget): Record<string, string> {
  switch (target.compatibility) {
    case 'anthropic':
      return {
        'x-api-key': target.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    case 'gemini':
      return { 'x-goog-api-key': target.apiKey };
    default:
      return { Authorization: `Bearer ${target.apiKey}` };
  }
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

function describeError(error: unknown, apiKey: string): Pick<ProbeFailure, 'code' | 'detail'> {
  if (error instanceof DOMException && error.name === 'AbortError') return { code: 'timeout' };
  if (error instanceof TypeError) return { code: 'network' };
  if (!(error instanceof Error)) return { code: 'unexpected' };
  let detail = apiKey ? error.message.replaceAll(apiKey, '••••') : error.message;
  if (detail.length > 240) detail = `${detail.slice(0, 237)}…`;
  return { code: 'unexpected', detail };
}

async function request<T>(
  target: ProbeTarget,
  path: string,
  init: RequestInit,
  validate: (data: unknown) => data is T,
): Promise<ProbeResult<T>> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${target.url}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...authHeaders(target) },
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const elapsedMs = Math.round(performance.now() - started);
    if (!response.ok) return { ok: false, code: httpCode(response.status), elapsedMs };
    const data: unknown = await response.json();
    if (!validate(data)) return { ok: false, code: 'shape', elapsedMs };
    return { ok: true, data, elapsedMs };
  } catch (error) {
    return {
      ok: false,
      ...describeError(error, target.apiKey),
      elapsedMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Lists model ids exposed by the provider. */
export async function fetchModels(target: ProbeTarget): Promise<ProbeResult<string[]>> {
  const result = await request(target, '/models', { method: 'GET' }, isRecord);
  if (!result.ok) return result;
  const data = result.data;
  let ids: string[] = [];
  if (target.compatibility === 'gemini' && Array.isArray(data.models)) {
    ids = data.models
      .map((m: unknown) => (isRecord(m) && typeof m.name === 'string' ? m.name : ''))
      .map((name) => name.replace(/^models\//, ''));
  } else if (Array.isArray(data.data)) {
    ids = data.data.map((m: unknown) => (isRecord(m) && typeof m.id === 'string' ? m.id : ''));
  }
  return { ok: true, data: ids.filter(Boolean).sort(), elapsedMs: result.elapsedMs };
}

/** Sends one tiny completion request to prove the key + model pair works. */
export async function testConnection(
  target: ProbeTarget,
  model: string,
): Promise<ProbeResult<true>> {
  const encodedModel = encodeURIComponent(model);
  let result: ProbeResult<Record<string, unknown>>;
  switch (target.compatibility) {
    case 'anthropic':
      result = await request(
        target,
        '/messages',
        {
          method: 'POST',
          body: JSON.stringify({
            model,
            max_tokens: 16,
            messages: [{ role: 'user', content: 'Reply with OK.' }],
          }),
        },
        (data): data is Record<string, unknown> => isRecord(data) && Array.isArray(data.content),
      );
      break;
    case 'gemini':
      result = await request(
        target,
        `/models/${encodedModel}:generateContent`,
        {
          method: 'POST',
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Reply with OK.' }] }],
            generationConfig: { maxOutputTokens: 16 },
          }),
        },
        (data): data is Record<string, unknown> => isRecord(data) && Array.isArray(data.candidates),
      );
      break;
    default:
      result = await request(
        target,
        '/chat/completions',
        {
          method: 'POST',
          body: JSON.stringify({
            model,
            max_tokens: 16,
            messages: [{ role: 'user', content: 'Reply with OK.' }],
          }),
        },
        (data): data is Record<string, unknown> => isRecord(data) && Array.isArray(data.choices),
      );
  }
  return result.ok ? { ok: true, data: true, elapsedMs: result.elapsedMs } : result;
}
