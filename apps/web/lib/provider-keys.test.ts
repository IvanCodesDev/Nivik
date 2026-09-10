import 'fake-indexeddb/auto';
import { type DeviceKeyStore, NivikDB, SecretVault } from '@nivik/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyKeyStorageChange, forgetKey, loadDeviceKeys, persistKey } from './provider-keys';
import { useProviderKeys } from './stores/settings-store';

let counter = 0;

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

const freshVault = () =>
  new SecretVault(new NivikDB(`keys-test-${++counter}`), { keyStore: memoryKeyStore() });

describe('provider keys (spec 06 §6.1)', () => {
  beforeEach(() => useProviderKeys.getState().clear());

  it('session mode keeps keys in tab memory only', async () => {
    const vault = freshVault();
    await persistKey('p1', 'sk-1', 'session', vault);
    expect(useProviderKeys.getState().keys).toEqual({ p1: 'sk-1' });
    expect(await vault.list()).toEqual([]);
  });

  it('device mode writes through to the encrypted vault and restores on load', async () => {
    const vault = freshVault();
    await persistKey('p1', 'sk-1', 'device', vault);
    await persistKey('p2', 'sk-2', 'device', vault);
    expect(await vault.list()).toEqual(['p1', 'p2']);

    useProviderKeys.getState().clear();
    const restored = await loadDeviceKeys(vault);
    expect(restored).toEqual({ p1: 'sk-1', p2: 'sk-2' });
    useProviderKeys.getState().hydrate(restored);
    expect(useProviderKeys.getState().keys).toEqual(restored);
  });

  it('forgetting a key removes it from memory and from the vault', async () => {
    const vault = freshVault();
    await persistKey('p1', 'sk-1', 'device', vault);
    await forgetKey('p1', vault);
    expect(useProviderKeys.getState().keys).toEqual({});
    expect(await vault.has('p1')).toBe(false);
  });

  it('switching to device encrypts what the tab holds; switching back wipes the vault', async () => {
    const vault = freshVault();
    await applyKeyStorageChange('session', 'device', { a: 'sk-a', b: 'sk-b' }, vault);
    expect(await vault.list()).toEqual(['a', 'b']);
    expect(await vault.get('a')).toBe('sk-a');

    await applyKeyStorageChange('device', 'session', { a: 'sk-a', b: 'sk-b' }, vault);
    expect(await vault.list()).toEqual([]);

    await applyKeyStorageChange('session', 'session', { a: 'sk-a' }, vault);
    expect(await vault.list()).toEqual([]);
  });
});
