import { RunError } from '@nivik/protocol';
import { APICallError, NoObjectGeneratedError } from 'ai';
import { describe, expect, it } from 'vitest';
import { toProviderError } from './errors';

const apiError = (statusCode: number, message = `HTTP ${statusCode}`) =>
  new APICallError({
    message,
    url: 'https://api.example.com/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    responseHeaders: {},
    responseBody: '',
  });

describe('toProviderError (spec 05 §10)', () => {
  it('maps HTTP statuses onto run error codes', () => {
    expect(toProviderError(apiError(401)).code).toBe('E_PROVIDER_AUTH');
    expect(toProviderError(apiError(403)).code).toBe('E_PROVIDER_AUTH');
    expect(toProviderError(apiError(429)).code).toBe('E_PROVIDER_RATE_LIMIT');
    expect(toProviderError(apiError(408)).code).toBe('E_PROVIDER_TIMEOUT');
    expect(toProviderError(apiError(504)).code).toBe('E_PROVIDER_TIMEOUT');
    expect(toProviderError(apiError(500)).code).toBe('E_INTERNAL');
    expect(toProviderError(apiError(400, 'bad request')).message).toContain('400');
  });

  it('recognises timeouts, CORS refusals and unparsable structured output', () => {
    expect(toProviderError(new DOMException('timed out', 'TimeoutError')).code).toBe(
      'E_PROVIDER_TIMEOUT',
    );
    expect(toProviderError(new TypeError('Failed to fetch')).code).toBe('E_PROVIDER_CORS');
    const noObject = new NoObjectGeneratedError({
      message: 'no object',
      text: 'x',
      response: { id: 'r', timestamp: new Date(0), modelId: 'm' },
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        inputTokenDetails: {
          noCacheTokens: 1,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: { textTokens: 1, reasoningTokens: undefined },
      },
      finishReason: 'stop',
    });
    expect(toProviderError(noObject).code).toBe('E_NO_OBJECT');
  });

  it('keeps RunErrors, maps aborts and wraps anything else as internal', () => {
    const original = new RunError('E_BUDGET_EXCEEDED', 'over');
    expect(toProviderError(original)).toBe(original);
    expect(toProviderError(new DOMException('aborted', 'AbortError')).code).toBe('E_ABORTED');
    const internal = toProviderError(new Error('weird'));
    expect(internal.code).toBe('E_INTERNAL');
    expect(internal.message).toBe('weird');
    expect(toProviderError('string failure').code).toBe('E_INTERNAL');
  });

  it('never leaks a key that a vendor echoed back in its message', () => {
    // Assembled at runtime so no key-shaped literal sits in the source tree.
    const fakeKey = ['sk', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
    const leaked = toProviderError(apiError(401, `Invalid key ${fakeKey}`));
    expect(leaked.message).not.toContain(fakeKey);
    expect(leaked.message).toContain('***');
  });
});
