import { createDiagram } from '@nivik/ir';
import { orderPlatform, orderPlatformLaidOut } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { previewOf } from './diagram-preview';

describe('previewOf', () => {
  it('shifts the drawing to the padding and sizes the canvas to the bounds', () => {
    const laidOut = orderPlatformLaidOut();
    const model = previewOf(laidOut, { padding: 20 });
    const minX = Math.min(...model.nodes.map((n) => n.x), ...model.groups.map((g) => g.x));
    const minY = Math.min(...model.nodes.map((n) => n.y), ...model.groups.map((g) => g.y));
    expect(minX).toBe(20);
    expect(minY).toBe(20);
    expect(model.nodes).toHaveLength(laidOut.nodes.length);
    expect(model.groups).toHaveLength(laidOut.groups.length);
    expect(model.edges).toHaveLength(laidOut.edges.length);
    const maxX = Math.max(
      ...model.nodes.map((n) => n.x + n.w),
      ...model.groups.map((g) => g.x + g.w),
    );
    expect(model.width).toBeGreaterThanOrEqual(maxX + 20);
  });

  it('follows stored routes and otherwise connects the boxes edge to edge', () => {
    const laidOut = orderPlatformLaidOut();
    const routed = laidOut.edges.find((e) => e.route);
    const model = previewOf(laidOut);
    if (routed) {
      const drawn = model.edges.find((e) => e.id === routed.id);
      expect(drawn?.points).toHaveLength(routed.route?.points.length ?? 0);
    }
    const bare = createDiagram({ name: 'Bare', type: 'flow', now: 1 });
    bare.nodes = [
      { ...orderPlatform().nodes[0], id: 'a', position: { x: 0, y: 0 }, size: { w: 100, h: 50 } },
      { ...orderPlatform().nodes[1], id: 'b', position: { x: 300, y: 0 }, size: { w: 100, h: 50 } },
    ] as typeof bare.nodes;
    bare.edges = [
      { ...orderPlatform().edges[0], id: 'ab', source: 'a', target: 'b' },
    ] as typeof bare.edges;
    const [edge] = previewOf(bare, { padding: 0 }).edges;
    expect(edge?.points).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 25 },
    ]);
  });

  it('leaves out nodes without geometry and keeps a minimum frame for empty diagrams', () => {
    const empty = previewOf(createDiagram({ name: 'Empty', type: 'generic', now: 1 }));
    expect(empty).toMatchObject({ width: 320, height: 200, nodes: [], edges: [], groups: [] });
    const unplaced = previewOf(orderPlatform());
    expect(unplaced.nodes.length).toBeLessThanOrEqual(orderPlatform().nodes.length);
  });

  it('maps node types onto the shapes the preview draws and splits entity lines', () => {
    const d = createDiagram({ name: 'Shapes', type: 'generic', now: 1 });
    const base = orderPlatform().nodes[0];
    if (!base) throw new Error('fixture');
    d.nodes = [
      {
        ...base,
        id: 'd1',
        type: 'diamond',
        label: 'Ok?',
        position: { x: 0, y: 0 },
        size: { w: 80, h: 80 },
      },
      {
        ...base,
        id: 'e1',
        type: 'entity',
        label: 'users\nid\nemail',
        position: { x: 100, y: 0 },
        size: { w: 120, h: 90 },
      },
      {
        ...base,
        id: 'c1',
        type: 'cylinder',
        label: 'DB',
        position: { x: 300, y: 0 },
        size: { w: 80, h: 60 },
        style: { palette: 'sky' },
      },
    ] as typeof d.nodes;
    const model = previewOf(d);
    expect(model.nodes.map((n) => n.shape)).toEqual(['diamond', 'rect', 'rect']);
    expect(model.nodes[1]?.lines).toEqual(['users', 'id', 'email']);
    expect(model.nodes[2]?.palette).toBe('sky');
    expect(model.nodes[0]?.palette).toBe('neutral');
  });
});
