import { type ModelRef, type ProviderConfig, RunError } from '@nivik/protocol';
import type { LanguageModel } from 'ai';
import type { ModelResolver, ModelRole } from '../deps';
import { createLanguageModel } from './factory';
import { createTransportFetch, type FetchLike, type TransportFetch } from './transport';

export interface ResolveModelOptions {
  /** The provider marked as default in Settings; `'auto'` falls back to it, then to the first one. */
  defaultProviderId?: string | null;
  /** The provider tagged `fast` in Settings: `'auto'` sends planning and review roles there (spec 05 §9.5). */
  fastProviderId?: string | null;
  stage?: ModelRole;
}

/** Roles that trade a little quality for latency under `nivik-auto` (spec 05 §9.5; D14′ sub-agents included). */
const FAST_STAGES: ReadonlySet<ModelRole> = new Set(['plan', 'review', 'critiquePlan']);

/**
 * Spec 05 §9.5: an explicit reference must match a configured provider (the request may override
 * its model); `'auto'` routes the plan stage to the `fast` provider when one is tagged and every
 * other stage to the default provider, then to the first one configured.
 */
export function resolveProvider(
  ref: ModelRef,
  providers: readonly ProviderConfig[],
  opts: ResolveModelOptions = {},
): ProviderConfig {
  if (ref !== 'auto') {
    const match = providers.find((p) => p.id === ref.providerId);
    if (!match) {
      throw new RunError('E_PROVIDER_AUTH', `Provider "${ref.providerId}" is not configured`);
    }
    return match.model === ref.model ? match : { ...match, model: ref.model };
  }
  const byId = (id: string | null | undefined) =>
    id ? providers.find((p) => p.id === id) : undefined;
  const fast = opts.stage && FAST_STAGES.has(opts.stage) ? byId(opts.fastProviderId) : undefined;
  const chosen = fast ?? byId(opts.defaultProviderId) ?? providers[0];
  if (!chosen) throw new RunError('E_PROVIDER_AUTH', 'No model provider is configured');
  return chosen;
}

export interface ModelResolverOptions extends ResolveModelOptions {
  providers: readonly ProviderConfig[];
  /** API keys by provider id; the only place they are read. */
  keys: Record<string, string>;
  ref: ModelRef;
  runtimeUrl: string | null;
  fetch?: FetchLike;
  onTransportSwitch?(providerId: string, mode: 'proxy'): void;
}

/**
 * Builds the `AgentDeps.model` resolver for one run: the referenced provider becomes a
 * `LanguageModel` whose requests go through a transport that remembers a CORS fallback for the
 * rest of the run. Models are cached per provider so every stage shares the same transport state.
 */
export function createModelResolver(opts: ModelResolverOptions): ModelResolver {
  const transports = new Map<string, TransportFetch>();
  const models = new Map<string, LanguageModel>();

  const transportFor = (config: ProviderConfig): TransportFetch => {
    let transport = transports.get(config.id);
    if (!transport) {
      transport = createTransportFetch({
        mode: config.transport,
        runtimeUrl: opts.runtimeUrl,
        timeoutMs: config.params.timeoutMs,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        onSwitch: (mode) => opts.onTransportSwitch?.(config.id, mode),
      });
      transports.set(config.id, transport);
    }
    return transport;
  };

  return (stage) => {
    const config = resolveProvider(opts.ref, opts.providers, { ...opts, stage });
    const cacheKey = `${config.id}:${config.model}`;
    const cached = models.get(cacheKey);
    if (cached) return cached;
    const apiKey = opts.keys[config.id];
    if (!apiKey) {
      throw new RunError('E_PROVIDER_AUTH', `API key missing for provider "${config.name}"`);
    }
    const transport = transportFor(config);
    const model = createLanguageModel(config, {
      apiKey,
      fetch: transport.fetch,
      transport: config.transport === 'proxy' ? 'proxy' : 'direct',
    });
    models.set(cacheKey, model);
    return model;
  };
}
