import 'fake-indexeddb/auto';
import { createDiagram } from '@nivik/ir';
import { orderPlatformLaidOut } from '@nivik/ir/testing';
import { DiagramRepository, NivikDB } from '@nivik/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteDiagram,
  duplicateStoredDiagram,
  LibraryActionError,
  MAX_DIAGRAM_NAME,
  normalizeDiagramName,
  renameDiagram,
  setFavorite,
} from './library-actions';

let counter = 0;
let repo: DiagramRepository;

beforeEach(() => {
  repo = new DiagramRepository(new NivikDB(`library-actions-${++counter}`));
});

describe('renameDiagram (spec 06 §3 one write path)', () => {
  it('writes a user setDiagram change set and keeps the record index in sync', async () => {
    await repo.create(createDiagram({ id: 'd_ren000001', name: 'Draft', type: 'flow', now: 1 }));
    const record = await renameDiagram(repo, 'd_ren000001', '  Checkout   flow  ', () => 5);

    expect(record.name).toBe('Checkout flow');
    expect(record.ir.name).toBe('Checkout flow');
    expect(record.version).toBe(2);
    const changeSets = await repo.db.changeSets.where('diagramId').equals('d_ren000001').toArray();
    expect(changeSets).toHaveLength(1);
    expect(changeSets[0]).toMatchObject({
      origin: 'user',
      baseVersion: 1,
      resultVersion: 2,
      createdAt: 5,
      actions: [{ op: 'setDiagram', patch: { name: 'Checkout flow' } }],
    });
    expect(changeSets[0]?.inverse.actions).toEqual([
      { op: 'setDiagram', patch: { name: 'Draft' } },
    ]);
  });

  it('is a no-op for the same name and refuses an empty one', async () => {
    await repo.create(createDiagram({ id: 'd_ren000002', name: 'Same', type: 'flow', now: 1 }));
    const unchanged = await renameDiagram(repo, 'd_ren000002', ' Same ');
    expect(unchanged.version).toBe(1);
    expect(await repo.db.changeSets.count()).toBe(0);
    await expect(renameDiagram(repo, 'd_ren000002', '   ')).rejects.toBeInstanceOf(
      LibraryActionError,
    );
    await expect(renameDiagram(repo, 'd_missing00', 'x')).rejects.toThrow(/not found/);
  });

  it('bounds the name like the IR does', () => {
    expect(normalizeDiagramName(`${'a'.repeat(200)}`)).toHaveLength(MAX_DIAGRAM_NAME);
    expect(normalizeDiagramName('  two\n\nlines ')).toBe('two lines');
  });
});

describe('duplicateStoredDiagram', () => {
  it('creates an independent copy with its own import snapshot and the source tags', async () => {
    const source = orderPlatformLaidOut();
    await repo.create(source, { tags: ['ops'], favorite: true });
    await renameDiagram(repo, source.id, 'Order platform v2');

    const copy = await duplicateStoredDiagram(
      repo,
      source.id,
      'Copy of Order platform v2',
      () => 77,
    );

    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe('Copy of Order platform v2');
    expect(copy.version).toBe(1);
    expect(copy.favorite).toBe(false);
    expect(copy.tags).toEqual(['ops']);
    expect(copy.ir.nodes).toEqual((await repo.require(source.id)).ir.nodes);
    expect(copy.ir.meta).toEqual({ createdAt: 77, updatedAt: 77 });

    const versions = await repo.listVersions(copy.id);
    expect(versions.map((v) => [v.version, v.reason])).toEqual([[1, 'import']]);
    expect((await repo.list()).map((d) => d.id).sort()).toEqual([copy.id, source.id].sort());
  });
});

describe('setFavorite / deleteDiagram', () => {
  it('toggles the favourite flag and deletes everything belonging to a diagram', async () => {
    const source = orderPlatformLaidOut();
    await repo.create(source);
    expect((await setFavorite(repo, source.id, true)).favorite).toBe(true);
    expect((await setFavorite(repo, source.id, false)).favorite).toBe(false);

    await renameDiagram(repo, source.id, 'Gone soon');
    await deleteDiagram(repo, source.id);
    expect(await repo.get(source.id)).toBeUndefined();
    expect(await repo.db.versions.where('diagramId').equals(source.id).count()).toBe(0);
    expect(await repo.db.changeSets.where('diagramId').equals(source.id).count()).toBe(0);
  });
});
