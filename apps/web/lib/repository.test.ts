import 'fake-indexeddb/auto';
import { createDiagram } from '@nivik/ir';
import { DiagramRepository, NivikDB } from '@nivik/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { getRepository, openDiagram, setRepository } from './repository';

const id = () => `d_${Math.random().toString(36).slice(2, 10)}`;

describe('openDiagram', () => {
  let repo: DiagramRepository;

  beforeEach(() => {
    repo = new DiagramRepository(new NivikDB(`test-${id()}`), { now: () => 1_000 });
  });

  it('creates an empty generic diagram under the route id when nothing is stored', async () => {
    const diagramId = id();
    const record = await openDiagram(repo, diagramId, { name: 'Untitled' });
    expect(record.id).toBe(diagramId);
    expect(record.name).toBe('Untitled');
    expect(record.ir.type).toBe('generic');
    expect(record.ir.nodes).toEqual([]);
    expect(record.ir.version).toBe(1);
    expect(await repo.get(diagramId)).toBeDefined();
  });

  it('resolves two concurrent opens of a new id to the same record', async () => {
    const diagramId = id();
    const [a, b] = await Promise.all([
      openDiagram(repo, diagramId, { name: 'First' }),
      openDiagram(repo, diagramId, { name: 'Second' }),
    ]);
    expect(a.id).toBe(diagramId);
    expect(b.id).toBe(diagramId);
    expect(a.ir).toEqual(b.ir);
    expect((await repo.list()).filter((d) => d.id === diagramId)).toHaveLength(1);
  });

  it('reopens an existing diagram without touching its IR', async () => {
    const ir = createDiagram({ id: id(), name: 'Kept', type: 'flow' });
    await repo.create(ir);
    const record = await openDiagram(repo, ir.id, { name: 'Ignored' });
    expect(record.ir).toEqual(ir);
    expect(record.name).toBe('Kept');
    expect(record.lastOpenedAt).toBeGreaterThan(0);
  });
});

describe('getRepository', () => {
  it('hands out one instance and lets tests inject their own', () => {
    const injected = new DiagramRepository(new NivikDB(`test-${id()}`));
    setRepository(injected);
    expect(getRepository()).toBe(injected);
    setRepository(null);
    const fresh = getRepository();
    expect(fresh).not.toBe(injected);
    expect(getRepository()).toBe(fresh);
    setRepository(null);
  });
});
