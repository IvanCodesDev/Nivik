import { describe, expect, it } from 'vitest';
import {
  inferProviderKind,
  PROVIDER_KINDS,
  PROVIDER_PRESETS,
  ProbeReportSchema,
  ProviderConfigSchema,
} from './providers';

describe('ProviderConfigSchema (spec 05 §9.1)', () => {
  it('fills params and transport defaults and never carries a key', () => {
    const config = ProviderConfigSchema.parse({
      id: 'p1',
      name: 'Moonshot',
      kind: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2',
    });
    expect(config.params).toEqual({
      temperature: 0.3,
      maxTokens: 8_192,
      timeoutMs: 120_000,
      retries: 1,
      thinking: false,
    });
    expect(config.transport).toBe('auto');
    expect(config.capabilities).toBeUndefined();
    expect('apiKey' in config).toBe(false);
  });

  it('rejects unknown kinds, bad urls and keys smuggled into the config', () => {
    const base = { id: 'p1', name: 'x', baseUrl: 'https://a.example', model: 'm' };
    expect(ProviderConfigSchema.safeParse({ ...base, kind: 'azure' }).success).toBe(false);
    expect(
      ProviderConfigSchema.safeParse({ ...base, kind: 'openai', baseUrl: 'nope' }).success,
    ).toBe(false);
    expect(
      ProviderConfigSchema.safeParse({ ...base, kind: 'openai', apiKey: 'sk-1' }).success,
    ).toBe(false);
  });
});

describe('PROVIDER_PRESETS / inferProviderKind', () => {
  it('has a preset entry for every kind; only openai-compatible has no fixed base url', () => {
    for (const kind of PROVIDER_KINDS)
      expect(PROVIDER_PRESETS[kind].name.length).toBeGreaterThan(0);
    expect(PROVIDER_PRESETS['openai-compatible'].baseUrl).toBeNull();
    expect(PROVIDER_PRESETS.qwen.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(PROVIDER_PRESETS.google.baseUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta',
    );
  });

  it('infers the kind from the wire format and the endpoint host', () => {
    expect(inferProviderKind('https://api.anthropic.com/v1', 'anthropic')).toBe('anthropic');
    expect(inferProviderKind('https://generativelanguage.googleapis.com/v1beta', 'gemini')).toBe(
      'google',
    );
    expect(inferProviderKind('https://api.openai.com/v1', 'openai')).toBe('openai');
    expect(inferProviderKind('https://api.deepseek.com/v1', 'openai')).toBe('deepseek');
    expect(inferProviderKind('https://openrouter.ai/api/v1', 'openai')).toBe('openrouter');
    expect(inferProviderKind('https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai')).toBe(
      'qwen',
    );
    expect(inferProviderKind('https://api.moonshot.cn/v1/', 'openai')).toBe('moonshot');
    expect(inferProviderKind('https://open.bigmodel.cn/api/paas/v4', 'openai')).toBe('glm');
    expect(inferProviderKind('https://api.minimax.chat/v1', 'openai')).toBe('minimax');
    expect(inferProviderKind('https://relay.example.com/v1', 'openai')).toBe('openai-compatible');
    expect(inferProviderKind('http://localhost:11434/v1', 'openai')).toBe('openai-compatible');
    expect(inferProviderKind('not a url', 'openai')).toBe('openai-compatible');
    // A relay speaking the Anthropic wire format is still driven by the Anthropic provider.
    expect(inferProviderKind('https://relay.example.com', 'anthropic')).toBe('anthropic');
  });
});

describe('ProbeReportSchema (spec 05 §9.3)', () => {
  it('accepts a full report and an all-failed one', () => {
    expect(
      ProbeReportSchema.parse({
        models: ['a', 'b'],
        text: true,
        json: true,
        tools: false,
        vision: null,
        latencyMs: 420,
        contextLength: { value: 128_000, estimated: true },
        errors: [{ probe: 'tools', code: 'E_INTERNAL', message: 'no tool call' }],
      }).contextLength,
    ).toEqual({ value: 128_000, estimated: true });
    expect(
      ProbeReportSchema.safeParse({
        models: null,
        text: false,
        json: false,
        tools: false,
        vision: null,
        latencyMs: null,
        contextLength: null,
        errors: [],
      }).success,
    ).toBe(true);
  });
});
