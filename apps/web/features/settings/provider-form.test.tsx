// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import type { ProbeReport } from '@nivik/protocol';
import { ToastProvider } from '@nivik/ui';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import { DEFAULT_SETTINGS, useProviderKeys, useSettingsStore } from '@/lib/stores/settings-store';
import { ProviderForm } from './provider-form';

const probeCapabilities = vi.hoisted(() => vi.fn<() => Promise<ProbeReport>>());

// Decorative only; the real package re-exports ~1500 icon modules and dominates import time.
vi.mock('@phosphor-icons/react', () => {
  const Icon = () => null;
  const isIconName = (key: PropertyKey) => typeof key === 'string' && /^[A-Z]/.test(key);
  return new Proxy(
    {},
    {
      has: (_, key) => isIconName(key),
      get: (_, key) => (isIconName(key) ? Icon : undefined),
    },
  );
});

vi.mock('@/lib/provider-probe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/provider-probe')>()),
  probeCapabilities,
}));

const okReport: ProbeReport = {
  models: ['deepseek-chat', 'deepseek-reasoner'],
  text: true,
  json: true,
  tools: false,
  vision: null,
  latencyMs: 412,
  contextLength: { value: 131_072, estimated: true },
  errors: [],
};

function renderForm(onDone = vi.fn()) {
  render(
    <I18nProvider initialLocale="en">
      <ToastProvider>
        <ProviderForm providerId={null} onDone={onDone} />
      </ToastProvider>
    </I18nProvider>,
  );
  return onDone;
}

describe('ProviderForm — Test Connection (spec 05 §9.3, 07 §4)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ saved: DEFAULT_SETTINGS, draft: DEFAULT_SETTINGS, hydrated: true });
    useProviderKeys.getState().clear();
    probeCapabilities.mockReset();
  });
  afterEach(cleanup);

  it('runs the probe set, shows what was detected and stores it on Save', async () => {
    probeCapabilities.mockResolvedValue(okReport);
    const user = userEvent.setup();
    const onDone = renderForm();

    await user.type(screen.getByLabelText('Base URL'), 'https://api.deepseek.com/v1');
    const key = ['sk', 'test', 'key', '1234567890'].join('-');
    await user.type(screen.getByLabelText('API Key'), key);
    await user.type(screen.getByLabelText('Model Name'), 'deepseek-chat');
    await user.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Connected/));
    expect(probeCapabilities).toHaveBeenCalledTimes(1);
    const [target, model, options] = probeCapabilities.mock.calls[0] as unknown as [
      { url: string; apiKey: string; compatibility: string },
      string,
      { runtimeUrl: string | null },
    ];
    expect(target).toMatchObject({
      url: 'https://api.deepseek.com/v1',
      apiKey: key,
      compatibility: 'openai',
    });
    expect(model).toBe('deepseek-chat');
    expect(options.runtimeUrl).toBeNull();

    const chips = screen.getByRole('list', { name: 'Detected capabilities' });
    expect(chips.textContent).toContain('✓ Text');
    expect(chips.textContent).toContain('✓ Structured output');
    expect(chips.textContent).toContain('✗ Tool calls');
    expect(chips.textContent).not.toContain('Vision');
    expect(chips.textContent).toContain('≈128K context (estimated)');
    expect(chips.textContent).toContain('2 models listed');
    expect(screen.getByText('Response time 412 ms')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Save model' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    const [provider] = useSettingsStore.getState().draft.providers;
    expect(provider).toMatchObject({
      // No preset was picked, so the display name is suggested from the host.
      name: 'api.deepseek.com',
      url: 'https://api.deepseek.com/v1',
      compatibility: 'openai',
      kind: 'deepseek',
      model: 'deepseek-chat',
      transport: 'auto',
      capabilities: {
        text: true,
        json: true,
        tools: false,
        vision: false,
        thinking: false,
        contextLength: 131_072,
      },
    });
    expect(provider?.verified).toMatchObject({ latencyMs: 412, detected: true });
    expect(provider?.verified?.at).toBeGreaterThan(0);
    expect(useSettingsStore.getState().draft.defaultModel).toBe(provider?.id);
    expect(useProviderKeys.getState().keys[provider?.id ?? '']).toBe(key);
    // The key is in memory only: nothing in the settings record.
    expect(JSON.stringify(provider)).not.toContain(key);
  });

  it('blames the key on an auth failure and keeps the old capabilities out of Save', async () => {
    probeCapabilities.mockResolvedValue({
      ...okReport,
      text: false,
      json: false,
      latencyMs: null,
      errors: [
        { probe: 'text', code: 'E_PROVIDER_AUTH', message: 'Provider rejected the API key' },
      ],
    });
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Base URL'), 'https://api.deepseek.com/v1');
    await user.type(screen.getByLabelText('API Key'), 'wrong');
    await user.type(screen.getByLabelText('Model Name'), 'deepseek-chat');
    await user.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/API key/));
    expect(screen.queryByRole('list', { name: 'Detected capabilities' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save model' }));
    const [provider] = useSettingsStore.getState().draft.providers;
    expect(provider?.capabilities).toBeNull();
    expect(provider?.verified).toBeNull();
  });
});
