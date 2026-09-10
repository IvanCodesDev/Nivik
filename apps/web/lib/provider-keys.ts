import { SecretVault } from '@nivik/storage';
import { getRepository } from '@/lib/repository';
import { type KeyStorage, useProviderKeys } from '@/lib/stores/settings-store';

let vault: SecretVault | null = null;

/** Browser singleton over the same Dexie database the diagrams live in. */
export function getVault(): SecretVault {
  vault ??= new SecretVault(getRepository().db);
  return vault;
}

export function setVault(next: SecretVault | null): void {
  vault = next;
}

/** Spec 06 §6.1 `device` mode, page load: what the vault holds becomes the tab's keys. */
export async function loadDeviceKeys(
  store: SecretVault = getVault(),
): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};
  for (const id of await store.list()) {
    const secret = await store.get(id);
    if (secret) keys[id] = secret;
  }
  return keys;
}

/**
 * The single write path for a key: always into tab memory (the only place the app reads from);
 * under `device` storage also, encrypted, into the vault.
 */
export async function persistKey(
  id: string,
  key: string,
  mode: KeyStorage,
  store: SecretVault = getVault(),
): Promise<void> {
  useProviderKeys.getState().setKey(id, key);
  if (mode === 'device') await store.put(id, key);
}

/** Forgets a key everywhere, whatever the mode (a stale vault entry must not resurface later). */
export async function forgetKey(id: string, store: SecretVault = getVault()): Promise<void> {
  useProviderKeys.getState().deleteKey(id);
  await store.delete(id);
}

/**
 * Applies a change of `keyStorage`: moving to `device` encrypts the keys the tab already holds;
 * moving back to `session` wipes the vault and its device key, leaving the tab's memory as is.
 */
export async function applyKeyStorageChange(
  from: KeyStorage,
  to: KeyStorage,
  keys: Record<string, string>,
  store: SecretVault = getVault(),
): Promise<void> {
  if (from === to) return;
  if (to === 'device') {
    for (const [id, key] of Object.entries(keys)) await store.put(id, key);
    return;
  }
  await store.clear();
}
