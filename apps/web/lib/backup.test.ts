import 'fake-indexeddb/auto';
import { createDiagram } from '@nivik/ir';
import { DiagramRepository, NivikDB, SecretVault } from '@nivik/storage';
import { describe, expect, it, vi } from 'vitest';
import { backupFilename, clearLocalData, exportAllData } from './backup';
import { DEFAULT_SETTINGS } from './stores/settings-store';

let counter = 0;
const freshDb = () => new NivikDB(`backup-test-${++counter}`);

function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (key: string) => void map.delete(key),
  };
}

describe('exportAllData (spec 06 §6.2)', () => {
  it('writes every table except secrets, skips the device key row and includes the settings', async () => {
    const db = freshDb();
    const repo = new DiagramRepository(db);
    await repo.create(
      createDiagram({ id: 'd_backup001', name: 'Login flow', type: 'flow', now: 1 }),
    );
    const vault = new SecretVault(db, {
      keyStore: {
        async load() {
          return null;
        },
        async save() {},
        async clear() {},
      },
    });
    await vault.put('p1', 'sk-very-secret');
    await db.settings.put({ key: 'device-key', value: { fake: true }, updatedAt: 1 });
    await db.settings.put({ key: 'onboarding', value: { seen: true }, updatedAt: 2 });

    const settings = { ...DEFAULT_SETTINGS, userName: 'Sam' };
    const backup = await exportAllData(db, settings, () => new Date('2026-09-09T10:00:00Z'));

    expect(backup.format).toBe('nivik-backup');
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBe('2026-09-09T10:00:00.000Z');
    expect(backup.settings.userName).toBe('Sam');
    expect(Object.keys(backup.tables).sort()).toEqual([
      'changeSets',
      'diagrams',
      'providers',
      'runs',
      'settings',
      'sources',
      'templates',
      'versions',
    ]);
    expect(backup.tables.diagrams).toHaveLength(1);
    expect(backup.tables.versions).toHaveLength(1);
    expect(backup.tables.settings).toEqual([
      { key: 'onboarding', value: { seen: true }, updatedAt: 2 },
    ]);
    expect('secrets' in backup.tables).toBe(false);
    expect(JSON.stringify(backup)).not.toContain('very-secret');
  });

  it('names the file after the day', () => {
    expect(backupFilename(new Date(2026, 8, 9))).toBe('nivik-backup-2026-09-09.json');
  });
});

describe('clearLocalData (spec 06 §6.2)', () => {
  it('empties every table including secrets, removes only nivik.* storage keys, clears keys, reloads', async () => {
    const db = freshDb();
    const repo = new DiagramRepository(db);
    await repo.create(createDiagram({ id: 'd_clear0001', name: 'A', type: 'flow', now: 1 }));
    await db.secrets.put({
      providerId: 'p1',
      cipher: new ArrayBuffer(4),
      iv: new Uint8Array(12),
      createdAt: 1,
    });
    const storage = memoryStorage({
      'nivik.settings.v2': '{}',
      'nivik.template-favorites.v1': '[]',
      'other-app': 'keep',
    });
    const clearKeys = vi.fn();
    const reload = vi.fn();

    await clearLocalData({ db, storage, clearKeys, reload });

    for (const table of db.tables) expect(await table.count(), table.name).toBe(0);
    expect(Array.from(storage.map.keys())).toEqual(['other-app']);
    expect(clearKeys).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('copes without a localStorage', async () => {
    const db = freshDb();
    const reload = vi.fn();
    await clearLocalData({ db, storage: null, clearKeys: () => {}, reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
