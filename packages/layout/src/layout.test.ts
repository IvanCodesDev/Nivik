import { type Diagram, type Rect, rectOf, validateDiagram } from '@nivik/ir';
import { orderPlatform, orderPlatformLaidOut } from '@nivik/ir/testing';
import type { ElkNode } from 'elkjs/lib/elk-api';
import { describe, expect, it } from 'vitest';
import { createBundledEngine } from './elk/engine';
import { layoutDiagram } from './layout';
import { DefaultMeasurer } from './measure';
import { checkout, randomDag, swot } from './testing';
import type { ElkEngine, LayoutOptions } from './types';

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
};
const full = (d: Diagram, extra: Partial<LayoutOptions> = {}) =>
  layoutDiagram(d, { mode: { kind: 'full' }, measurer: DefaultMeasurer, ...extra });
const rect = (d: Diagram, id: string): Rect =>
  must(rectOf(must([...d.nodes, ...d.groups].find((element) => element.id === id))));
const codes = (d: Diagram) => validateDiagram(d).warnings.map((w) => w.code);
const allPlaced = (d: Diagram) =>
  d.nodes.every((n) => n.position && n.size) && d.groups.every((g) => g.position && g.size);

describe('layoutDiagram · layered full (spec 03 §5, §10)', () => {
  it('places the order platform without overlaps or group escapes', async () => {
    const { diagram: out, moved, routed, warnings } = await full(orderPlatform());
    expect(warnings).toEqual([]);
    expect(allPlaced(out)).toBe(true);
    expect(out.edges.every((e) => (e.route?.points.length ?? 0) >= 2)).toBe(true);
    expect(codes(out)).not.toContain('W_OVERLAP');
    expect(codes(out)).not.toContain('W_GROUP_ESCAPE');
    expect(moved).toHaveLength(11);
    expect(routed).toHaveLength(10);
    expect(rect(out, 'web').x).toBeLessThan(rect(out, 'gw').x);
  });

  it('is deterministic and leaves version/meta untouched', async () => {
    const a = await full(orderPlatform());
    const b = await full(orderPlatform());
    expect(b.diagram).toEqual(a.diagram);
    expect(a.diagram.version).toBe(12);
    expect(a.diagram.nodes[0]?.meta).toEqual(orderPlatform().nodes[0]?.meta);
  });

  it('honours direction and spec overrides', async () => {
    const base = orderPlatform();
    const down = await full({ ...base, layout: { ...base.layout, direction: 'DOWN' } });
    expect(rect(down.diagram, 'web').y).toBeLessThan(rect(down.diagram, 'gw').y);
    const straight = await full(base, { spec: { edgeRouting: 'straight' } });
    expect(straight.diagram.edges.every((e) => e.route?.points.length === 2)).toBe(true);
  });

  it('treats incremental requests as a full pass until task 1.2', async () => {
    const r = await layoutDiagram(orderPlatform(), {
      mode: { kind: 'incremental', affected: ['web'], hints: {} },
      measurer: DefaultMeasurer,
    });
    expect(allPlaced(r.diagram)).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});

describe('engine injection and fallback (spec 03 §5.4)', () => {
  it('falls back to the BFS grid when ELK exceeds the budget', async () => {
    const hanging: ElkEngine = { layout: () => new Promise<ElkNode>(() => {}) };
    const r = await full(orderPlatform(), { engine: hanging, timeoutMs: 20 });
    expect(r.warnings.map((w) => w.code)).toEqual(['W_LAYOUT_FALLBACK']);
    expect(allPlaced(r.diagram)).toBe(true);
    expect(codes(r.diagram)).not.toContain('W_GROUP_ESCAPE');
  });

  it('falls back when the engine throws and says why', async () => {
    const broken: ElkEngine = { layout: () => Promise.reject(new Error('boom')) };
    const r = await full(orderPlatform(), { engine: broken });
    expect(r.warnings[0]).toMatchObject({ code: 'W_LAYOUT_FALLBACK' });
    expect(r.warnings[0]?.message).toContain('boom');
    expect(allPlaced(r.diagram)).toBe(true);
  });

  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(full(orderPlatform(), { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('hands the injected engine the ELK graph', async () => {
    const seen: ElkNode[] = [];
    const spy: ElkEngine = {
      layout: async (graph) => {
        seen.push(graph);
        return (await createBundledEngine()).layout(graph);
      },
    };
    await full(orderPlatform(), { engine: spy });
    expect(seen[0]?.layoutOptions?.['elk.algorithm']).toBe('layered');
    expect(seen[0]?.children).toHaveLength(7);
  });
});

describe('other algorithms through the dispatcher', () => {
  it('radial falls back to layered with W_LAYOUT_FALLBACK (task 1.1 scope)', async () => {
    const base = orderPlatform();
    const r = await full({
      ...base,
      type: 'mindmap',
      layout: { ...base.layout, algorithm: 'radial' },
    });
    expect(r.warnings[0]).toMatchObject({ code: 'W_LAYOUT_FALLBACK' });
    expect(r.warnings[0]?.message).toContain('radial');
    expect(allPlaced(r.diagram)).toBe(true);
  });

  it('dispatches grid and sequence by layout.algorithm', async () => {
    const g = await full(swot());
    expect(rect(g.diagram, 's')).toMatchObject({ x: 0, y: 0 });
    const s = await full(checkout());
    expect(rect(s.diagram, 'api').x).toBe(260);
  });

  it('manual only measures and reports unplaced nodes', async () => {
    const base = orderPlatformLaidOut();
    const d: Diagram = {
      ...base,
      layout: { ...base.layout, algorithm: 'manual' },
      nodes: base.nodes.map((n) => {
        if (n.id !== 'stripe') return n;
        const { position: _unplaced, ...rest } = n;
        return rest;
      }),
    };
    const r = await full(d);
    expect(r.warnings).toEqual([
      { code: 'W_UNPLACED', ids: ['stripe'], message: expect.any(String) },
    ]);
    expect(rect(r.diagram, 'web')).toEqual({ x: 40, y: 40, w: 120, h: 56 });
    expect(r.diagram.nodes.find((n) => n.id === 'stripe')?.position).toBeUndefined();
    expect(r.routed).toEqual([]);
  });

  it('measure-only re-measures the given ids and keeps everything else', async () => {
    const d = orderPlatformLaidOut();
    const r = await layoutDiagram(d, {
      mode: { kind: 'measure-only', ids: ['web'] },
      measurer: DefaultMeasurer,
    });
    expect(r.moved).toEqual(['web']);
    expect(rect(r.diagram, 'web')).toEqual({ x: 40, y: 40, w: 120, h: 56 });
    expect(rect(r.diagram, 'gw')).toEqual(rect(d, 'gw'));
    expect(r.routed).toEqual([]);
  });
});

describe('performance (spec 03 §10: 200 nodes / 300 edges ≤ 300 ms, CI 2×)', () => {
  it('lays out a 200/300 DAG within 600 ms after warm-up', async () => {
    await full(randomDag(10, 12, 1));
    const r = await full(randomDag(200, 300, 7));
    expect(allPlaced(r.diagram)).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.durationMs).toBeLessThan(600);
  }, 20_000);
});
