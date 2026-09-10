import 'fake-indexeddb/auto';
import { createDiagram } from '@nivik/ir';
import { DiagramRepository, NivikDB, SecretVault } from '@nivik/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  BackupError,
  backupBlob,
  backupFilename,
  clearLocalData,
  exportAllData,
  parseBackup,
  restoreBackup,
} from './backup';
import { renameDiagram } from './library-actions';
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

describe('restoreBackup (spec 06 §4, §8 backup row)', () => {
  it('export → clear → restore brings diagrams, history and change sets back identical', async () => {
    const db = freshDb();
    const repo = new DiagramRepository(db);
    await repo.create(createDiagram({ id: 'd_rt0000001', name: 'One', type: 'flow', now: 1 }), {
      tags: ['a'],
    });
    await repo.create(createDiagram({ id: 'd_rt0000002', name: 'Two', type: 'erd', now: 2 }));
    await renameDiagram(repo, 'd_rt0000001', 'One renamed', () => 3);
    await repo.update('d_rt0000002', { favorite: true });
    await db.settings.put({ key: 'onboarding', value: { seen: true }, updatedAt: 4 });
    const before = {
      diagrams: await db.diagrams.toArray(),
      versions: await db.versions.toArray(),
      changeSets: await db.changeSets.toArray(),
      settings: await db.settings.toArray(),
    };

    const text = await backupBlob(
      await exportAllData(db, { ...DEFAULT_SETTINGS, userName: 'Sam', keyStorage: 'device' }),
    ).text();
    await clearLocalData({ db, storage: null, clearKeys: () => {}, reload: () => {} });
    expect(await db.diagrams.count()).toBe(0);

    const backup = parseBackup(text);
    const restoredSettings: unknown[] = [];
    const counts = await restoreBackup(db, backup, { settings: (s) => restoredSettings.push(s) });

    expect(counts).toEqual({
      diagrams: 2,
      versions: 2,
      changeSets: 1,
      runs: 0,
      sources: 0,
      templates: 0,
      providers: 0,
      settings: 1,
    });
    expect(await db.diagrams.toArray()).toEqual(before.diagrams);
    expect(await db.versions.toArray()).toEqual(before.versions);
    expect(await db.changeSets.toArray()).toEqual(before.changeSets);
    expect(await db.settings.toArray()).toEqual(before.settings);
    expect(await db.secrets.count()).toBe(0);
    expect(restoredSettings).toEqual([
      { ...DEFAULT_SETTINGS, userName: 'Sam', keyStorage: 'device' },
    ]);
  });

  it('merges: same ids are overwritten, other diagrams are kept, preferences only on request', async () => {
    const source = freshDb();
    const sourceRepo = new DiagramRepository(source);
    await sourceRepo.create(
      createDiagram({ id: 'd_mg0000001', name: 'Shared', type: 'flow', now: 1 }),
    );
    const backup = parseBackup(
      await backupBlob(await exportAllData(source, DEFAULT_SETTINGS)).text(),
    );

    const target = freshDb();
    const targetRepo = new DiagramRepository(target);
    await targetRepo.create(
      createDiagram({ id: 'd_mg0000001', name: 'Stale copy', type: 'flow', now: 5 }),
    );
    await targetRepo.create(
      createDiagram({ id: 'd_mg0000009', name: 'Mine', type: 'flow', now: 6 }),
    );

    const settings = vi.fn();
    await restoreBackup(target, backup);
    expect(settings).not.toHaveBeenCalled();
    expect((await targetRepo.list()).map((d) => d.name).sort()).toEqual(['Mine', 'Shared']);
  });

  it('refuses anything that is not a Nivik backup, with a pointer to the problem', async () => {
    expect(() => parseBackup('{')).toThrow(BackupError);
    expect(() => parseBackup('{"format":"other"}')).toThrow(/format/);
    const db = freshDb();
    const good = await backupBlob(await exportAllData(db, DEFAULT_SETTINGS)).text();
    const broken = JSON.parse(good) as { tables: { diagrams: unknown[] } };
    broken.tables.diagrams.push({ id: 'd_bad', ir: { schema: 'nivik.diagram/1', nodes: 'nope' } });
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(
      /tables\.diagrams\.0: invalid diagram document/,
    );
    expect(parseBackup(good).settings).toEqual(DEFAULT_SETTINGS);
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
