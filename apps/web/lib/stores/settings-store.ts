import {
  inferProviderKind,
  type ModelRef,
  PROVIDER_KINDS,
  type ProviderCapabilities,
  ProviderCapabilitiesSchema,
  type ProviderKind,
  type Transport,
  TransportSchema,
} from '@nivik/protocol';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { LANGUAGE_SETTINGS } from '@/lib/i18n/locales';
import { THEMES } from '@/lib/theme/themes';

export { THEMES };

/** Wire format spoken at the Base URL; relays and first-party vendors are configured the same way. */
export const API_COMPATIBILITIES = ['openai', 'anthropic', 'gemini'] as const;
export type ApiCompatibility = (typeof API_COMPATIBILITIES)[number];

/** What Test Connection established, and when (spec 05 §9.3). `at: 0` marks a result from before probing existed. */
export interface ProviderVerification {
  at: number;
  latencyMs: number;
  /** True when the capabilities were probed rather than assumed. */
  detected: boolean;
}

/**
 * One configured model: an endpoint, the format it speaks, the driver family (`kind`, derived from
 * the endpoint unless the user overrides it) and what probing found out about it. The API key is
 * not part of this record (see `useProviderKeys`).
 */
export interface ProviderConfig {
  id: string;
  name: string;
  url: string;
  compatibility: ApiCompatibility;
  kind: ProviderKind;
  model: string;
  transport: Transport;
  capabilities: ProviderCapabilities | null;
  verified: ProviderVerification | null;
}

/** Spec 06 §6.1: where API keys live between page loads. */
export const KEY_STORAGES = ['session', 'device'] as const;
export type KeyStorage = (typeof KEY_STORAGES)[number];

export const AVATAR_COLORS = ['violet', 'sage', 'sky', 'peach', 'slate'] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export const AVATAR_TONES: Record<AvatarColor, [string, string]> = {
  violet: ['#cab2fc', '#a485e4'],
  sage: ['#b6d5c8', '#88b29e'],
  sky: ['#bed4ec', '#8daecc'],
  peach: ['#f0d2c1', '#d3a493'],
  slate: ['#b6bdcb', '#8995ab'],
};

/** Renderers a new diagram can default to; ids match `@nivik/protocol` `RendererId`. */
export const RENDERER_OPTIONS = [
  { value: 'excalidraw', label: 'Excalidraw' },
  { value: 'drawio', label: 'draw.io' },
] as const;
export type SettingsRenderer = (typeof RENDERER_OPTIONS)[number]['value'];

/** `auto` follows the browser; see `lib/i18n/locales.ts` for how it is resolved. */
export const LANGUAGES = LANGUAGE_SETTINGS;
export const GRID_SIZES = ['12', '18', '20', '24', '32'] as const;
export const SELECTION_STYLES = ['outline', 'fill'] as const;
export const NODE_STYLES = ['rounded', 'square', 'pill'] as const;
export const EDGE_STYLES = ['solid', 'dashed'] as const;

/**
 * The canvas background is a pattern on a paper colour. `dots` is the grid (spaced by `gridSize`),
 * `plain` is a bare sheet; the paper colour resolves through `--nv-canvas-<tint>` in tokens.css
 * and stays light in every theme.
 */
export const CANVAS_PATTERNS = ['dots', 'plain'] as const;
export type CanvasPattern = (typeof CANVAS_PATTERNS)[number];

export const CANVAS_BACKGROUNDS = ['white', 'soft', 'lavender', 'mint', 'paper'] as const;
export type CanvasBackground = (typeof CANVAS_BACKGROUNDS)[number];

export function canvasBackgroundVar(tint: CanvasBackground): string {
  return `var(--nv-canvas-${tint})`;
}

/**
 * There is intentionally no default diagram type: classifying a diagram is the agent's plan-stage
 * decision for every run (spec 05 §3), not a preference fixed before the prompt is read.
 */
