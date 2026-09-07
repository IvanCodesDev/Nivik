import { createDiagram } from '@nivik/ir';
import { RunRequestSchema } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { buildRunRequest } from './run-request';
import { DEFAULT_SETTINGS, type ProviderConfig, type Settings } from './stores/settings-store';

const provider: ProviderConfig = {
  id: 'p1',
  name: 'Qwen',
  url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  compatibility: 'openai',
  model: 'qwen-plus',
  tested: false,
  latency: null,
};

const settings: Settings = { ...DEFAULT_SETTINGS, providers: [provider] };
const diagram = createDiagram({ name: 'Login flow', type: 'flow', id: 'd_test0001', now: 1 });

const build = (overrides: Partial<Parameters<typeof buildRunRequest>[0]> = {}) =>
  buildRunRequest({
    diagram,
    prompt: 'Login → Verify → Home',
    renderer: 'excalidraw',
    settings,
    ...overrides,
  });

describe('buildRunRequest', () => {
  it('sends the diagram document untouched', () => {
    expect(build().diagram).toBe(diagram);
  });

  it('hints only the renderer; the diagram type is the agent plan, never a preference', () => {
    expect(build().hints).toEqual({ renderer: 'excalidraw' });
  });

  it('routes to auto while no model is configured', () => {
    expect(build().model).toBe('auto');
  });

  it('routes to the saved default provider', () => {
    const request = build({ settings: { ...settings, defaultModel: 'p1' } });
    expect(request.model).toEqual({ providerId: 'p1', model: 'qwen-plus' });
  });

  it('lets a temporary model override the default for this run', () => {
    expect(build({ temporaryModel: 'p1' }).model).toEqual({ providerId: 'p1', model: 'qwen-plus' });
    expect(
      build({ settings: { ...settings, defaultModel: 'p1' }, temporaryModel: 'gone' }).model,
    ).toBe('auto');
  });

  it('leaves generation parameters to the runtime defaults', () => {
    expect('settings' in build()).toBe(false);
    const parsed = RunRequestSchema.parse(build());
    expect(parsed.settings).toEqual({
      temperature: 0.3,
      maxTokens: 8_192,
      timeoutMs: 120_000,
      retries: 1,
      thinking: false,
    });
  });

  it('produces a request the protocol accepts', () => {
    const parsed = RunRequestSchema.parse(build({ settings: { ...settings, defaultModel: 'p1' } }));
    expect(parsed.model).toEqual({ providerId: 'p1', model: 'qwen-plus' });
    expect(parsed.diagram.id).toBe('d_test0001');
  });
});
