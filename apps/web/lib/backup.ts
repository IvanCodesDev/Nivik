import type { NivikDB } from '@nivik/storage';
import type { Settings } from '@/lib/stores/settings-store';

export const BACKUP_FORMAT = 'nivik-backup';
export const BACKUP_VERSION = 1;

/** Tables that go into a backup, in the order they are written. `secrets` never does (spec 06 §6.2). */
export const BACKUP_TABLES = [
  'diagrams',
  'versions',
  'changeSets',
  'runs',
  'sources',
  'templates',
  'providers',
  'settings',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  /** The saved preferences (`nivik.settings.v*`), API keys excluded by construction. */
  settings: Settings;
  tables: Record<BackupTable, unknown[]>;
}

/** The device key is a `CryptoKey` (not serialisable, and pointless without the ciphertext). */
const DEVICE_KEY_SETTING = 'device-key';

/**
 * Spec 06 §6.2 "Export all data": one JSON document with every table except `secrets`, plus the
 * saved settings. The device key row is skipped too; without the ciphertext it carries nothing.
 */
export async function exportAllData(
  db: NivikDB,
  settings: Settings,
  now: () => Date = () => new Date(),
): Promise<Backup> {
  const tables = {} as Record<BackupTable, unknown[]>;
  for (const name of BACKUP_TABLES) {
    const rows = await db.table(name).toArray();
    tables[name] =
      name === 'settings'
        ? rows.filter((row) => (row as { key?: unknown }).key !== DEVICE_KEY_SETTING)
        : rows;
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now().toISOString(),
    settings,
    tables,
  };
}

export function backupFilename(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `nivik-backup-${yyyy}-${mm}-${dd}.json`;
}

export function backupBlob(backup: Backup): Blob {
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
}

export interface ClearLocalDataDeps {
  db: NivikDB;
  /** `localStorage` (settings, favourites); optional because some contexts have none. */
  storage?: Pick<Storage, 'removeItem' | 'key' | 'length'> | null;
  /** Forget the API keys held in tab memory. */
  clearKeys(): void;
  /** Start over with a fresh page; the stores are not designed to be emptied while mounted. */
  reload(): void;
}

/** localStorage keys this app owns; anything else on the origin is left alone. */
const OWN_STORAGE_PREFIX = 'nivik.';

/**
 * Spec 06 §6.2 "Clear local data": every table (`secrets` included — the keys go with everything
 * else), every `nivik.*` localStorage entry and the in-memory keys, then a reload so the app starts
 * from defaults.
 */
export async function clearLocalData(deps: ClearLocalDataDeps): Promise<void> {
  await deps.db.transaction('rw', deps.db.tables, async () => {
    await Promise.all(deps.db.tables.map((table) => table.clear()));
  });
  if (deps.storage) {
    const owned: string[] = [];
    for (let i = 0; i < deps.storage.length; i += 1) {
      const key = deps.storage.key(i);
      if (key?.startsWith(OWN_STORAGE_PREFIX)) owned.push(key);
    }
    for (const key of owned) deps.storage.removeItem(key);
  }
  deps.clearKeys();
  deps.reload();
}
