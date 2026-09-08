import { type ProviderConfig, ProviderConfigSchema } from '@nivik/protocol';
import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { createLanguageModel } from './factory';
import type { FetchLike } from './transport';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

const headersToRecord = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
};

/** Minimal well-formed replies per wire format, keyed by a path fragment. */
export const VENDOR_REPLIES = {
  openai: {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  },
  anthropic: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'm',
    content: [{ type: 'text', text: 'OK' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 1 },
  },
  google: {
    candidates: [
      { content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP', index: 0 },
    ],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
  },
};

export function fakeVendor(reply: unknown) {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    const text = request.method === 'GET' ? '' : await request.text();
    seen.push({
      url: request.url,
      method: request.method,
      headers: headersToRecord(request.headers),
      body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    });
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, seen };
}

const config = (kind: ProviderConfig['kind'], baseUrl: string, model = 'm'): ProviderConfig =>
  ProviderConfigSchema.parse({ id: kind, name: kind, kind, baseUrl, model });

describe('createLanguageModel (spec 05 §9.2)', () => {
  it('drives OpenAI-compatible vendors through chat completions with a bearer token', async () => {
    const { fetch, seen } = fakeVendor(VENDOR_REPLIES.openai);
    const model = createLanguageModel(config('moonshot', 'https://api.moonshot.cn/v1', 'kimi'), {
      apiKey: 'sk-moon',
      fetch,
    });
    const result = await generateText({ model, prompt: 'Reply with OK', maxRetries: 0 });
    expect(result.text).toBe('OK');
    expect(result.usage.inputTokens).toBe(3);
    expect(seen[0]?.url).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(seen[0]?.headers.authorization).toBe('Bearer sk-moon');
    expect(seen[0]?.body?.model).toBe('kimi');
  });

  it('first-party OpenAI and DeepSeek use their own drivers but the same wire shape', async () => {
    for (const [kind, baseUrl] of [
      ['openai', 'https://api.openai.com/v1'],
      ['deepseek', 'https://api.deepseek.com/v1'],
      ['openrouter', 'https://openrouter.ai/api/v1'],
    ] as const) {
      const { fetch, seen } = fakeVendor(VENDOR_REPLIES.openai);
      const model = createLanguageModel(config(kind, baseUrl), { apiKey: 'sk', fetch });
      const result = await generateText({ model, prompt: 'hi', maxRetries: 0 });
      expect(result.text).toBe('OK');
      expect(seen[0]?.url).toBe(`${baseUrl}/chat/completions`);
      expect(seen[0]?.headers.authorization).toBe('Bearer sk');
    }
  });

  it('Anthropic sends x-api-key and the direct-browser header only in direct mode', async () => {
    const direct = fakeVendor(VENDOR_REPLIES.anthropic);
    const model = createLanguageModel(config('anthropic', 'https://api.anthropic.com/v1'), {
      apiKey: 'sk-ant',
      fetch: direct.fetch,
    });
    expect((await generateText({ model, prompt: 'hi', maxRetries: 0 })).text).toBe('OK');
    expect(direct.seen[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(direct.seen[0]?.headers['x-api-key']).toBe('sk-ant');
    expect(direct.seen[0]?.headers['anthropic-dangerous-direct-browser-access']).toBe('true');

    const proxied = fakeVendor(VENDOR_REPLIES.anthropic);
    const viaProxy = createLanguageModel(config('anthropic', 'https://api.anthropic.com/v1'), {
      apiKey: 'sk-ant',
      fetch: proxied.fetch,
      transport: 'proxy',
    });
    await generateText({ model: viaProxy, prompt: 'hi', maxRetries: 0 });
    expect(proxied.seen[0]?.headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
  });

  it('Google hits generateContent with x-goog-api-key', async () => {
    const { fetch, seen } = fakeVendor(VENDOR_REPLIES.google);
    const model = createLanguageModel(
      config('google', 'https://generativelanguage.googleapis.com/v1beta', 'gemini-2.0-flash'),
      { apiKey: 'g-key', fetch },
    );
    expect((await generateText({ model, prompt: 'hi', maxRetries: 0 })).text).toBe('OK');
    expect(seen[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    );
    expect(seen[0]?.headers['x-goog-api-key']).toBe('g-key');
  });

  it('strips a trailing slash from the base url', async () => {
    const { fetch, seen } = fakeVendor(VENDOR_REPLIES.openai);
    const model = createLanguageModel(
      config('openai-compatible', 'https://relay.example.com/v1/'),
      {
        apiKey: 'sk',
        fetch,
      },
    );
    await generateText({ model, prompt: 'hi', maxRetries: 0 });
    expect(seen[0]?.url).toBe('https://relay.example.com/v1/chat/completions');
  });
});
