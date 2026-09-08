import {
  inferProviderKind,
  type ProviderConfig,
  ProviderConfigSchema,
  type WireCompatibility,
} from '@nivik/protocol';
import type { Settings, ProviderConfig as WebProviderConfig } from '@/lib/stores/settings-store';

const trimSlash = (url: string) => url.trim().replace(/\/+$/, '');

/**
 * Bridges the Settings page's provider entry (url + wire format, no `kind`) to the protocol's
 * `ProviderConfig`. The saved shape stays untouched until the Settings work (task 1.10) migrates
 * it; until then the driver family is inferred from the endpoint.
 */
export function toProviderConfig(web: WebProviderConfig): ProviderConfig {
  return ProviderConfigSchema.parse({
    id: web.id,
    name: web.name || web.url,
    kind: inferProviderKind(web.url, web.compatibility as WireCompatibility),
    baseUrl: trimSlash(web.url),
    model: web.model,
    transport: 'auto',
  });
}

export interface AgentBootstrap {
  providers: ProviderConfig[];
  /** API keys by provider id — read once here, handed to the host, never persisted with the config. */
  keys: Record<string, string>;
  defaultProviderId: string | null;
}

/**
 * Everything a host (Worker, in-page) needs to resolve models for a run. Providers without a key
 * are still listed so the resolver can say which one is missing its key.
 */
export function agentBootstrap(
  settings: Pick<Settings, 'providers' | 'defaultModel'>,
  keys: Record<string, string>,
): AgentBootstrap {
  const providers = settings.providers.map(toProviderConfig);
  const picked: Record<string, string> = {};
  for (const provider of providers) {
    const key = keys[provider.id];
    if (key) picked[provider.id] = key;
  }
  const defaultProviderId = providers.some((p) => p.id === settings.defaultModel)
    ? settings.defaultModel
    : null;
  return { providers, keys: picked, defaultProviderId };
}
