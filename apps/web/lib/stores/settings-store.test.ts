import { beforeEach, describe, expect, it } from 'vitest';
import {
  CANVAS_BACKGROUNDS,
  CANVAS_PATTERNS,
  canvasBackgroundVar,
  DEFAULT_SETTINGS,
  LANGUAGES,
  migrateSettings,
  normalizeProvider,
  normalizeSettings,
  type ProviderConfig,
  resolveModelRef,
  THEMES,
  useSettingsStore,
} from './settings-store';

const provider: ProviderConfig = {
  id: 'p1',
  name: 'DeepSeek',
  url: 'https://api.deepseek.com/v1',
  compatibility: 'openai',
  model: 'deepseek-chat',
  tested: true,
  latency: 420,
};

const second: ProviderConfig = {
  id: 'p2',
  name: 'Relay',
  url: 'https://relay.example.com/v1',
  compatibility: 'openai',
  model: 'gpt-4o-mini',
  tested: false,
  latency: null,
};

describe('DEFAULT_SETTINGS', () => {
  it('does not ship a placeholder user name', () => {
    expect(DEFAULT_SETTINGS.userName).toBe('');
  });

  it('stores the renderer as a protocol id', () => {
    expect(DEFAULT_SETTINGS.renderer).toBe('excalidraw');
  });

  it('has no default diagram type: the agent classifies every diagram in its plan', () => {
    expect('diagramType' in DEFAULT_SETTINGS).toBe(false);
  });

  it('follows the browser language until the user picks one', () => {
    expect(DEFAULT_SETTINGS.language).toBe('auto');
    expect(LANGUAGES).toEqual(['auto', 'en', 'zh-CN']);
  });

  it('starts with no model and no generation parameters of its own', () => {
    expect(DEFAULT_SETTINGS.defaultModel).toBeNull();
    expect(DEFAULT_SETTINGS.providers).toEqual([]);
    for (const key of ['temperature', 'maxTokens', 'thinking', 'timeout', 'retryCount']) {
      expect(key in DEFAULT_SETTINGS, key).toBe(false);
    }
  });

  it('offers light, system and dark themes and stores the canvas background as a tint', () => {
    expect(THEMES).toEqual(['light', 'system', 'dark']);
    expect(CANVAS_BACKGROUNDS).toEqual(['white', 'soft', 'lavender', 'mint', 'paper']);
    expect(DEFAULT_SETTINGS.theme).toBe('light');
    expect(DEFAULT_SETTINGS.canvasBackground).toBe('soft');
    expect(canvasBackgroundVar('mint')).toBe('var(--nv-canvas-mint)');
  });

  it('describes the background pattern as a choice between dots and a plain sheet', () => {
    expect(CANVAS_PATTERNS).toEqual(['dots', 'plain']);
    expect(DEFAULT_SETTINGS.canvasPattern).toBe('dots');
    expect('showGrid' in DEFAULT_SETTINGS).toBe(false);
  });
});

describe('normalizeProvider', () => {
  it('keeps a well-formed provider and strips retired fields', () => {
    expect(
      normalizeProvider({
        ...provider,
        type: 'DeepSeek',
        context: 64_000,
        capabilities: { text: true },
      }),
    ).toEqual(provider);
  });

  it('rejects entries missing the essentials', () => {
    expect(normalizeProvider({ ...provider, url: '' })).toBeNull();
    expect(normalizeProvider({ ...provider, model: undefined })).toBeNull();
    expect(normalizeProvider({ ...provider, id: 42 })).toBeNull();
    expect(normalizeProvider('nope')).toBeNull();
  });

  it('falls back to OpenAI-compatible for unknown formats and defaults test metadata', () => {
    expect(
      normalizeProvider({
        id: 'x',
        name: 'X',
        url: 'https://x.test',
        model: 'm',
        compatibility: '?',
      }),
    ).toEqual({
      id: 'x',
      name: 'X',
      url: 'https://x.test',
      compatibility: 'openai',
      model: 'm',
      tested: false,
      latency: null,
    });
  });
});

describe('normalizeSettings', () => {
  it('fills missing keys from defaults', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ canvasPattern: 'plain' }).canvasPattern).toBe('plain');
    expect(normalizeSettings({ canvasPattern: 'plain' }).gridSize).toBe(DEFAULT_SETTINGS.gridSize);
  });

  it('falls back to defaults for values outside the allowed set', () => {
    const settings = normalizeSettings({
      renderer: 'bogus',
      theme: 'sepia',
      canvasBackground: '#f5f1ff',
      canvasPattern: 'stripes',
      providers: 'nope',
    } as never);
    expect(settings.renderer).toBe('excalidraw');
    expect(settings.theme).toBe('light');
    expect(settings.canvasBackground).toBe('soft');
    expect(settings.canvasPattern).toBe('dots');
    expect(settings.providers).toEqual([]);
    expect(
      normalizeSettings({ theme: 'dark', canvasBackground: 'paper', canvasPattern: 'plain' }),
    ).toMatchObject({ theme: 'dark', canvasBackground: 'paper', canvasPattern: 'plain' });
  });

  it('retires Japanese to auto instead of keeping an unsupported language', () => {
    expect(normalizeSettings({ language: 'ja' } as never).language).toBe('auto');
    expect(normalizeSettings({ language: 'zh-CN' }).language).toBe('zh-CN');
  });

  it('drops keys that are no longer settings, such as the removed diagram type', () => {
    const settings = normalizeSettings({ diagramType: 'auto', canvasPattern: 'plain' } as never);
    expect('diagramType' in settings).toBe(false);
    expect(settings.canvasPattern).toBe('plain');
  });

  it('keeps valid provider lists intact and discards broken entries', () => {
    expect(normalizeSettings({ providers: [provider] }).providers).toEqual([provider]);
    expect(
      normalizeSettings({ providers: [provider, { id: 'broken' }] } as never).providers,
    ).toEqual([provider]);
  });

  it('only keeps a default model that exists', () => {
    expect(normalizeSettings({ providers: [provider], defaultModel: 'p1' }).defaultModel).toBe(
      'p1',
    );
    expect(normalizeSettings({ providers: [provider], defaultModel: 'gone' }).defaultModel).toBe(
      null,
    );
    expect(normalizeSettings({ defaultModel: 'nivik-auto' }).defaultModel).toBeNull();
  });
});

