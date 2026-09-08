import { type ProviderConfig, ProviderConfigSchema } from '@nivik/protocol';
import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { createLanguageModel } from './factory';
import { fakeVendor, VENDOR_REPLIES } from './testing/fake-vendor';

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
