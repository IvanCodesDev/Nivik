import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ProviderConfig } from '@nivik/protocol';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import type { FetchLike } from './transport';

export interface CreateModelOptions {
  apiKey: string;
  /** Usually a `TransportFetch['fetch']`; defaults to the global fetch. */
  fetch?: FetchLike;
  /** `direct` adds the headers vendors require for browser calls; `proxy` must not. */
  transport?: 'direct' | 'proxy';
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/**
 * Spec 05 §9.2: the only place an API key meets a vendor SDK. Returns a `LanguageModel` for the
 * configured model; every request goes through the supplied `fetch` so transport and tests can
 * intercept it.
 */
export function createLanguageModel(
  config: ProviderConfig,
  opts: CreateModelOptions,
): LanguageModel {
  const baseURL = trimSlash(config.baseUrl);
  const shared = {
    baseURL,
    apiKey: opts.apiKey,
    ...(opts.fetch ? { fetch: opts.fetch as typeof globalThis.fetch } : {}),
  };
  switch (config.kind) {
    case 'openai':
      return createOpenAI(shared).chat(config.model);
    case 'anthropic':
      return createAnthropic({
        ...shared,
        ...(opts.transport !== 'proxy'
          ? { headers: { 'anthropic-dangerous-direct-browser-access': 'true' } }
          : {}),
      })(config.model);
    case 'google':
      return createGoogle(shared)(config.model);
    case 'deepseek':
      return createDeepSeek(shared)(config.model);
    case 'openrouter':
      return createOpenRouter(shared)(config.model);
    default:
      return createOpenAICompatible({
        ...shared,
        name: config.kind,
        supportsStructuredOutputs: config.capabilities?.json ?? false,
      })(config.model);
  }
}