export interface Settings {
  // General
  renderer: SettingsRenderer;
  autoLayout: boolean;
  autoSave: boolean;
  language: (typeof LANGUAGES)[number];
  // AI & Models
  /**
   * `ProviderConfig.id` used for every generation, or null while no model is configured (the
   * request then carries `model: 'auto'`). Generation parameters are the runtime's defaults.
   */
  defaultModel: string | null;
  /** `ProviderConfig.id` the plan stage prefers (spec 05 §9.5 `fast`), or null to use the default. */
  fastModel: string | null;
  /** Base URL of the Agent Runtime (`apps/agent`); empty = local mode (the agent runs in a Worker). */
  agentRuntimeUrl: string;
  keyStorage: KeyStorage;
  // Canvas & Appearance
  canvasPattern: CanvasPattern;
  gridSize: (typeof GRID_SIZES)[number];
  canvasBackground: CanvasBackground;
  snap: boolean;
  selection: (typeof SELECTION_STYLES)[number];
  theme: (typeof THEMES)[number];
  nodeStyle: (typeof NODE_STYLES)[number];
  edgeStyle: (typeof EDGE_STYLES)[number];
  // Account
  userName: string;
  email: string;
  avatar: string;
  avatarColor: AvatarColor;
  providers: ProviderConfig[];
}

export const DEFAULT_SETTINGS: Settings = {
  renderer: 'excalidraw',
  autoLayout: true,
  autoSave: true,
  language: 'auto',
  defaultModel: null,
  fastModel: null,
  agentRuntimeUrl: '',
  keyStorage: 'session',
  canvasPattern: 'dots',
  gridSize: '24',
  canvasBackground: 'soft',
  snap: true,
  selection: 'outline',
  theme: 'light',
  nodeStyle: 'rounded',
  edgeStyle: 'solid',
  userName: '',
  email: '',
  avatar: '',
  avatarColor: 'violet',
  providers: [],
};

/** Initial shown wherever a user has not set a name yet. */
export const FALLBACK_INITIAL = 'N';

/** Corner radius (px) applied to sketch nodes and the settings preview for each node style. */
export const NODE_RADIUS: Record<Settings['nodeStyle'], number> = {
  rounded: 9,
  square: 2,
  pill: 30,
};

/** Resolves the picker value (default or temporary model) to the wire `ModelRef`. */
export function resolveModelRef(
  settings: Pick<Settings, 'defaultModel' | 'providers'>,
  modelId: string | null = settings.defaultModel,
): ModelRef {
  const provider = settings.providers.find((p) => p.id === modelId);
  return provider ? { providerId: provider.id, model: provider.model } : 'auto';
}

interface SettingsState {
  /** Last persisted preferences. */
  saved: Settings;
  /** Working copy edited by the Settings page. */
  draft: Settings;
  hydrated: boolean;
  update: (patch: Partial<Settings>) => void;
  upsertProvider: (provider: ProviderConfig) => void;
  removeProvider: (id: string) => void;
  save: () => void;
  discard: () => void;
}

