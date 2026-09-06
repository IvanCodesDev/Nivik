import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const PROVIDER_TYPES = [
  'OpenAI',
  'Anthropic',
  'Google Gemini',
  'DeepSeek',
  'Qwen',
  'Moonshot',
  'GLM',
  'MiniMax',
  'OpenRouter',
  'OpenAI-compatible Custom Provider',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export type ApiCompatibility = 'openai' | 'anthropic' | 'gemini';

export const CAPABILITY_KEYS = ['text', 'vision', 'tools', 'json', 'thinking'] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];
export type ProviderCapabilities = Record<CapabilityKey, boolean>;

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  url: string;
  compatibility: ApiCompatibility;
  model: string;
  context: number | null;
  capabilities: ProviderCapabilities;
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

export interface Settings {
  // General
  renderer: 'Excalidraw' | 'draw.io';
  diagramType: 'Auto' | 'Architecture' | 'Flow' | 'ERD' | 'Sequence' | 'System' | 'Data Flow';
  autoLayout: boolean;
  autoSave: boolean;
  language: 'en' | 'zh-CN' | 'ja';
  // AI & Models
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  thinking: boolean;
  timeout: number;
  retryCount: '0' | '1' | '2' | '3';
  /** Base URL of the Agent Runtime (`apps/agent`); empty = build-time default. */
  agentRuntimeUrl: string;
  // Canvas & Appearance
  showGrid: boolean;
  gridSize: '12' | '18' | '20' | '24' | '32';
  canvasBackground: string;
  snap: boolean;
  selection: 'outline' | 'fill';
  theme: 'light' | 'system';
  nodeStyle: 'rounded' | 'square' | 'pill';
  edgeStyle: 'solid' | 'dashed';
  // Account
  userName: string;
  email: string;
  avatar: string;
  avatarColor: AvatarColor;
  providers: ProviderConfig[];
}

export const DEFAULT_SETTINGS: Settings = {
  renderer: 'Excalidraw',
  diagramType: 'Auto',
  autoLayout: true,
  autoSave: true,
  language: 'en',
  defaultModel: 'nivik-auto',
  temperature: 0.7,
  maxTokens: 4096,
  thinking: false,
  timeout: 30,
  retryCount: '0',
  agentRuntimeUrl: '',
  showGrid: true,
  gridSize: '18',
  canvasBackground: '#faf9fb',
  snap: true,
  selection: 'outline',
  theme: 'light',
  nodeStyle: 'rounded',
  edgeStyle: 'solid',
  userName: 'Sam',
  email: '',
  avatar: '',
  avatarColor: 'violet',
  providers: [],
};

export const BUILT_IN_MODELS = [
  { value: 'nivik-auto', label: 'Nivik Auto' },
  { value: 'nivik-fast', label: 'Nivik Fast' },
] as const;

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

function normalize(input: Partial<Settings> | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  if (!Array.isArray(merged.providers)) merged.providers = [];
  return merged;
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
          return { draft: { ...state.draft, providers } };
        }),
      removeProvider: (id) =>
        set((state) => ({
          draft: {
            ...state.draft,
            providers: state.draft.providers.filter((p) => p.id !== id),
            defaultModel: state.draft.defaultModel === id ? 'nivik-auto' : state.draft.defaultModel,
          },
        })),
      save: () => set({ saved: clone(get().draft) }),
      discard: () => set({ draft: clone(get().saved) }),
    }),
    {
      name: 'nivik.settings.v2',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Hydrate explicitly from <StoreHydrator/> so server and first client render agree.
      skipHydration: true,
      partialize: (state) => ({ saved: state.saved }),
      merge: (persisted, current) => {
        const saved = normalize((persisted as Partial<SettingsState> | undefined)?.saved);
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
