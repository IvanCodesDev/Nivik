// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { type DeviceKeyStore, NivikDB, SecretVault } from '@nivik/storage';
import { ToastProvider } from '@nivik/ui';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import { setVault } from '@/lib/provider-keys';
import {
  DEFAULT_SETTINGS,
  type ProviderConfig,
  useProviderKeys,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import { SettingsPage } from './settings-page';

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

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const provider: ProviderConfig = {
  id: 'p1',
  name: 'DeepSeek',
  url: 'https://api.deepseek.com/v1',
  compatibility: 'openai',
  kind: 'deepseek',
  model: 'deepseek-chat',
  transport: 'auto',
  capabilities: null,
  verified: null,
};

function memoryKeyStore(): DeviceKeyStore {
  let key: CryptoKey | null = null;
  return {
    async load() {
      return key;
    },
    async save(next) {
      key = next;
    },
    async clear() {
      key = null;
    },
  };
}

let counter = 0;

describe('SettingsPage — key storage (spec 06 §6.1)', () => {
  let vault: SecretVault;

  beforeEach(() => {
    vault = new SecretVault(new NivikDB(`settings-page-${++counter}`), {
      keyStore: memoryKeyStore(),
    });
    setVault(vault);
    const saved = { ...DEFAULT_SETTINGS, providers: [provider], defaultModel: 'p1' };
    useSettingsStore.setState({ saved, draft: saved, hydrated: true });
    useProviderKeys.getState().hydrate({ p1: ['sk', 'deepseek', 'abcdefghijklmnop'].join('-') });
  });
  afterEach(() => {
    cleanup();
    setVault(null);
  });

  const renderPage = () =>
    render(
      <I18nProvider initialLocale="en">
        <ToastProvider>
          <SettingsPage section="ai" />
        </ToastProvider>
      </I18nProvider>,
    );

  it('Save with the mode switched to device encrypts the keys the tab holds', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText('Key in session')).toBeDefined();

    useSettingsStore.getState().update({ keyStorage: 'device' });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(useSettingsStore.getState().saved.keyStorage).toBe('device');
    await waitFor(async () => expect(await vault.list()).toEqual(['p1']));
    expect(await vault.get('p1')).toBe(useProviderKeys.getState().keys.p1);
    expect(screen.getByText('Key on this device')).toBeDefined();
  });

  it('Save with the mode switched back to session wipes the vault but keeps the tab keys', async () => {
    await vault.put('p1', 'sk-old');
    const saved = { ...useSettingsStore.getState().saved, keyStorage: 'device' as const };
    useSettingsStore.setState({ saved, draft: saved });
    const user = userEvent.setup();
    renderPage();

    useSettingsStore.getState().update({ keyStorage: 'session' });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(useSettingsStore.getState().saved.keyStorage).toBe('session');
    await waitFor(async () => expect(await vault.list()).toEqual([]));
    expect(useProviderKeys.getState().keys.p1).toBeDefined();
  });
});
