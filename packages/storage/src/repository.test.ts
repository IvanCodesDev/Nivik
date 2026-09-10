import 'fake-indexeddb/auto';
import {
  applyChangeSet,
  type ChangeSet,
  createDiagram,
  type Diagram,
  diffDiagrams,
  newChangeSetId,
} from '@nivik/ir';
import { orderPlatformLaidOut, randomChangeSets } from '@nivik/ir/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { NivikDB } from './db';
import type { StoragePolicy } from './policy';
import type { SessionTurnRecord } from './records';
import { DiagramRepository, StorageError } from './repository';

const T0 = 1_800_000_000_000;
const MIN = 60_000;

let dbCounter = 0;
const open: NivikDB[] = [];

function setup(opts: { policy?: Partial<StoragePolicy>; now?: () => number } = {}) {
  dbCounter += 1;
  const db = new NivikDB(`nivik-test-${dbCounter}`);
  open.push(db);
  let clock = T0;
  const now = opts.now ?? (() => clock);
  const repo = new DiagramRepository(db, { now, policy: opts.policy });
  return { db, repo, tick: (ms: number) => (clock += ms) };
}

afterEach(async () => {
  for (const db of open.splice(0)) await db.delete();
});

/** A user change set that adds one node and wires it to the last node. */
function addStep(d: Diagram, label: string, origin: ChangeSet['origin'] = 'user'): ChangeSet {
  const previous = d.nodes.at(-1)?.id ?? null;
  const id = `n_${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
  return {
    id: newChangeSetId(),
    diagramId: d.id,
    baseVersion: d.version,
    origin,
    ...(origin === 'ai' ? { runId: 'run_test' } : {}),
    actions: [
      { op: 'addNode', node: { id, type: 'rounded', label, parent: null } },
      ...(previous
        ? [
            {
              op: 'addEdge' as const,
              edge: {
                id: `e_${id}`,
                source: previous,
                target: id,
                type: 'flow' as const,
                direction: 'forward' as const,
                sourceSide: 'auto' as const,
                targetSide: 'auto' as const,
              },
            },
          ]
        : []),
    ],
    createdAt: d.meta.updatedAt + 1,
  };
}

const normalize = (d: Diagram) => ({
  nodes: [...d.nodes].map(({ meta: _m, ...n }) => n).sort((a, b) => a.id.localeCompare(b.id)),
  edges: [...d.edges]
    .map(({ meta: _m, route: _r, ...e }) => e)
    .sort((a, b) => a.id.localeCompare(b.id)),
  groups: [...d.groups].map(({ meta: _m, ...g }) => g).sort((a, b) => a.id.localeCompare(b.id)),
});

describe('create / get / list / remove', () => {
  it('stores the diagram with an import snapshot and redundant index fields', async () => {
    const { repo, db } = setup();
    const ir = createDiagram({ name: 'Login', type: 'flow', id: 'd_login0001', now: T0 });
    const record = await repo.create(ir, { tags: ['auth'] });
    expect(record).toMatchObject({
      id: 'd_login0001',
      name: 'Login',
      type: 'flow',
      version: 1,
      favorite: false,
      tags: ['auth'],
      createdAt: T0,
      updatedAt: T0,
    });
    expect(record.ir).toEqual(ir);
    expect(await repo.get('d_login0001')).toEqual(record);
    expect(await db.versions.toArray()).toEqual([
      {
        id: 'd_login0001@1',
        diagramId: 'd_login0001',
        version: 1,
        ir,
        reason: 'import',
        createdAt: T0,
      },
    ]);
  });

  it('refuses to create the same diagram twice', async () => {
    const { repo } = setup();
    const ir = createDiagram({ name: 'Dup', type: 'flow', id: 'd_dup000001', now: T0 });
    await repo.create(ir);
    await expect(repo.create(ir)).rejects.toMatchObject({ code: 'E_DIAGRAM_EXISTS' });
  });

  it('lists summaries newest-first without the IR payload', async () => {
    const { repo, tick } = setup();
    await repo.create(createDiagram({ name: 'A', type: 'flow', id: 'd_a00000001', now: T0 }));
    tick(1000);
    await repo.create(createDiagram({ name: 'B', type: 'erd', id: 'd_b00000001', now: T0 }));
    const list = await repo.list();
    expect(list.map((d) => d.name)).toEqual(['B', 'A']);
    expect(list[0]).not.toHaveProperty('ir');
    expect(list[0]).toMatchObject({ id: 'd_b00000001', type: 'erd', version: 1 });
  });

  it('removes a diagram together with its history', async () => {
    const { repo, db } = setup();
    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    const r = await repo.applyAndPersist(ir.id, addStep(ir, 'Audit'));
    expect(r.ok).toBe(true);
    await repo.remove(ir.id);
    expect(await repo.get(ir.id)).toBeUndefined();
    expect(await db.versions.count()).toBe(0);
    expect(await db.changeSets.count()).toBe(0);
  });

  it('updates favorite/tags without a new version and tracks last opened', async () => {
    const { repo, db, tick } = setup();
    const ir = createDiagram({ name: 'Meta', type: 'flow', id: 'd_meta00001', now: T0 });
    await repo.create(ir);
    tick(5000);
    const updated = await repo.update(ir.id, {
      favorite: true,
      tags: ['x'],
      lastOpenedAt: T0 + 5000,
    });
    expect(updated).toMatchObject({
      favorite: true,
      tags: ['x'],
      lastOpenedAt: T0 + 5000,
      version: 1,
    });
    expect(updated.updatedAt).toBe(T0 + 5000);
    expect(await db.versions.count()).toBe(1);
    expect(await db.changeSets.count()).toBe(0);
  });

  it('throws a typed error for unknown diagrams', async () => {
    const { repo } = setup();
    const ir = createDiagram({ name: 'Ghost', type: 'flow', id: 'd_ghost0001', now: T0 });
    await expect(repo.applyAndPersist(ir.id, addStep(ir, 'x'))).rejects.toBeInstanceOf(
      StorageError,
    );
    await expect(repo.update(ir.id, { favorite: true })).rejects.toMatchObject({
      code: 'E_DIAGRAM_NOT_FOUND',
    });
  });
});

describe('applyAndPersist (spec 06 §3.2)', () => {
  it('applies, stores the new IR, and records the change set with inverse and affected ids', async () => {
    const { repo, db, tick } = setup();
    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    tick(1000);
    const cs = addStep(ir, 'Audit Log');
    const r = await repo.applyAndPersist(ir.id, cs);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.record.version).toBe(ir.version + 1);
    expect(r.record.ir).toEqual(r.diagram);
    expect(r.record.updatedAt).toBe(T0 + 1000);
    expect(r.diagram.nodes.at(-1)?.label).toBe('Audit Log');
    expect(r.snapshot).toBeNull();

    const stored = await db.changeSets.get(cs.id);
    expect(stored).toEqual({
      ...cs,
      resultVersion: ir.version + 1,
      inverse: r.inverse,
      affected: r.affected,
    });
    expect(stored?.affected.added).toEqual(['n_audit-log', 'e_n_audit-log']);
    expect(await db.versions.count()).toBe(1);
  });

  it('returns the apply failure and writes nothing', async () => {
    const { repo, db } = setup();
    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    const stale = { ...addStep(ir, 'Stale'), baseVersion: ir.version + 5 };
    const r = await repo.applyAndPersist(ir.id, stale);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unexpected success');
    expect(r.error.code).toBe('E_BASE_VERSION_MISMATCH');
    expect((await repo.get(ir.id))?.version).toBe(ir.version);
    expect(await db.changeSets.count()).toBe(0);
  });

  it('rolls the diagram back when the change set row cannot be written', async () => {
    const { repo, db } = setup();
    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    const boom = () => {
      throw new Error('disk full');
    };
    db.changeSets.hook('creating', boom);
    try {
      await expect(repo.applyAndPersist(ir.id, addStep(ir, 'Lost'))).rejects.toThrow();
    } finally {
      db.changeSets.hook('creating').unsubscribe(boom);
    }
    const after = await repo.get(ir.id);
    expect(after?.version).toBe(ir.version);
    expect(after?.ir).toEqual(ir);
    expect(await db.changeSets.count()).toBe(0);
  });

  it('never loses an update when two writers race from the same version', async () => {
    const { repo, db } = setup();
    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    const [a, b] = await Promise.all([
      repo.applyAndPersist(ir.id, addStep(ir, 'Racer A')),
      repo.applyAndPersist(ir.id, addStep(ir, 'Racer B')),
    ]);
    const outcomes = [a.ok, b.ok].sort();
    expect(outcomes).toEqual([false, true]);
    const loser = a.ok ? b : a;
    if (loser.ok) throw new Error('unexpected');
    expect(loser.error.code).toBe('E_BASE_VERSION_MISMATCH');
    const record = await repo.get(ir.id);
    expect(record?.version).toBe(ir.version + 1);
    expect(await db.changeSets.count()).toBe(1);
    expect(await repo.replay(ir.id, ir.version)).toEqual(record?.ir);
  });

  it('keeps a linear history: consecutive change sets chain versions', async () => {
    const { repo, db } = setup();
    let ir = orderPlatformLaidOut();
    await repo.create(ir);
    for (const label of ['One', 'Two', 'Three']) {
      const r = await repo.applyAndPersist(ir.id, addStep(ir, label));
      if (!r.ok) throw new Error(r.error.message);
      ir = r.diagram;
    }
    const rows = await repo.listChangeSets(ir.id);
    expect(rows.map((c) => [c.baseVersion, c.resultVersion])).toEqual([
      [12, 13],
      [13, 14],
      [14, 15],
    ]);
    expect(await db.diagrams.get(ir.id)).toMatchObject({ version: 15 });
  });
});

describe('snapshots (spec 06 §3.3)', () => {
  it('takes an explicit snapshot (ai-run) in the same write', async () => {
    const { repo } = setup();
    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    const r = await repo.applyAndPersist(ir.id, addStep(ir, 'AI', 'ai'), {
      snapshot: 'ai-run',
      runId: 'run_test',
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.snapshot).toMatchObject({
      version: 13,
      reason: 'ai-run',
      runId: 'run_test',
      ir: r.diagram,
    });
    expect((await repo.listVersions(ir.id)).map((v) => [v.version, v.reason])).toEqual([
      [12, 'import'],
      [13, 'ai-run'],
    ]);
  });

  it('saves a manual version with a label and upgrades an existing snapshot at that version', async () => {
    const { repo } = setup();
    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    const v = await repo.saveVersion(ir.id, { reason: 'manual', label: 'Before refactor' });
    expect(v).toMatchObject({ version: 12, reason: 'manual', label: 'Before refactor' });
    expect(await repo.listVersions(ir.id)).toHaveLength(1);
    const again = await repo.saveVersion(ir.id, { reason: 'relayout' });
    expect(again.reason).toBe('manual');
  });

  it('auto-snapshots after 20 user change sets since the last snapshot', async () => {
    const { repo } = setup();
    let ir = orderPlatformLaidOut();
    await repo.create(ir);
    const reasons: string[] = [];
    for (let i = 1; i <= 21; i += 1) {
      const r = await repo.applyAndPersist(ir.id, addStep(ir, `S${i}`));
      if (!r.ok) throw new Error(r.error.message);
      ir = r.diagram;
      if (r.snapshot) reasons.push(`${r.snapshot.version}:${r.snapshot.reason}`);
    }
    expect(reasons).toEqual(['32:auto']);
  });

  it('does not count ai/system change sets toward the auto threshold', async () => {
    const { repo } = setup({ policy: { autoSnapshotEvery: 2 } });
    let ir = orderPlatformLaidOut();
    await repo.create(ir);
    const apply = async (label: string, origin: ChangeSet['origin']) => {
      const r = await repo.applyAndPersist(ir.id, addStep(ir, label, origin));
      if (!r.ok) throw new Error(r.error.message);
      ir = r.diagram;
      return r.snapshot?.reason ?? null;
    };
    expect(await apply('a', 'ai')).toBeNull();
    expect(await apply('b', 'system')).toBeNull();
    expect(await apply('c', 'user')).toBeNull();
    expect(await apply('d', 'user')).toBe('auto');
  });

  it('auto-snapshots when the last snapshot is 10 minutes old and something changed', async () => {
    const { repo, tick } = setup();
    let ir = orderPlatformLaidOut();
    await repo.create(ir);
    tick(9 * MIN);
    let r = await repo.applyAndPersist(ir.id, addStep(ir, 'Early'));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.snapshot).toBeNull();
    ir = r.diagram;
    tick(1 * MIN);
    r = await repo.applyAndPersist(ir.id, addStep(ir, 'Late'));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.snapshot).toMatchObject({ reason: 'auto', version: 14 });
  });
});

describe('replay invariant (spec 06 §3.1)', () => {
  it.each([1, 7, 20260906])(
    'replay(snapshot, change sets since) == current IR (seed %i)',
    async (seed) => {
      const { repo } = setup({ policy: { autoSnapshotEvery: 5 } });
      let ir = orderPlatformLaidOut();
      await repo.create(ir);
      const gen = randomChangeSets(seed);
      for (let i = 0; i < 40; i += 1) {
        const cs = gen.next(ir);
        const r = await repo.applyAndPersist(ir.id, cs);
        if (!r.ok) throw new Error(`step ${i}: ${r.error.code} ${r.error.message}`);
        ir = r.diagram;
      }
      const versions = await repo.listVersions(ir.id);
      expect(versions.length).toBeGreaterThan(1);
      for (const v of versions) {
        const replayed = await repo.replay(ir.id, v.version);
        expect(replayed).toEqual(ir);
      }
      const current = await repo.get(ir.id);
      expect(current?.ir).toEqual(ir);
    },
  );

  it('replays manually from the rows as well', async () => {
    const { repo } = setup();
    let ir = orderPlatformLaidOut();
    await repo.create(ir);
    for (const label of ['A', 'B']) {
      const r = await repo.applyAndPersist(ir.id, addStep(ir, label));
      if (!r.ok) throw new Error(r.error.message);
      ir = r.diagram;
    }
    const [base] = await repo.listVersions(ir.id);
    if (!base) throw new Error('no snapshot');
    let d = base.ir;
    for (const cs of await repo.listChangeSets(ir.id, { after: base.version })) {
      const r = applyChangeSet(d, cs);
      if (!r.ok) throw new Error(r.error.message);
      d = r.diagram;
    }
    expect(d).toEqual(ir);
  });
});

describe('pruning (spec 06 §3.3)', () => {
  it('keeps at most maxVersions snapshots, dropping auto ones first and never manual', async () => {
    const { repo, db } = setup({ policy: { maxVersions: 3, autoSnapshotEvery: 1 } });
    let ir = orderPlatformLaidOut();
    await repo.create(ir);
    await repo.saveVersion(ir.id, { reason: 'manual', label: 'keep me' });
    for (let i = 0; i < 6; i += 1) {
      const r = await repo.applyAndPersist(ir.id, addStep(ir, `P${i}`));
      if (!r.ok) throw new Error(r.error.message);
      ir = r.diagram;
    }
    const versions = await repo.listVersions(ir.id);
    expect(versions.map((v) => [v.version, v.reason])).toEqual([
      [12, 'manual'],
      [17, 'auto'],
      [18, 'auto'],
    ]);
    expect(await db.versions.count()).toBe(3);
  });

  it('keeps at most maxChangeSets rows but never those after the latest snapshot', async () => {
    const { repo } = setup({ policy: { maxChangeSets: 2 } });
    let ir = orderPlatformLaidOut();
    await repo.create(ir);
    for (let i = 0; i < 5; i += 1) {
      const r = await repo.applyAndPersist(ir.id, addStep(ir, `C${i}`));
      if (!r.ok) throw new Error(r.error.message);
      ir = r.diagram;
    }
    // Only the import snapshot (v12) exists, so every row (v13..v17) must survive.
    expect((await repo.listChangeSets(ir.id)).map((c) => c.resultVersion)).toEqual([
      13, 14, 15, 16, 17,
    ]);
    await repo.saveVersion(ir.id, { reason: 'manual' });
    const r = await repo.applyAndPersist(ir.id, addStep(ir, 'C5'));
    if (!r.ok) throw new Error(r.error.message);
    expect((await repo.listChangeSets(ir.id)).map((c) => c.resultVersion)).toEqual([17, 18]);
  });
});

describe('restore (spec 06 §3.3)', () => {
  it('brings the current IR back to a snapshot through a forward change set and snapshots it', async () => {
    const { repo } = setup();
    let ir = orderPlatformLaidOut();
    await repo.create(ir);
    const before = ir;
    for (const label of ['X', 'Y']) {
      const r = await repo.applyAndPersist(ir.id, addStep(ir, label));
      if (!r.ok) throw new Error(r.error.message);
      ir = r.diagram;
    }
    const r = await repo.restore(ir.id, 12);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.record.version).toBe(15);
    expect(normalize(r.record.ir)).toEqual(normalize(before));
    expect(r.snapshot).toMatchObject({ version: 15, reason: 'restore' });
    expect((await repo.listChangeSets(ir.id)).map((c) => c.resultVersion)).toEqual([13, 14, 15]);
    expect(diffDiagrams(r.record.ir, before, { origin: 'system' })).toBeNull();
  });

  it('is a no-op when the snapshot equals the current state', async () => {
    const { repo, db } = setup();
    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    const r = await repo.restore(ir.id, 12);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unexpected');
    expect(r.record.version).toBe(12);
    expect(await db.changeSets.count()).toBe(0);
  });

  it('rejects unknown versions', async () => {
    const { repo } = setup();
    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    await expect(repo.restore(ir.id, 99)).rejects.toMatchObject({ code: 'E_VERSION_NOT_FOUND' });
  });
});

describe('sessions (D14′ conversation memory)', () => {
  const turn = (i: number, over: Partial<SessionTurnRecord['agent']> = {}): SessionTurnRecord => ({
    runId: `run_${i}`,
    at: T0 + i * MIN,
    user: `Request number ${i}`,
    agent: {
      replies: [`Did thing ${i}`],
      questions: [],
      changes: [{ documentId: 'd_x', summary: `Change ${i}`, counts: {} }],
      outcome: 'finished',
      ...over,
    },
  });

  it('starts empty, appends turns and is removed with the diagram', async () => {
    const { repo, db } = setup();
    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    expect(await repo.getSession(ir.id)).toBeUndefined();

    const first = await repo.appendSessionTurn(ir.id, turn(1));
    expect(first).toMatchObject({ id: ir.id, diagramId: ir.id, summary: null, updatedAt: T0 });
    expect(first?.turns.map((t) => t.runId)).toEqual(['run_1']);
    await repo.appendSessionTurn(ir.id, turn(2));
    expect((await repo.getSession(ir.id))?.turns).toHaveLength(2);

    await repo.remove(ir.id);
    expect(await db.sessions.count()).toBe(0);
  });

  it('keeps the last N turns verbatim and folds the rest into a bounded summary', async () => {
    const { repo } = setup();
    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    for (let i = 1; i <= 8; i += 1) {
      await repo.appendSessionTurn(
        ir.id,
        turn(i, i === 3 ? { outcome: 'aborted', changes: [] } : {}),
        {
          keepTurns: 3,
        },
      );
    }
    const session = await repo.getSession(ir.id);
    expect(session?.turns.map((t) => t.runId)).toEqual(['run_6', 'run_7', 'run_8']);
    const lines = session?.summary?.split('\n') ?? [];
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('- "Request number 1" → changed: Change 1 — Did thing 1');
    expect(lines[2]).toBe('- "Request number 3" → aborted — Did thing 3');

    for (let i = 9; i <= 40; i += 1) {
      await repo.appendSessionTurn(ir.id, turn(i), { keepTurns: 3, maxSummaryChars: 300 });
    }
    const bounded = await repo.getSession(ir.id);
    expect(bounded?.summary?.length).toBeLessThanOrEqual(300);
    expect(bounded?.summary).toContain('Request number 37');
    expect(bounded?.summary).not.toContain('Request number 1"');
  });

  it('ignores turns for diagrams that no longer exist and can be cleared', async () => {
    const { repo, db } = setup();
    expect(await repo.appendSessionTurn('ghost', turn(1))).toBeUndefined();
    expect(await db.sessions.count()).toBe(0);

    const ir = orderPlatformLaidOut();
    await repo.create(ir);
    await repo.appendSessionTurn(ir.id, turn(1));
    await repo.clearSession(ir.id);
    expect(await repo.getSession(ir.id)).toBeUndefined();
    expect(await repo.get(ir.id)).toBeDefined();
  });
});
