import { describe, expect, it } from 'vitest';
import type { ProviderConfig as WebProviderConfig } from '@/lib/stores/settings-store';
import { agentBootstrap, toProviderConfig } from './providers';

const web = (over: Partial<WebProviderConfig> = {}): WebProviderConfig => ({
  id: 'p1',
  name: 'Moonshot',
  url: 'https://api.moonshot.cn/v1/',
  compatibility: 'openai',
  model: 'kimi-k2',
  tested: true,
  latency: 320,
  ...over,
});

describe('toProviderConfig', () => {
  it('infers the driver from the endpoint and normalises the url', () => {
    const config = toProviderConfig(web());
    expect(config).toMatchObject({
      id: 'p1',
      name: 'Moonshot',
      kind: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2',
      transport: 'auto',
    });
    expect(config.params.timeoutMs).toBe(120_000);
    expect('apiKey' in config).toBe(false);
  });

  it('maps the wire formats the Settings page offers', () => {
    expect(
      toProviderConfig(web({ url: 'https://api.anthropic.com/v1', compatibility: 'anthropic' }))
        .kind,
    ).toBe('anthropic');
    expect(
      toProviderConfig(
        web({ url: 'https://generativelanguage.googleapis.com/v1beta', compatibility: 'gemini' }),
      ).kind,
    ).toBe('google');
    expect(toProviderConfig(web({ url: 'https://relay.example.com/v1' })).kind).toBe(
      'openai-compatible',
    );
    expect(toProviderConfig(web({ url: 'http://localhost:11434/v1' })).kind).toBe(
      'openai-compatible',
    );
  });

  it('falls back to the url as the display name', () => {
    expect(toProviderConfig(web({ name: '' })).name).toBe('https://api.moonshot.cn/v1/');
  });
});

describe('agentBootstrap', () => {
  it('lists every provider, only the keys that exist, and validates the default', () => {
    const settings = {
      providers: [
        web(),
        web({ id: 'p2', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
      ],
      defaultModel: 'p2',
    };
    const bootstrap = agentBootstrap(settings, { p1: 'sk-1', p9: 'stale' });
    expect(bootstrap.providers.map((p) => p.kind)).toEqual(['moonshot', 'deepseek']);
    expect(bootstrap.keys).toEqual({ p1: 'sk-1' });
    expect(bootstrap.defaultProviderId).toBe('p2');
    expect(
      agentBootstrap({ ...settings, defaultModel: 'missing' }, {}).defaultProviderId,
    ).toBeNull();
    expect(agentBootstrap({ providers: [], defaultModel: '' }, {})).toEqual({
      providers: [],
      keys: {},
      defaultProviderId: null,
    });
  });
});
