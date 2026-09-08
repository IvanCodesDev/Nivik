import { z } from 'zod';

/** Spec 05 §9.1. Which AI SDK provider drives the endpoint; relays pick the family they speak. */
export const PROVIDER_KINDS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'qwen',
  'moonshot',
  'glm',
  'minimax',
  'openrouter',
  'openai-compatible',
] as const;
export const ProviderKindSchema = z.enum(PROVIDER_KINDS);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

/** Spec 05 §9.4: how LLM requests leave the browser; `auto` tries direct and falls back to the proxy. */
export const TransportSchema = z.enum(['auto', 'direct', 'proxy']);
export type Transport = z.infer<typeof TransportSchema>;

export const ProviderCapabilitiesSchema = z.object({
  text: z.boolean(),
  vision: z.boolean(),
  tools: z.boolean(),
  json: z.boolean(),
  thinking: z.boolean(),
  contextLength: z.number().int().positive(),
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const ProviderParamsSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().int().min(256).default(8_192),
  timeoutMs: z.number().int().min(5_000).default(120_000),
  retries: z.number().int().min(0).max(3).default(1),
  thinking: z.boolean().default(false),
});
export type ProviderParams = z.output<typeof ProviderParamsSchema>;

/**
 * Wire / storage form of a configured model. Deliberately key-less: the API key is looked up by
 * `id` at the single place that builds a model (spec 06 §6.1) and never travels with the config.
 */
export const ProviderConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(60),
    kind: ProviderKindSchema,
    baseUrl: z.string().url(),
    model: z.string().min(1),
    params: ProviderParamsSchema.default({
      temperature: 0.3,
      maxTokens: 8_192,
      timeoutMs: 120_000,
      retries: 1,
      thinking: false,
    }),
    capabilities: ProviderCapabilitiesSchema.optional(),
    verified: z
      .object({ at: z.number().int(), latencyMs: z.number().int(), detected: z.boolean() })
      .optional(),
    transport: TransportSchema.default('auto'),
  })
  .strict();
export type ProviderConfig = z.output<typeof ProviderConfigSchema>;
export type ProviderConfigInput = z.input<typeof ProviderConfigSchema>;

export interface ProviderPreset {
  name: string;
  /** `null` for the generic OpenAI-compatible kind: the user supplies the endpoint. */
  baseUrl: string | null;
}

/** Spec 05 §9.2 preset endpoints. */
export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  google: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  qwen: { name: 'Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  moonshot: { name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
  glm: { name: 'GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  minimax: { name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1' },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  'openai-compatible': { name: 'OpenAI-compatible', baseUrl: null },
};

/** Wire formats the Settings UI lets the user pick; the finer `kind` is derived from the host. */
export type WireCompatibility = 'openai' | 'anthropic' | 'gemini';

const hostToKind = new Map<string, ProviderKind>(
  PROVIDER_KINDS.flatMap((kind) => {
    const preset = PROVIDER_PRESETS[kind].baseUrl;
    return preset ? [[new URL(preset).hostname, kind] as const] : [];
  }),
);

/**
 * Picks the provider family for an endpoint: the wire format decides between the three
 * protocol families, the host refines OpenAI-style endpoints to their first-party provider so
 * vendor-specific defaults apply; anything unknown is the generic OpenAI-compatible driver.
 */
export function inferProviderKind(baseUrl: string, compatibility: WireCompatibility): ProviderKind {
  if (compatibility === 'anthropic') return 'anthropic';
  if (compatibility === 'gemini') return 'google';
  try {
    const hostname = new URL(baseUrl.trim()).hostname;
    return hostToKind.get(hostname) ?? 'openai-compatible';
  } catch {
    return 'openai-compatible';
  }
}

export const PROBE_NAMES = ['models', 'text', 'json', 'tools', 'vision'] as const;
export const ProbeNameSchema = z.enum(PROBE_NAMES);
export type ProbeName = z.infer<typeof ProbeNameSchema>;

/** Spec 05 §9.3: what "Test Connection" actually establishes. `null` = probe not run / not conclusive. */
export const ProbeReportSchema = z.object({
  models: z.array(z.string()).nullable(),
  text: z.boolean(),
  json: z.boolean(),
  tools: z.boolean(),
  vision: z.boolean().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  contextLength: z
    .object({ value: z.number().int().positive(), estimated: z.boolean() })
    .nullable(),
  errors: z.array(
    z.object({ probe: ProbeNameSchema, code: z.string().min(1), message: z.string() }),
  ),
});
export type ProbeReport = z.infer<typeof ProbeReportSchema>;
