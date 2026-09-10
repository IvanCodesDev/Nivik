import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { NivikDB } from './db';
import { type DeviceKeyStore, SecretVault, settingsKeyStore } from './secrets';

let counter = 0;
const freshDb = () => new NivikDB(`secrets-test-${++counter}`);

/** In-memory device key: the browser keeps it in IndexedDB, tests keep it here. */
function memoryKeyStore(): DeviceKeyStore & { key: CryptoKey | null } {
  return {
    key: null,
    async load() {
      return this.key;
    },
    async save(key) {
      this.key = key;
    },
    async clear() {
      this.key = null;
    },
  };
}

const bytesOf = (buffer: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(buffer));

describe('SecretVault (spec 06 §6.1 device mode)', () => {
  it('round-trips a secret and never stores it in the clear', async () => {
    const db = freshDb();
    const vault = new SecretVault(db, { keyStore: memoryKeyStore(), now: () => 42 });
    await vault.put('p1', 'sk-very-secret-value');
    expect(await vault.get('p1')).toBe('sk-very-secret-value');
    expect(await vault.has('p1')).toBe(true);
    expect(await vault.has('nope')).toBe(false);

    const record = await db.secrets.get('p1');
    expect(record?.createdAt).toBe(42);
    expect(record?.iv).toHaveLength(12);
    expect(bytesOf(record?.cipher as ArrayBuffer)).not.toContain('very-secret');
  });

  it('overwrites with a fresh iv, lists ids sorted and forgets on delete', async () => {
    const db = freshDb();
    const vault = new SecretVault(db, { keyStore: memoryKeyStore() });
    await vault.put('b', 'one');
    const first = await db.secrets.get('b');
    await vault.put('b', 'two');
    const second = await db.secrets.get('b');
    expect(await vault.get('b')).toBe('two');
    expect(Array.from(first?.iv ?? [])).not.toEqual(Array.from(second?.iv ?? []));

    await vault.put('a', 'x');
    expect(await vault.list()).toEqual(['a', 'b']);
    await vault.delete('a');
    expect(await vault.list()).toEqual(['b']);
    expect(await vault.get('a')).toBeNull();
  });

  it('clear wipes the records and the device key', async () => {
    const db = freshDb();
    const keyStore = memoryKeyStore();
    const vault = new SecretVault(db, { keyStore });
    await vault.put('p1', 'sk');
    expect(keyStore.key).not.toBeNull();
    await vault.clear();
    expect(await vault.list()).toEqual([]);
    expect(keyStore.key).toBeNull();
    expect(await db.secrets.count()).toBe(0);
  });

  it('treats records it cannot decrypt as gone (a different device key)', async () => {
    const db = freshDb();
    await new SecretVault(db, { keyStore: memoryKeyStore() }).put('p1', 'sk');
    const other = new SecretVault(db, { keyStore: memoryKeyStore() });
    expect(await other.get('p1')).toBeNull();
    expect(await db.secrets.count()).toBe(0);
  });

  it('keeps the device key in the settings table by default', async () => {
    const db = freshDb();
    const store = settingsKeyStore(db);
    let persisted: CryptoKey | null = null;
    try {
      const vault = new SecretVault(db, { keyStore: store });
      await vault.put('p1', 'sk');
      persisted = await store.load();
    } catch (error) {
      // fake-indexeddb cannot structured-clone a CryptoKey; browsers can (spec 06 §6.1).
      if (!(error instanceof Error && /clone|CryptoKey/i.test(error.message))) throw error;
      return;
    }
    expect(persisted).not.toBeNull();
    expect(persisted?.extractable).toBe(false);
    expect(await new SecretVault(db, { keyStore: settingsKeyStore(db) }).get('p1')).toBe('sk');
  });
});
