import type { NivikDB } from './db';
import type { SecretRecord } from './records';

/** Where the non-extractable device key lives between sessions. */
export interface DeviceKeyStore {
  load(): Promise<CryptoKey | null>;
  save(key: CryptoKey): Promise<void>;
  clear(): Promise<void>;
}

export const DEVICE_KEY_SETTING = 'device-key';

/** Spec 06 §6.1: the key is stored as a `CryptoKey` object in `settings`; IndexedDB clones it, scripts cannot export it. */
export function settingsKeyStore(db: NivikDB): DeviceKeyStore {
  return {
    async load() {
      const record = await db.settings.get(DEVICE_KEY_SETTING);
      return record && isCryptoKey(record.value) ? record.value : null;
    },
    async save(key) {
      await db.settings.put({ key: DEVICE_KEY_SETTING, value: key, updatedAt: Date.now() });
    },
    async clear() {
      await db.settings.delete(DEVICE_KEY_SETTING);
    },
  };
}

const isCryptoKey = (value: unknown): value is CryptoKey =>
  typeof value === 'object' && value !== null && 'algorithm' in value && 'usages' in value;

export interface SecretVaultDeps {
  keyStore?: DeviceKeyStore;
  crypto?: Crypto;
  now?(): number;
}

const ALGORITHM = 'AES-GCM';
const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Spec 06 §6.1 `device` key storage: API keys encrypted at rest with a per-device AES-GCM key that
 * the browser holds as a non-extractable `CryptoKey`. Defends against copying the IndexedDB files;
 * does not (and cannot) defend against same-origin scripts, which is stated to the user as such.
 */
export class SecretVault {
  readonly #db: NivikDB;
  readonly #keyStore: DeviceKeyStore;
  readonly #crypto: Crypto;
  readonly #now: () => number;
  #key: Promise<CryptoKey> | null = null;

  constructor(db: NivikDB, deps: SecretVaultDeps = {}) {
    this.#db = db;
    this.#keyStore = deps.keyStore ?? settingsKeyStore(db);
    this.#crypto = deps.crypto ?? globalThis.crypto;
    this.#now = deps.now ?? (() => Date.now());
  }

  async put(providerId: string, secret: string): Promise<void> {
    const key = await this.#deviceKey();
    const iv = this.#crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const cipher = await this.#crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      encoder.encode(secret),
    );
    const record: SecretRecord = { providerId, cipher, iv, createdAt: this.#now() };
    await this.#db.secrets.put(record);
  }

  /** `null` when there is no record, or when it cannot be read (the record is then dropped). */
  async get(providerId: string): Promise<string | null> {
    const record = await this.#db.secrets.get(providerId);
    if (!record) return null;
    try {
      const key = await this.#deviceKey();
      // Records read back from IndexedDB may be views over a shared buffer; give WebCrypto a copy.
      const iv = new Uint8Array(record.iv);
      const plain = await this.#crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, record.cipher);
      return decoder.decode(plain);
    } catch {
      await this.#db.secrets.delete(providerId);
      return null;
    }
  }

  async has(providerId: string): Promise<boolean> {
    return (await this.#db.secrets.get(providerId)) !== undefined;
  }

  async delete(providerId: string): Promise<void> {
    await this.#db.secrets.delete(providerId);
  }

  async list(): Promise<string[]> {
    const ids = (await this.#db.secrets.toCollection().primaryKeys()) as string[];
    return ids.sort();
  }

  /** Forget every secret and the device key itself (switching back to session storage). */
  async clear(): Promise<void> {
    await this.#db.secrets.clear();
    await this.#keyStore.clear();
    this.#key = null;
  }

  #deviceKey(): Promise<CryptoKey> {
    this.#key ??= (async () => {
      const existing = await this.#keyStore.load();
      if (existing) return existing;
      const created = await this.#crypto.subtle.generateKey(
        { name: ALGORITHM, length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      await this.#keyStore.save(created);
      return created;
    })().catch((error: unknown) => {
      this.#key = null;
      throw error;
    });
    return this.#key;
  }
}
