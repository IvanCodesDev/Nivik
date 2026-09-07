import type { ModelRef } from '@nivik/protocol';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { LANGUAGE_SETTINGS } from '@/lib/i18n/locales';
import { THEMES } from '@/lib/theme/themes';

export { THEMES };

/** Wire format spoken at the Base URL; relays and first-party vendors are configured the same way. */
export const API_COMPATIBILITIES = ['openai', 'anthropic', 'gemini'] as const;
export type ApiCompatibility = (typeof API_COMPATIBILITIES)[number];

/**
 * One configured model: an endpoint, the format it speaks and the model id to request. Any general
 * chat model is enough for the agent, so there is no capability declaration to maintain. The API
 * key is not part of this record (see `useProviderKeys`).
 */
export interface ProviderConfig {
  id: string;
  name: string;
  url: string;
  compatibility: ApiCompatibility;
  model: string;
  tested: boolean;
  latency: number | null;
}

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
  /** Base URL of the Agent Runtime (`apps/agent`); empty = build-time default. */
  agentRuntimeUrl: string;
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
  agentRuntimeUrl: '',
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

/**
 * Keeps only what a configured model needs; returns null for entries that cannot be used (stale
 * storage, hand-edited exports). Retired fields such as `type`, `context` and `capabilities` fall
 * away here.
 */
export function normalizeProvider(input: unknown): ProviderConfig | null {
  if (!isRecord(input)) return null;
  const { id, name, url, model, compatibility, tested, latency } = input;
  if (!nonEmptyString(id) || !nonEmptyString(url) || !nonEmptyString(model)) return null;
  return {
    id,
    name: typeof name === 'string' ? name : '',
    url,
    compatibility: oneOf(API_COMPATIBILITIES, compatibility, 'openai'),
    model,
    tested: tested === true,
    latency: typeof latency === 'number' && Number.isFinite(latency) ? latency : null,
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
    providers,
    defaultModel: providers.some((p) => p.id === merged.defaultModel) ? merged.defaultModel : null,
  };
}

const SETTINGS_VERSION = 6;

/**
 * v1 stored the option labels shown in the UI; v2 stores protocol / IR ids. v1 also had a
 * `diagramType` preference, which `normalizeSettings` drops as an unknown key. v3 made the
 * language setting effective; earlier stored values were an inert default, not a choice. v4
 * removed the hosted `nivik-auto` model, generation parameters and provider capability
 * declarations; `normalizeSettings` / `normalizeProvider` strip them, so no explicit step is needed.
 * v5 stores the canvas background as a tint instead of a light-theme hex colour. v6 replaced the
 * `showGrid` switch with the `canvasPattern` choice.
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
          return { draft: { ...state.draft, providers, defaultModel } };
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

/** API keys live only in tab memory (never persisted, never exported). */
interface ProviderKeysState {
  keys: Record<string, string>;
  setKey: (id: string, key: string) => void;
  deleteKey: (id: string) => void;
}

export const useProviderKeys = create<ProviderKeysState>()((set) => ({
  keys: {},
  setKey: (id, key) => set((state) => ({ keys: { ...state.keys, [id]: key } })),
  deleteKey: (id) =>
    set((state) => {
      const { [id]: _removed, ...rest } = state.keys;
      return { keys: rest };
    }),
}));
