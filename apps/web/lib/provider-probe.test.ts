import type { ProbeReport } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PRESET,
  capabilitiesFromReport,
  PRESETS,
  presetFor,
  probeStepsFromReport,
  suggestName,
  validateBaseUrl,
} from './provider-probe';

const report = (over: Partial<ProbeReport> = {}): ProbeReport => ({
  models: ['a', 'b'],
  text: true,
  json: true,
  tools: false,
  vision: null,
  latencyMs: 320,
  contextLength: { value: 131_072, estimated: true },
  errors: [],
  ...over,
});

describe('capabilitiesFromReport', () => {
  it('stores only what was proved and never assumes vision or thinking', () => {
    expect(capabilitiesFromReport(report())).toEqual({
      text: true,
      json: true,
      tools: false,
      vision: false,
      thinking: false,
      contextLength: 131_072,
    });
    expect(capabilitiesFromReport(report({ vision: true, contextLength: null })).vision).toBe(true);
    expect(capabilitiesFromReport(report({ contextLength: null })).contextLength).toBe(32_768);
  });
});

describe('probeStepsFromReport', () => {
  it('a working text probe means key and model are fine, whatever else failed', () => {
    const view = probeStepsFromReport(
      report({
        models: null,
        tools: false,
        errors: [{ probe: 'models', code: 'E_PROVIDER_AUTH', message: 'x' }],
      }),
    );
    expect(view).toEqual({
      steps: { url: 'ok', key: 'ok', model: 'ok' },
      failure: null,
      elapsedMs: 320,
    });
  });

  it('blames the key for auth failures and the model for everything else', () => {
    const auth = probeStepsFromReport(
      report({
        text: false,
        latencyMs: null,
        errors: [{ probe: 'text', code: 'E_PROVIDER_AUTH', message: '401' }],
      }),
    );
    expect(auth.steps).toEqual({ url: 'ok', key: 'error', model: 'idle' });
    expect(auth.failure).toEqual({ code: 'http-401' });

    const cors = probeStepsFromReport(
      report({
        text: false,
        errors: [{ probe: 'text', code: 'E_PROVIDER_CORS', message: 'blocked' }],
      }),
    );
    expect(cors.steps).toEqual({ url: 'ok', key: 'ok', model: 'error' });
    expect(cors.failure).toEqual({ code: 'network' });

    const odd = probeStepsFromReport(
      report({
        text: false,
        errors: [{ probe: 'text', code: 'E_INTERNAL', message: 'Provider responded 500' }],
      }),
    );
    expect(odd.failure).toEqual({ code: 'unexpected', detail: 'Provider responded 500' });
    expect(probeStepsFromReport(report({ text: false, errors: [] })).failure).toEqual({
      code: 'unexpected',
    });
  });
});

describe('validateBaseUrl', () => {
  it('accepts https and strips trailing slashes', () => {
    expect(validateBaseUrl('https://api.openai.com/v1/')).toEqual({
      ok: true,
      url: 'https://api.openai.com/v1',
    });
  });

  it('allows plain http only for loopback hosts', () => {
    expect(validateBaseUrl('http://localhost:11434/v1').ok).toBe(true);
    expect(validateBaseUrl('http://127.0.0.1:8080').ok).toBe(true);
    expect(validateBaseUrl('http://example.com/v1')).toEqual({ ok: false, code: 'url-scheme' });
  });

  it('rejects credentials, queries and fragments', () => {
    expect(validateBaseUrl('https://user:pw@api.example.com')).toEqual({
      ok: false,
      code: 'url-credentials',
    });
    expect(validateBaseUrl('https://api.example.com/v1?key=abc')).toEqual({
      ok: false,
      code: 'url-query',
    });
    expect(validateBaseUrl('https://api.example.com/v1#x')).toEqual({
      ok: false,
      code: 'url-query',
    });
  });

  it('rejects blanks and garbage with codes the UI can translate', () => {
    expect(validateBaseUrl('   ')).toEqual({ ok: false, code: 'url-required' });
    expect(validateBaseUrl('not a url')).toEqual({ ok: false, code: 'url-invalid' });
  });
});

describe('PRESETS', () => {
  it('lists the custom / relay preset first, with no URL and OpenAI-compatible wire format', () => {
    expect(PRESETS[0]).toBe(CUSTOM_PRESET);
    expect(CUSTOM_PRESET).toMatchObject({ id: 'custom', url: '', compatibility: 'openai' });
  });

  it('prefills first-party vendors with their public endpoints', () => {
    expect(presetFor('anthropic')).toMatchObject({
      url: 'https://api.anthropic.com/v1',
      compatibility: 'anthropic',
    });
    expect(presetFor('gemini')?.compatibility).toBe('gemini');
    expect(presetFor('deepseek')?.url).toBe('https://api.deepseek.com/v1');
    expect(presetFor('nope')).toBeUndefined();
  });

  it('has unique ids and valid https URLs', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of PRESETS) {
      if (preset.url) expect(validateBaseUrl(preset.url).ok, preset.id).toBe(true);
    }
  });
});

describe('suggestName', () => {
  it('uses the vendor name for a preset and the host for anything else', () => {
    expect(suggestName(presetFor('deepseek'), 'https://api.deepseek.com/v1')).toBe('DeepSeek');
    expect(suggestName(CUSTOM_PRESET, 'https://relay.example.com/v1')).toBe('relay.example.com');
    expect(suggestName(CUSTOM_PRESET, 'garbage')).toBe('');
  });
});
