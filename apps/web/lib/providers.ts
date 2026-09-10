import { type ProviderConfig, ProviderConfigSchema } from '@nivik/protocol';
import type { Settings, ProviderConfig as WebProviderConfig } from '@/lib/stores/settings-store';

const trimSlash = (url: string) => url.trim().replace(/\/+$/, '');

/**
 * The Settings page's provider entry as the protocol's `ProviderConfig`: same fields since settings
 * v7 (kind, transport, capabilities, verified), minus the UI-only wire format and with the key
 * left out — keys travel separately (`agentBootstrap`).
 */
export function toProviderConfig(web: WebProviderConfig): ProviderConfig {
  return ProviderConfigSchema.parse({
    id: web.id,
    name: web.name || web.url,
    kind: web.kind,
    baseUrl: trimSlash(web.url),
    model: web.model,
    transport: web.transport,
    ...(web.capabilities ? { capabilities: web.capabilities } : {}),
    ...(web.verified && web.verified.at > 0 ? { verified: web.verified } : {}),
  });
}

export interface AgentBootstrap {
  providers: ProviderConfig[];
  /** API keys by provider id — read once here, handed to the host, never persisted with the config. */
  keys: Record<string, string>;
  defaultProviderId: string | null;
  /** Provider the plan stage prefers under `auto` routing (spec 05 §9.5). */
  fastProviderId: string | null;
}

/**
 * Everything a host (Worker, in-page) needs to resolve models for a run. Providers without a key
 * are still listed so the resolver can say which one is missing its key.
 */
export function agentBootstrap(
  settings: Pick<Settings, 'providers' | 'defaultModel' | 'fastModel'>,
  keys: Record<string, string>,
): AgentBootstrap {
  const providers = settings.providers.map(toProviderConfig);
  const picked: Record<string, string> = {};
  for (const provider of providers) {
    const key = keys[provider.id];
    if (key) picked[provider.id] = key;
  }
  const known = (id: string | null) => (id && providers.some((p) => p.id === id) ? id : null);
  return {
    providers,
    keys: picked,
    defaultProviderId: known(settings.defaultModel),
    fastProviderId: known(settings.fastModel),
  };
}
