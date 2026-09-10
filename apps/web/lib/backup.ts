import { parseDiagram } from '@nivik/ir';
import type { NivikDB } from '@nivik/storage';
import { z } from 'zod';
import { normalizeSettings, type Settings } from '@/lib/stores/settings-store';

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

export class BackupError extends Error {
  readonly code: 'E_INVALID_BACKUP';
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = 'E_INVALID_BACKUP';
  }
}

const row = z.record(z.string(), z.unknown());
const keyed = (key: string) =>
  row.refine((r) => typeof r[key] === 'string' && r[key] !== '', `missing ${key}`);

/**
 * What `exportAllData` wrote, checked before anything touches the database: every table is a list
 * of keyed rows, diagram rows carry a document `parseDiagram` accepts. Rows are not deep-validated
 * beyond that — they came out of this app's own tables.
 */
export const BackupSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    exportedAt: z.string(),
    settings: z.unknown(),
    tables: z.object({
      diagrams: z.array(keyed('id').refine((r) => safeDiagram(r.ir), 'invalid diagram document')),
      versions: z.array(keyed('id')),
      changeSets: z.array(keyed('id')),
      runs: z.array(keyed('id')),
      sources: z.array(keyed('id')),
      templates: z.array(keyed('id')),
      providers: z.array(keyed('id')),
      settings: z.array(keyed('key')),
    }),
  })
  .strict();

function safeDiagram(ir: unknown): boolean {
  try {
    parseDiagram(ir);
    return true;
  } catch {
    return false;
  }
}

export function parseBackup(text: string): Backup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new BackupError(
      `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = BackupSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new BackupError(
      issue ? `${issue.path.join('.') || 'backup'}: ${issue.message}` : 'Not a Nivik backup',
    );
  }
  const parsed = result.data;
  return {
    ...parsed,
    settings: normalizeSettings(parsed.settings as Partial<Settings> | undefined),
    tables: parsed.tables as Backup['tables'],
  };
}

export type RestoreCounts = Record<BackupTable, number>;

export interface RestoreOptions {
  /** Receives the backup's preferences when the user asked for them to be restored too. */
  settings?: (saved: Settings) => void;
}

/**
 * Spec 06 §4 "Import backup": merges the backup into this device in one transaction — rows with
 * the same key are overwritten, everything else is kept. `secrets` is never in a backup and the
 * device key never leaves its browser, so keys are untouched. Preferences are applied last, and
 * only if asked.
 */
export async function restoreBackup(
  db: NivikDB,
  backup: Backup,
  opts: RestoreOptions = {},
): Promise<RestoreCounts> {
  const counts = {} as RestoreCounts;
  const tables = BACKUP_TABLES.map((name) => db.table(name));
  await db.transaction('rw', tables, async () => {
    for (const name of BACKUP_TABLES) {
      const rows =
        name === 'settings'
          ? backup.tables.settings.filter(
              (r) => (r as { key?: unknown }).key !== DEVICE_KEY_SETTING,
            )
          : backup.tables[name];
      if (rows.length > 0) await db.table(name).bulkPut(rows);
      counts[name] = rows.length;
    }
  });
  opts.settings?.(backup.settings);
  return counts;
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