const clone = <T>(value: T): T => structuredClone(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function normalizeVerification(input: unknown): ProviderVerification | null {
  if (!isRecord(input) || !finiteNumber(input.latencyMs)) return null;
  return {
    at: finiteNumber(input.at) ? input.at : 0,
    latencyMs: input.latencyMs,
    detected: input.detected === true,
  };
}

/**
 * Keeps only what a configured model needs; returns null for entries that cannot be used (stale
 * storage, hand-edited exports). Retired fields such as `type` and `context` fall away here; the
 * pre-v7 `tested` / `latency` pair becomes a `verified` entry stamped `at: 0`, and a missing or
 * unknown `kind` is derived from the endpoint.
 */
export function normalizeProvider(input: unknown): ProviderConfig | null {
  if (!isRecord(input)) return null;
  const { id, name, url, model, compatibility, kind, transport, capabilities, verified } = input;
  if (!nonEmptyString(id) || !nonEmptyString(url) || !nonEmptyString(model)) return null;
  const wire = oneOf(API_COMPATIBILITIES, compatibility, 'openai');
  const parsedCapabilities = ProviderCapabilitiesSchema.safeParse(capabilities);
  const legacy =
    input.tested === true && finiteNumber(input.latency)
      ? { at: 0, latencyMs: input.latency, detected: false }
      : null;
  return {
    id,
    name: typeof name === 'string' ? name : '',
    url,
    compatibility: wire,
    kind: oneOf(PROVIDER_KINDS, kind, inferProviderKind(url, wire)),
    model,
    transport: oneOf(TransportSchema.options, transport, 'auto'),
    capabilities: parsedCapabilities.success ? parsedCapabilities.data : null,
    verified: normalizeVerification(verified) ?? legacy,
  };
}

/**
 * Fills gaps from defaults, drops keys that are no longer settings (removed preferences linger in
 * storage otherwise) and enum values the UI cannot render (corrupt or stale storage).
 */
export function normalizeSettings(input: Partial<Settings> | undefined): Settings {
  const known = Object.fromEntries(
    Object.entries(input ?? {}).filter(([key]) => key in DEFAULT_SETTINGS),
  ) as Partial<Settings>;
  const merged: Settings = { ...DEFAULT_SETTINGS, ...known };
  const rendererIds = RENDERER_OPTIONS.map((o) => o.value);
  const providers = Array.isArray(merged.providers)
    ? merged.providers.map(normalizeProvider).filter((p): p is ProviderConfig => p !== null)
    : [];
  return {
    ...merged,
    renderer: oneOf(rendererIds, merged.renderer, DEFAULT_SETTINGS.renderer),
    language: oneOf(LANGUAGES, merged.language, DEFAULT_SETTINGS.language),
    canvasPattern: oneOf(CANVAS_PATTERNS, merged.canvasPattern, DEFAULT_SETTINGS.canvasPattern),
    gridSize: oneOf(GRID_SIZES, merged.gridSize, DEFAULT_SETTINGS.gridSize),
    canvasBackground: oneOf(
      CANVAS_BACKGROUNDS,
      merged.canvasBackground,
      DEFAULT_SETTINGS.canvasBackground,
    ),
    selection: oneOf(SELECTION_STYLES, merged.selection, DEFAULT_SETTINGS.selection),
    theme: oneOf(THEMES, merged.theme, DEFAULT_SETTINGS.theme),
    nodeStyle: oneOf(NODE_STYLES, merged.nodeStyle, DEFAULT_SETTINGS.nodeStyle),
    edgeStyle: oneOf(EDGE_STYLES, merged.edgeStyle, DEFAULT_SETTINGS.edgeStyle),
    avatarColor: oneOf(AVATAR_COLORS, merged.avatarColor, DEFAULT_SETTINGS.avatarColor),
    keyStorage: oneOf(KEY_STORAGES, merged.keyStorage, DEFAULT_SETTINGS.keyStorage),
    providers,
    defaultModel: providers.some((p) => p.id === merged.defaultModel) ? merged.defaultModel : null,
    fastModel: providers.some((p) => p.id === merged.fastModel) ? merged.fastModel : null,
  };
}

const SETTINGS_VERSION = 7;

/**
 * v1 stored the option labels shown in the UI; v2 stores protocol / IR ids. v1 also had a
 * `diagramType` preference, which `normalizeSettings` drops as an unknown key. v3 made the
 * language setting effective; earlier stored values were an inert default, not a choice. v4
 * removed the hosted `nivik-auto` model, generation parameters and provider capability
 * declarations; `normalizeSettings` / `normalizeProvider` strip them, so no explicit step is needed.
 * v5 stores the canvas background as a tint instead of a light-theme hex colour. v6 replaced the
 * `showGrid` switch with the `canvasPattern` choice. v7 gives providers `kind` / `transport` /
 * `capabilities` / `verified` (the old `tested` + `latency` pair folds into `verified`) and adds
 * `keyStorage` and `fastModel`; `normalizeProvider` / `normalizeSettings` perform that upgrade.
 */
const V1_RENDERERS: Record<string, SettingsRenderer> = {
  Excalidraw: 'excalidraw',
  'draw.io': 'drawio',
};

const V4_BACKGROUNDS: Record<string, CanvasBackground> = {
  '#ffffff': 'white',
  '#faf9fb': 'soft',
  '#f5f1ff': 'lavender',
  '#eff9f5': 'mint',
  '#fff9ed': 'paper',
};

type PersistedSettings = { saved: Settings };

/** zustand `migrate` hook: receives the partialized state and its stored version. */
export function migrateSettings(persisted: unknown, version: number): PersistedSettings {
  const saved: Record<string, unknown> =
    isRecord(persisted) && isRecord(persisted.saved) ? { ...persisted.saved } : {};
  if (version < 2 && typeof saved.renderer === 'string' && saved.renderer in V1_RENDERERS) {
    saved.renderer = V1_RENDERERS[saved.renderer];
  }
  if (version < 3) saved.language = 'auto';
  if (version < 5 && typeof saved.canvasBackground === 'string') {
    saved.canvasBackground = V4_BACKGROUNDS[saved.canvasBackground.toLowerCase()];
  }
  if (version < 6 && typeof saved.showGrid === 'boolean') {
    saved.canvasPattern = saved.showGrid ? 'dots' : 'plain';
  }
  return { saved: normalizeSettings(saved as Partial<Settings>) };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      saved: clone(DEFAULT_SETTINGS),
      draft: clone(DEFAULT_SETTINGS),
      hydrated: false,
      update: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
      upsertProvider: (provider) =>
        set((state) => {
          const providers = state.draft.providers.some((p) => p.id === provider.id)
            ? state.draft.providers.map((p) => (p.id === provider.id ? provider : p))
            : [...state.draft.providers, provider];
          // The first configured model is the obvious default; later ones are opt-in.
          const defaultModel = state.draft.defaultModel ?? provider.id;
          return { draft: { ...state.draft, providers, defaultModel } };
        }),
      removeProvider: (id) =>
        set((state) => {
          const providers = state.draft.providers.filter((p) => p.id !== id);
          const defaultModel =
            state.draft.defaultModel === id ? (providers[0]?.id ?? null) : state.draft.defaultModel;
          const fastModel = state.draft.fastModel === id ? null : state.draft.fastModel;
          return { draft: { ...state.draft, providers, defaultModel, fastModel } };
        }),
      save: () => set({ saved: clone(get().draft) }),
      discard: () => set({ draft: clone(get().saved) }),
    }),
    {
      name: 'nivik.settings.v2',
      version: SETTINGS_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Hydrate explicitly from <StoreHydrator/> so server and first client render agree.
      skipHydration: true,
      partialize: (state) => ({ saved: state.saved }),
      migrate: migrateSettings,
      merge: (persisted, current) => {
        const saved = normalizeSettings(
          (persisted as Partial<PersistedSettings> | undefined)?.saved,
        );
        return { ...current, saved, draft: clone(saved), hydrated: true };
      },
    },
  ),
);

export function selectIsDirty(state: Pick<SettingsState, 'saved' | 'draft'>): boolean {
  return JSON.stringify(state.saved) !== JSON.stringify(state.draft);
}

/**
 * API keys in tab memory — the only place the app reads them from. Never part of settings or
 * exports. With `keyStorage: 'device'` they are additionally written through to the encrypted
 * vault and restored on load (`lib/provider-keys.ts`); this store does not know about that.
 */
interface ProviderKeysState {
  keys: Record<string, string>;
  setKey: (id: string, key: string) => void;
  deleteKey: (id: string) => void;
  /** Replaces the whole set (restore from the device vault on load). */
  hydrate: (keys: Record<string, string>) => void;
  clear: () => void;
}

export const useProviderKeys = create<ProviderKeysState>()((set) => ({
  keys: {},
  setKey: (id, key) => set((state) => ({ keys: { ...state.keys, [id]: key } })),
  deleteKey: (id) =>
    set((state) => {
      const { [id]: _removed, ...rest } = state.keys;
      return { keys: rest };
    }),
  hydrate: (keys) => set({ keys: { ...keys } }),
  clear: () => set({ keys: {} }),
}));
