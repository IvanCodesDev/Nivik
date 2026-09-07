import {
  applyChangeSet,
  ChangeSetSchema,
  type Diagram,
  type Rect,
  rectContains,
  rectOf,
  rectsIntersect,
  validateDiagram,
} from '@nivik/ir';
import { diagram, edge, group, node, orderPlatform, specExampleChangeSet } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { layoutDiagram } from '../layout';
import { DefaultMeasurer } from '../measure';
import type { ElkEngine } from '../types';

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
};
const rect = (d: Diagram, id: string): Rect =>
  must(rectOf(must([...d.nodes, ...d.groups].find((e) => e.id === id))));
const full = (d: Diagram) =>
  layoutDiagram(d, { mode: { kind: 'full' }, measurer: DefaultMeasurer });
const incremental = (
  d: Diagram,
  affected: string[],
  hints: Record<string, string>,
  extra: { engine?: ElkEngine } = {},
) =>
  layoutDiagram(d, {
    mode: { kind: 'incremental', affected, hints },
    measurer: DefaultMeasurer,
    ...extra,
  });
const nodeIds = (d: Diagram, ids: readonly string[]) =>
  ids.filter((id) => d.nodes.some((n) => n.id === id));

/** Spec 02 §9 applied to the laid-out order platform: `order-events` is new, `pay` pinned and restyled. */
async function afterSpecExample() {
  const laid = (await full(orderPlatform())).diagram;
  const cs = ChangeSetSchema.parse({
    ...specExampleChangeSet(),
    diagramId: laid.id,
    baseVersion: laid.version,
  });
  const applied = applyChangeSet(laid, cs);
  if (!applied.ok) throw new Error(applied.error.message);
  const affected = [...applied.affected.added, ...applied.affected.modified];
  return {
    before: laid,
    next: applied.diagram,
    affected,
    hints: applied.layoutRequest?.hints ?? {},
  };
}

describe('layoutDiagram · incremental (spec 03 §6, §10)', () => {
  it('places only the new node; everything else, pinned included, keeps its pixels', async () => {
    const { before, next, affected, hints } = await afterSpecExample();
    const r = await incremental(next, affected, hints);
    expect(r.warnings).toEqual([]);
    expect(nodeIds(r.diagram, r.moved)).toEqual(['order-events']);
    for (const n of before.nodes) expect(rect(r.diagram, n.id)).toEqual(rect(before, n.id));
    const topic = rect(r.diagram, 'order-events');
    for (const n of r.diagram.nodes) {
      if (n.id !== 'order-events') expect(rectsIntersect(topic, rect(r.diagram, n.id))).toBe(false);
    }
    expect(rectContains(rect(r.diagram, 'svc'), topic)).toBe(true);
    expect(validateDiagram(r.diagram).warnings.map((w) => w.code)).not.toContain('W_GROUP_ESCAPE');
    expect(r.routed).toEqual(expect.arrayContaining(['e11', 'e12']));
    expect(r.routed).not.toContain('e1');
    expect(topic.x).toBeGreaterThan(rect(r.diagram, 'orders').x);
  });

  it('degrades to a full layout when nothing has coordinates yet', async () => {
    const fresh = orderPlatform();
    const a = await incremental(
      fresh,
      fresh.nodes.map((n) => n.id),
      {},
    );
    const b = await full(fresh);
    expect(a.diagram).toEqual(b.diagram);
  });

  it('falls back to the hint slot when the engine fails, still without overlaps', async () => {
    const { before, next, affected, hints } = await afterSpecExample();
    const broken: ElkEngine = { layout: () => Promise.reject(new Error('boom')) };
    const r = await incremental(next, affected, hints, { engine: broken });
    expect(r.warnings.map((w) => w.code)).toEqual(['W_LAYOUT_FALLBACK']);
    const topic = rect(r.diagram, 'order-events');
    for (const n of r.diagram.nodes) {
      if (n.id !== 'order-events') expect(rectsIntersect(topic, rect(r.diagram, n.id))).toBe(false);
    }
    for (const n of before.nodes) expect(rect(r.diagram, n.id)).toEqual(rect(before, n.id));
  });

  it('relocates a hinted existing node next to its hint (relayout.near)', async () => {
    const laid = (await full(orderPlatform())).diagram;
    const r = await incremental(laid, ['stripe'], { stripe: 'web' });
    const stripe = rect(r.diagram, 'stripe');
    const web = rect(r.diagram, 'web');
    // ELK seats the hinted node in the layer right after its hint; anchoring keeps it there.
    expect(stripe.x).toBeGreaterThan(web.x + web.w);
    expect(stripe.x).toBeLessThanOrEqual(web.x + web.w + 2 * 72);
    for (const n of r.diagram.nodes) {
      if (n.id !== 'stripe') expect(rectsIntersect(stripe, rect(r.diagram, n.id))).toBe(false);
    }
    expect(nodeIds(r.diagram, r.moved)).toEqual(['stripe']);
  });

  it('grows the group around a new member and shoves the overlapped sibling group, children included', async () => {
    const at = (x: number, y: number) => ({ position: { x, y }, size: { w: 120, h: 56 } });
    const d = diagram({
      groups: [
        group('top', 'Top', { position: { x: 0, y: 0 }, size: { w: 168, h: 128 } }),
        group('bottom', 'Bottom', { position: { x: 0, y: 168 }, size: { w: 168, h: 128 } }),
      ],
      nodes: [
        node('a', 'A', { parent: 'top', ...at(24, 48) }),
        node('n', 'N', { parent: 'top' }),
        node('b', 'B', { parent: 'bottom', ...at(24, 216) }),
      ],
      edges: [edge('e', 'a', 'n')],
    });
    const echo: ElkEngine = { layout: async (graph) => graph };
    const r = await incremental(
      { ...d, layout: { ...d.layout, direction: 'DOWN' } },
      ['n', 'e'],
      { n: 'a' },
      { engine: echo },
    );
    const top = rect(r.diagram, 'top');
    const n = rect(r.diagram, 'n');
    expect(rectContains(top, n)).toBe(true);
    const bottom = rect(r.diagram, 'bottom');
    expect(rectsIntersect(top, bottom)).toBe(false);
    expect(rectContains(bottom, rect(r.diagram, 'b'))).toBe(true);
    expect(r.moved).toEqual(expect.arrayContaining(['n', 'top', 'bottom', 'b']));
    expect(rect(r.diagram, 'a')).toEqual({ x: 24, y: 48, w: 120, h: 56 });
  });
});