describe('migrateSettings', () => {
  it('upgrades v1 display labels to ids and forgets the v1 diagram type preference', () => {
    const { saved } = migrateSettings(
      { saved: { renderer: 'draw.io', diagramType: 'Data Flow', defaultModel: 'nivik-fast' } },
      1,
    );
    expect(saved.renderer).toBe('drawio');
    expect('diagramType' in saved).toBe(false);
    expect(saved.defaultModel).toBeNull();
  });

  it('leaves a real user name alone', () => {
    expect(migrateSettings({ saved: { userName: 'Sam' } }, 1).saved.userName).toBe('Sam');
  });

  it('resets the language to auto for state saved before the setting had any effect', () => {
    expect(migrateSettings({ saved: { language: 'en' } }, 2).saved.language).toBe('auto');
    expect(migrateSettings({ saved: { language: 'zh-CN' } }, 1).saved.language).toBe('auto');
    expect(migrateSettings({ saved: { language: 'zh-CN' } }, 3).saved.language).toBe('zh-CN');
  });

  it('carries v3 providers into v4 without their declared capabilities or parameters', () => {
    const { saved } = migrateSettings(
      {
        saved: {
          defaultModel: 'p1',
          temperature: 0.7,
          maxTokens: 4096,
          providers: [{ ...provider, type: 'DeepSeek', context: 64_000, capabilities: {} }],
        },
      },
      3,
    );
    expect(saved.providers).toEqual([provider]);
    expect(saved.defaultModel).toBe('p1');
    expect('temperature' in saved).toBe(false);
  });

  it('turns the v4 background colour into its tint so dark mode can restyle it', () => {
    const tint = (hex: string) =>
      migrateSettings({ saved: { canvasBackground: hex } }, 4).saved.canvasBackground;
    expect(tint('#faf9fb')).toBe('soft');
    expect(tint('#f5f1ff')).toBe('lavender');
    expect(tint('#eff9f5')).toBe('mint');
    expect(tint('#fff9ed')).toBe('paper');
    expect(tint('#ffffff')).toBe('white');
    expect(tint('#123456')).toBe('soft');
  });

  it('turns the v5 grid switch into the background pattern', () => {
    const pattern = (saved: Record<string, unknown>) => migrateSettings({ saved }, 5).saved;
    expect(pattern({ showGrid: false })).toMatchObject({ canvasPattern: 'plain' });
    expect(pattern({ showGrid: true })).toMatchObject({ canvasPattern: 'dots' });
    expect(pattern({})).toMatchObject({ canvasPattern: 'dots' });
    expect('showGrid' in pattern({ showGrid: false })).toBe(false);
  });

  it('is a no-op for current-version state and garbage input', () => {
    const current = { saved: { ...DEFAULT_SETTINGS, renderer: 'drawio' as const } };
    expect(migrateSettings(current, 6)).toEqual(current);
    expect(migrateSettings(null, 0)).toEqual({ saved: DEFAULT_SETTINGS });
  });
});

describe('resolveModelRef', () => {
  const settings = { ...DEFAULT_SETTINGS, providers: [provider] };

  it('maps "no model" to the auto router', () => {
    expect(resolveModelRef(settings, null)).toBe('auto');
    expect(resolveModelRef({ ...settings, defaultModel: null })).toBe('auto');
  });

  it('maps a configured provider to its provider/model pair', () => {
    expect(resolveModelRef(settings, 'p1')).toEqual({ providerId: 'p1', model: 'deepseek-chat' });
  });

  it('falls back to auto when the provider no longer exists', () => {
    expect(resolveModelRef(settings, 'gone')).toBe('auto');
  });

  it('uses the saved default model when no id is given', () => {
    expect(resolveModelRef({ ...settings, defaultModel: 'p1' })).toEqual({
      providerId: 'p1',
      model: 'deepseek-chat',
    });
  });
});

describe('useSettingsStore provider actions', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      saved: structuredClone(DEFAULT_SETTINGS),
      draft: structuredClone(DEFAULT_SETTINGS),
    });
  });

  it('makes the first configured model the default automatically', () => {
    useSettingsStore.getState().upsertProvider(provider);
    expect(useSettingsStore.getState().draft.defaultModel).toBe('p1');
    useSettingsStore.getState().upsertProvider(second);
    expect(useSettingsStore.getState().draft.defaultModel).toBe('p1');
  });

  it('updates an existing provider in place', () => {
    useSettingsStore.getState().upsertProvider(provider);
    useSettingsStore.getState().upsertProvider({ ...provider, model: 'deepseek-reasoner' });
    expect(useSettingsStore.getState().draft.providers).toEqual([
      { ...provider, model: 'deepseek-reasoner' },
    ]);
  });

  it('hands the default to the next model when the default is removed', () => {
    const store = useSettingsStore.getState();
    store.upsertProvider(provider);
    store.upsertProvider(second);
    store.removeProvider('p1');
    expect(useSettingsStore.getState().draft.defaultModel).toBe('p2');
    useSettingsStore.getState().removeProvider('p2');
    expect(useSettingsStore.getState().draft.defaultModel).toBeNull();
  });
});
