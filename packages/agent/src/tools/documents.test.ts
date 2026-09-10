import { AgentActionSchema, createDiagram } from '@nivik/ir';
import { orderPlatformLaidOut } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createDocuments } from './documents';
import { converge } from './finish';
import { describe as describeElements, findElements } from './read';
import { chunkSource, readSource, searchSources } from './sources';

const opts = { now: () => 1_000, runId: 'run_test0001' };

/** Actions as the model writes them (defaults not yet applied), parsed like the tool layer does. */
const acts = (...actions: z.input<typeof AgentActionSchema>[]) =>
  actions.map((a) => AgentActionSchema.parse(a));

describe('Documents.applyActions (spec 05 §4.1–4.2)', () => {
  it('applies in order, explains every rejection with a hint and shows the touched neighbourhood', () => {
    const docs = createDocuments(orderPlatformLaidOut(), opts);
    const existing = docs.current().staging.nodes[0];
    if (!existing) throw new Error('fixture');

    const { result, outcomes } = docs.applyActions(
      acts(
        { op: 'addNode', node: { id: 'payments', type: 'rounded', label: 'Payments' } },
        {
          op: 'addEdge',
          edge: { id: 'e-pay', type: 'flow', source: existing.id, target: 'paymnts' },
        },
        { op: 'addNode', node: { id: existing.id, type: 'box', label: 'Duplicate' } },
        {
          op: 'addEdge',
          edge: { id: 'e-ok', type: 'flow', source: existing.id, target: 'payments' },
        },
      ),
    );

    expect(result.accepted).toBe(2);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false, false, true]);
    expect(result.rejected.map((r) => [r.index, r.code])).toEqual([
      [1, 'E_UNKNOWN_REF'],
      [2, 'E_ID_COLLISION'],
    ]);
    expect(result.rejected[0]?.hint).toContain('payments');
    expect(result.rejected[1]?.hint).toContain(existing.id);
    expect(result.readout).toContain('payments');
    expect(result.totals.nodes).toBe(orderPlatformLaidOut().nodes.length + 1);
    expect(docs.current().accepted).toHaveLength(2);
    expect(docs.changed().map((d) => d.id)).toEqual([orderPlatformLaidOut().id]);
  });

  it('reports only the warnings a batch introduces', () => {
    const docs = createDocuments(orderPlatformLaidOut(), opts);
    const first = docs.applyActions(
      acts({ op: 'addNode', node: { id: 'lonely', type: 'box', label: 'Lonely' } }),
    ).result;
    expect(first.warnings.map((w) => w.code)).toContain('W_ORPHAN_NODE');
    const second = docs.applyActions(
      acts({ op: 'updateNode', id: 'lonely', patch: { label: 'Still lonely' } }),
    ).result;
    expect(second.warnings).toEqual([]);
    expect(second.readout).toContain('Still lonely');
  });

  it('notes missing cells under the grid strategy and returns no readout when nothing stuck', () => {
    const grid = createDiagram({ name: 'Board', type: 'kanban', now: 1 });
    grid.layout = { ...grid.layout, algorithm: 'grid' };
    const docs = createDocuments(grid, opts);
    const { result } = docs.applyActions(
      acts({ op: 'addNode', node: { id: 'todo', type: 'box', label: 'Todo' } }),
    );
    expect(result.layoutNote).toContain('todo');
    const nothing = docs.applyActions(acts({ op: 'deleteNode', id: 'ghost' })).result;
    expect(nothing.accepted).toBe(0);
    expect(nothing.readout).toBeNull();
    expect(nothing.rejected[0]?.hint).toMatch(/Readout|add/);
  });

  it('creates and switches documents; each converges into its own change set', () => {
    const initial = orderPlatformLaidOut();
    const docs = createDocuments(initial, { ...opts, newDiagramId: () => 'd_created01' });
    const created = docs.create({
      name: 'Payments',
      type: 'sequence',
      layout: { algorithm: 'sequence' },
    });
    expect(created).toEqual({ id: 'd_created01', name: 'Payments', type: 'sequence' });
    expect(docs.current().id).toBe('d_created01');
    expect(docs.current().staging.layout.algorithm).toBe('sequence');
    const side = docs.applyActions(
      acts(
        {
          op: 'addNode',
          node: { id: 'shop', type: 'participant', label: 'Shop', data: { kind: 'actor' } },
        },
        {
          op: 'addNode',
          node: { id: 'psp', type: 'participant', label: 'PSP', data: { kind: 'actor' } },
        },
        {
          op: 'addEdge',
          edge: {
            id: 'm1',
            type: 'message',
            source: 'shop',
            target: 'psp',
            label: 'charge',
            data: { kind: 'sync', order: 1 },
          },
        },
      ),
    ).result;
    expect(side.accepted).toBe(3);
    docs.switchTo(initial.id);
    docs.applyActions(acts({ op: 'setDiagram', patch: { description: 'Now with payments' } }));

    const plan = {
      intent: 'edit' as const,
      diagramType: 'c4' as const,
      scope: { kind: 'all' as const },
      summary: 'Split payments out',
      steps: [],
      layout: { algorithm: 'layered' as const, direction: 'RIGHT' as const },
      estimatedNodes: 10,
    };
    const { documents, outcome } = converge(
      docs,
      plan,
      'Split payments into a sequence diagram',
      opts,
    );
    expect(outcome).toBe('finished');
    expect(documents.map((d) => d.doc.id).sort()).toEqual(['d_created01', initial.id].sort());
    const main = documents.find((d) => d.doc.id === initial.id);
    expect(main?.changeSet.baseVersion).toBe(initial.version);
    expect(main?.changeSet.actions[0]).toMatchObject({ op: 'setDiagram', patch: { type: 'c4' } });
    expect(main?.changeSet.actions).toHaveLength(2);
    const created2 = documents.find((d) => d.doc.id === 'd_created01');
    expect(created2?.changeSet).toMatchObject({
      baseVersion: 1,
      origin: 'ai',
      runId: 'run_test0001',
    });
    expect(created2?.changeSet.actions).toHaveLength(3);
    expect(created2?.changeSet.actions.some((a) => a.op === 'setDiagram')).toBe(false);
  });

  it('converges to no-changes when nothing was accepted anywhere', () => {
    const docs = createDocuments(orderPlatformLaidOut(), opts);
    docs.applyActions(acts({ op: 'deleteNode', id: 'ghost' }));
    expect(converge(docs, null, 'Nothing to do', opts)).toEqual({
      documents: [],
      outcome: 'no-changes',
    });
  });
});

