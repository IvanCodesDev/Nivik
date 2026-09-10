import { type ProviderConfig, ProviderConfigSchema } from '@nivik/protocol';
import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { createModelResolver, resolveProvider } from './resolve';
import { fakeVendor, VENDOR_REPLIES } from './testing/fake-vendor';

const provider = (id: string, model = `${id}-model`): ProviderConfig =>
  ProviderConfigSchema.parse({
    id,
    name: id,
    kind: 'openai-compatible',
    baseUrl: `https://${id}.example.com/v1`,
    model,
  });

const providers = [provider('p1'), provider('p2')];

describe('resolveProvider (spec 05 §9.5, minimal)', () => {
  it('matches explicit references and lets the request override the model', () => {
    expect(resolveProvider({ providerId: 'p2', model: 'p2-model' }, providers)).toBe(providers[1]);
    expect(resolveProvider({ providerId: 'p2', model: 'other' }, providers)).toMatchObject({
      id: 'p2',
      model: 'other',
    });
  });

  it('auto picks the default provider, then the first one', () => {
    expect(resolveProvider('auto', providers, { defaultProviderId: 'p2' }).id).toBe('p2');
    expect(resolveProvider('auto', providers, { defaultProviderId: 'missing' }).id).toBe('p1');
    expect(resolveProvider('auto', providers).id).toBe('p1');
  });

  it('auto sends the plan stage to the fast provider and every other stage to the default', () => {
    const opts = { defaultProviderId: 'p1', fastProviderId: 'p2' };
    expect(resolveProvider('auto', providers, { ...opts, stage: 'plan' }).id).toBe('p2');
    expect(resolveProvider('auto', providers, { ...opts, stage: 'build' }).id).toBe('p1');
    expect(resolveProvider('auto', providers, { ...opts, stage: 'review' }).id).toBe('p1');
    expect(resolveProvider('auto', providers, opts).id).toBe('p1');
    expect(
      resolveProvider('auto', providers, { ...opts, fastProviderId: 'gone', stage: 'plan' }).id,
    ).toBe('p1');
    // An explicit reference ignores the tags.
    expect(
      resolveProvider({ providerId: 'p1', model: 'p1-model' }, providers, {
        ...opts,
        stage: 'plan',
      }).id,
    ).toBe('p1');
  });

  it('reports unknown or absent providers as auth problems the UI can route to Settings', () => {
    expect(() => resolveProvider({ providerId: 'nope', model: 'm' }, providers)).toThrow(
      expect.objectContaining({ code: 'E_PROVIDER_AUTH' }),
    );
    expect(() => resolveProvider('auto', [])).toThrow(
      expect.objectContaining({ code: 'E_PROVIDER_AUTH' }),
    );
  });
});

describe('createModelResolver', () => {
  it('builds a working model from the referenced provider and its key', async () => {
    const { fetch, seen } = fakeVendor(VENDOR_REPLIES.openai);
    const resolve = createModelResolver({
      providers,
      keys: { p2: 'sk-p2' },
      ref: { providerId: 'p2', model: 'p2-model' },
      runtimeUrl: null,
      fetch,
    });
    const model = resolve('plan');
    expect(resolve('build')).toBe(model);
    const result = await generateText({ model, prompt: 'hi', maxRetries: 0 });
    expect(result.text).toBe('OK');
    expect(seen[0]?.url).toBe('https://p2.example.com/v1/chat/completions');
    expect(seen[0]?.headers.authorization).toBe('Bearer sk-p2');
  });

  it('hands each stage the model its routing picked', async () => {
    const { fetch } = fakeVendor(VENDOR_REPLIES.openai);
    const resolve = createModelResolver({
      providers,
      keys: { p1: 'sk-p1', p2: 'sk-p2' },
      ref: 'auto',
      runtimeUrl: null,
      defaultProviderId: 'p1',
      fastProviderId: 'p2',
      fetch,
    });
    const modelId = (model: ReturnType<typeof resolve>) =>
      typeof model === 'string' ? model : model.modelId;
    expect(modelId(resolve('plan'))).toBe('p2-model');
    expect(modelId(resolve('build'))).toBe('p1-model');
    expect(resolve('build')).toBe(resolve('review'));
  });

  it('refuses to build a model without a key', () => {
    const resolve = createModelResolver({
      providers,
      keys: {},
      ref: 'auto',
      runtimeUrl: null,
      defaultProviderId: 'p1',
    });
    expect(() => resolve('plan')).toThrow(expect.objectContaining({ code: 'E_PROVIDER_AUTH' }));
  });

  it('remembers a CORS fallback for the whole run and reports which provider switched', async () => {
    const switched: string[] = [];
    let calls = 0;
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      const url = new Request(input, init).url;
      if (url.startsWith('https://p1.example.com')) throw new TypeError('Failed to fetch');
      expect(url).toBe('http://localhost:3400/v1/proxy/llm');
      return new Response(JSON.stringify(VENDOR_REPLIES.openai), {
        headers: { 'content-type': 'application/json' },
      });
    };
    const resolve = createModelResolver({
      providers,
      keys: { p1: 'sk-p1' },
      ref: 'auto',
      runtimeUrl: 'http://localhost:3400',
      fetch,
      onTransportSwitch: (id, mode) => switched.push(`${id}:${mode}`),
    });
    const model = resolve('plan');
    expect((await generateText({ model, prompt: 'a', maxRetries: 0 })).text).toBe('OK');
    expect((await generateText({ model, prompt: 'b', maxRetries: 0 })).text).toBe('OK');
    expect(switched).toEqual(['p1:proxy']);
    // direct attempt + proxy, then straight to the proxy.
    expect(calls).toBe(3);
  });
});
