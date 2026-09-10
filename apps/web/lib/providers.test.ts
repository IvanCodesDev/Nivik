import { describe, expect, it } from 'vitest';
import type { ProviderConfig as WebProviderConfig } from '@/lib/stores/settings-store';
import { agentBootstrap, toProviderConfig } from './providers';

const web = (over: Partial<WebProviderConfig> = {}): WebProviderConfig => ({
  id: 'p1',
  name: 'Moonshot',
  url: 'https://api.moonshot.cn/v1/',
  compatibility: 'openai',
  kind: 'moonshot',
  model: 'kimi-k2',
  transport: 'auto',
  capabilities: null,
  verified: { at: 1_700_000_000_000, latencyMs: 320, detected: true },
  ...over,
});

describe('toProviderConfig', () => {
  it('carries the v7 fields across and normalises the url', () => {
    const config = toProviderConfig(web());
    expect(config).toMatchObject({
      id: 'p1',
      name: 'Moonshot',
      kind: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2',
      transport: 'auto',
      verified: { at: 1_700_000_000_000, latencyMs: 320, detected: true },
    });
    expect(config.params.timeoutMs).toBe(120_000);
    expect(config.capabilities).toBeUndefined();
    expect('apiKey' in config).toBe(false);
  });

  it('keeps probed capabilities and the chosen transport', () => {
    const capabilities = {
      text: true,
      vision: false,
      tools: true,
      json: true,
      thinking: false,
      contextLength: 131_072,
    };
    const config = toProviderConfig(web({ capabilities, transport: 'proxy' }));
    expect(config.capabilities).toEqual(capabilities);
    expect(config.transport).toBe('proxy');
  });

  it('drops a pre-probing verification (at: 0) and falls back to the url as the name', () => {
    const config = toProviderConfig(
      web({ name: '', verified: { at: 0, latencyMs: 9, detected: false } }),
    );
    expect(config.name).toBe('https://api.moonshot.cn/v1/');
    expect(config.verified).toBeUndefined();
  });
});

describe('agentBootstrap', () => {
  const settings = {
    providers: [
      web(),
      web({
        id: 'p2',
        kind: 'deepseek',
        url: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      }),
    ],
    defaultModel: 'p2',
    fastModel: 'p1',
  };

  it('lists every provider, only the keys that exist, and validates default and fast', () => {
    const bootstrap = agentBootstrap(settings, { p1: 'sk-1', p9: 'stale' });
    expect(bootstrap.providers.map((p) => p.kind)).toEqual(['moonshot', 'deepseek']);
    expect(bootstrap.keys).toEqual({ p1: 'sk-1' });
    expect(bootstrap.defaultProviderId).toBe('p2');
    expect(bootstrap.fastProviderId).toBe('p1');
    expect(
      agentBootstrap({ ...settings, defaultModel: 'missing', fastModel: 'gone' }, {}),
    ).toMatchObject({
      defaultProviderId: null,
      fastProviderId: null,
    });
    expect(agentBootstrap({ providers: [], defaultModel: null, fastModel: null }, {})).toEqual({
      providers: [],
      keys: {},
      defaultProviderId: null,
      fastProviderId: null,
    });
  });
});
