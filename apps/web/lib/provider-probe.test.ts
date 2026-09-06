import { describe, expect, it } from 'vitest';
import { providerTypeDefaults, validateBaseUrl } from './provider-probe';

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
    expect(validateBaseUrl('http://example.com/v1').ok).toBe(false);
  });

  it('rejects credentials, queries and fragments', () => {
    expect(validateBaseUrl('https://user:pw@api.example.com').ok).toBe(false);
    expect(validateBaseUrl('https://api.example.com/v1?key=abc').ok).toBe(false);
    expect(validateBaseUrl('https://api.example.com/v1#x').ok).toBe(false);
  });

  it('rejects blanks and garbage', () => {
    expect(validateBaseUrl('   ').ok).toBe(false);
    expect(validateBaseUrl('not a url').ok).toBe(false);
  });
});

describe('providerTypeDefaults', () => {
  it('maps first-party providers to their public endpoints', () => {
    expect(providerTypeDefaults('Anthropic')).toEqual({
      url: 'https://api.anthropic.com/v1',
      compatibility: 'anthropic',
    });
    expect(providerTypeDefaults('Google Gemini').compatibility).toBe('gemini');
  });

  it('leaves custom providers empty but OpenAI-compatible', () => {
    expect(providerTypeDefaults('OpenAI-compatible Custom Provider')).toEqual({
      url: '',
      compatibility: 'openai',
    });
  });
});
