import type { ApiCompatibility, ProviderType } from '@/lib/stores/settings-store';

export const COMPATIBILITY_OPTIONS: readonly { value: ApiCompatibility; label: string }[] = [
  { value: 'openai', label: 'OpenAI Chat Completions' },
  { value: 'anthropic', label: 'Anthropic Messages' },
  { value: 'gemini', label: 'Google Gemini' },
];

/** Base URL / compatibility prefilled when a provider type is chosen. */
export function providerTypeDefaults(type: ProviderType): {
  url: string;
  compatibility: ApiCompatibility;
} {
  switch (type) {
    case 'OpenAI':
      return { url: 'https://api.openai.com/v1', compatibility: 'openai' };
    case 'Anthropic':
      return { url: 'https://api.anthropic.com/v1', compatibility: 'anthropic' };
    case 'Google Gemini':
      return { url: 'https://generativelanguage.googleapis.com/v1beta', compatibility: 'gemini' };
    case 'DeepSeek':
      return { url: 'https://api.deepseek.com/v1', compatibility: 'openai' };
    case 'Qwen':
      return { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', compatibility: 'openai' };
    case 'Moonshot':
      return { url: 'https://api.moonshot.cn/v1', compatibility: 'openai' };
    case 'GLM':
      return { url: 'https://open.bigmodel.cn/api/paas/v4', compatibility: 'openai' };
    case 'MiniMax':
      return { url: 'https://api.minimax.chat/v1', compatibility: 'openai' };
    case 'OpenRouter':
      return { url: 'https://openrouter.ai/api/v1', compatibility: 'openai' };
    default:
      return { url: '', compatibility: 'openai' };
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Accepts https URLs, or plain http only for loopback hosts. Rejects credentials,
 * query strings and fragments so keys can never leak through the URL.
 */
export function validateBaseUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; reason: string } {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'Base URL is required.' };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'Base URL must be a valid absolute URL.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Base URL must not contain credentials.' };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, reason: 'Base URL must not contain a query string or fragment.' };
  }
  const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    return { ok: false, reason: 'Use https, or http only for localhost.' };
  }
  return { ok: true, url: value.replace(/\/+$/, '') };
}

export interface ProbeTarget {
  url: string;
  apiKey: string;
  compatibility: ApiCompatibility;
  /** Seconds; clamped to 5–300. */
  timeout: number;
}

export interface ProbeSuccess<T> {
  ok: true;
  data: T;
  elapsedMs: number;
}

export interface ProbeFailure {
  ok: false;
  message: string;
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

function httpReason(status: number): string {
  switch (status) {
    case 400:
      return 'The provider rejected this request. Check API compatibility and model parameters.';
    case 401:
      return 'API key rejected. Replace the key and try again.';
    case 403:
      return 'Access denied. Check key permissions and model access.';
    case 404:
      return 'Endpoint or model not found. Check the Base URL, compatibility, and model name.';
    case 429:
      return 'Rate limit or quota reached. Check your provider account.';
    default:
      return 'Provider request failed. Check the service status.';
  }
}

function describeError(error: unknown, apiKey: string): string {
  let message: string;
  if (error instanceof DOMException && error.name === 'AbortError') {
    message = 'Request timed out or was canceled. Check your timeout and provider availability.';
  } else if (error instanceof TypeError) {
    message =
      'Unable to reach provider. Check the Base URL, network, and browser CORS permissions.';
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = 'Unexpected error while contacting the provider.';
  }
  if (apiKey) message = message.replaceAll(apiKey, '••••');
  return message.length > 240 ? `${message.slice(0, 237)}…` : message;
}

async function request<T>(
  target: ProbeTarget,
  path: string,
  init: RequestInit,
  validate: (data: unknown) => data is T,
): Promise<ProbeResult<T>> {
  const started = performance.now();
  const controller = new AbortController();
  const seconds = Math.min(300, Math.max(5, target.timeout || 30));
  const timer = setTimeout(() => controller.abort(), seconds * 1000);
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
    if (!response.ok) return { ok: false, message: httpReason(response.status), elapsedMs };
    const data: unknown = await response.json();
    if (!validate(data)) {
      return { ok: false, message: 'Unexpected response shape from the provider.', elapsedMs };
    }
    return { ok: true, data, elapsedMs };
  } catch (error) {
    return {
      ok: false,
      message: describeError(error, target.apiKey),
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