describe('read tools', () => {
  it('finds elements by any word across id, label, role and type', () => {
    const d = orderPlatformLaidOut();
    const byLabel = findElements(d, { query: d.nodes[0]?.label ?? '' });
    expect(byLabel[0]?.id).toBe(d.nodes[0]?.id);
    expect(findElements(d, { query: 'zzz-nothing' })).toEqual([]);
    const edges = findElements(d, { query: d.edges[0]?.source ?? '', kinds: ['edge'] });
    expect(edges.every((e) => e.kind === 'edge')).toBe(true);
    expect(findElements(d, { query: 'a', limit: 2 }).length).toBeLessThanOrEqual(2);
  });

  it('describes known ids and lists the unknown ones', () => {
    const d = orderPlatformLaidOut();
    const ids = d.nodes.slice(0, 2).map((n) => n.id);
    const out = describeElements(d, { ids: [...ids, 'nope'], hops: 0 });
    expect(out.missing).toEqual(['nope']);
    for (const id of ids) expect(out.readout).toContain(id);
    expect(describeElements(d, { ids: ['nope'] })).toEqual({ readout: '', missing: ['nope'] });
  });
});

describe('source tools', () => {
  const sources = [
    {
      id: 'src1',
      kind: 'doc' as const,
      title: 'Design notes',
      text: `${'The checkout service talks to the payment provider over HTTPS.\n\n'.repeat(3)}Inventory is a separate bounded context.\n\nThe warehouse syncs nightly.`,
    },
    { id: 'src2', kind: 'text' as const, title: 'Chat', text: 'Payments must retry three times.' },
  ];

  it('chunks by paragraphs, ranks by BM25 and reads passages back', () => {
    expect(chunkSource(sources[0] as (typeof sources)[0]).length).toBeGreaterThanOrEqual(1);
    const hits = searchSources(sources, 'payment retry', 3);
    expect(hits[0]?.sourceId).toBe('src2');
    expect(searchSources(sources, 'warehouse')[0]?.text).toContain('warehouse');
    expect(searchSources(sources, '')).toEqual([]);
    const passage = readSource(sources, { sourceId: 'src1', from: 0, to: 0 });
    expect(passage?.title).toBe('Design notes');
    expect(passage?.text.length).toBeGreaterThan(0);
    expect(readSource(sources, { sourceId: 'missing' })).toBeNull();
  });
});
