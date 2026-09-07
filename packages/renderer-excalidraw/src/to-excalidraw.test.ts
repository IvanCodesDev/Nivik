import { diagram, edge, group, node, orderPlatformLaidOut } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { toExcalidraw } from './to-excalidraw';

const at = (x: number, y: number, w = 120, h = 56) => ({ position: { x, y }, size: { w, h } });
const byId = (elements: readonly { id?: string }[], id: string) =>
  elements.find((el) => el.id === id) as Record<string, unknown> | undefined;

describe('toExcalidraw (spec 04 §6.2, §11)', () => {
  it('projects the laid-out order platform (snapshot)', () => {
    const { elements, fidelity } = toExcalidraw(orderPlatformLaidOut());
    expect(elements).toMatchSnapshot();
    expect(fidelity.approximated.map((a) => a.from)).toEqual(['cylinder', 'hexagon']);
  });

  it('tags every element and keeps ids', () => {
    const { elements } = toExcalidraw(orderPlatformLaidOut());
    expect(byId(elements, 'web')).toMatchObject({
      type: 'rectangle',
      x: 40,
      y: 40,
      width: 160,
      height: 64,
      roundness: { type: 3 },
      customData: { nivik: { id: 'web', part: 'main', rev: 0 } },
    });
    expect(byId(elements, 'stripe')).toMatchObject({ type: 'rectangle', roundness: null });
    expect(byId(elements, 'pg')).toMatchObject({ type: 'rectangle', roundness: { type: 3 } });
  });

  it('turns edges into bound arrows with points relative to the first route point', () => {
    const { elements } = toExcalidraw(orderPlatformLaidOut());
    expect(byId(elements, 'e1')).toMatchObject({
      type: 'arrow',
      x: 100,
      y: 72,
      points: [
        [0, 0],
        [160, 0],
      ],
      start: { id: 'web' },
      end: { id: 'gw' },
      label: { text: 'HTTPS' },
      startArrowhead: null,
      endArrowhead: 'arrow',
      strokeStyle: 'solid',
    });
    expect(byId(elements, 'e5')).toMatchObject({ strokeStyle: 'dashed' });
  });

  it('maps direction and edge type to arrowheads', () => {
    const d = diagram({
      nodes: [node('a', 'A', at(0, 0)), node('b', 'B', at(300, 0))],
      edges: [
        edge('both', 'a', 'b', { direction: 'both' }),
        edge('back', 'a', 'b', { direction: 'backward' }),
        edge('none', 'a', 'b', { direction: 'none' }),
        edge('inh', 'a', 'b', { type: 'inheritance' }),
        edge('comp', 'a', 'b', { type: 'composition' }),
        edge('agg', 'a', 'b', { type: 'aggregation' }),
      ],
    });
    const { elements } = toExcalidraw(d);
    expect(byId(elements, 'both')).toMatchObject({
      startArrowhead: 'arrow',
      endArrowhead: 'arrow',
    });
    expect(byId(elements, 'back')).toMatchObject({ startArrowhead: 'arrow', endArrowhead: null });
    expect(byId(elements, 'none')).toMatchObject({ startArrowhead: null, endArrowhead: null });
    expect(byId(elements, 'inh')).toMatchObject({ endArrowhead: 'triangle_outline' });
    expect(byId(elements, 'comp')).toMatchObject({ endArrowhead: 'diamond' });
    expect(byId(elements, 'agg')).toMatchObject({ endArrowhead: 'diamond_outline' });
  });

  it('top-level groups become frames listing their direct children; nested groups degrade to locked rectangles', () => {
    const d = diagram({
      groups: [
        group('outer', 'Outer', { position: { x: 0, y: 0 }, size: { w: 600, h: 400 } }),
        group('inner', 'Inner', {
          parent: 'outer',
          position: { x: 24, y: 48 },
          size: { w: 300, h: 200 },
        }),
      ],
      nodes: [
        node('a', 'A', { parent: 'inner', ...at(48, 96) }),
        node('b', 'B', { parent: 'outer', ...at(400, 96) }),
      ],
    });
    const { elements, fidelity } = toExcalidraw(d);
    expect(byId(elements, 'outer')).toMatchObject({
      type: 'frame',
      name: 'Outer',
      children: ['b', 'inner'],
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    });
    expect(byId(elements, 'inner')).toMatchObject({ type: 'rectangle', locked: true, opacity: 40 });
    expect(fidelity.approximated).toEqual([
      { ids: ['inner'], from: 'nested group', to: 'locked rectangle' },
    ]);
  });

  it('line nodes become unbound lines / arrows along their axis; fill tokens reach opacity', () => {
    const d = diagram({
      nodes: [
        node('axis', '', { type: 'line', data: { arrow: 'end' }, ...at(0, 100, 500, 56) }),
        node('diag', '', {
          type: 'line',
          data: { axis: 'diagonal-up', arrow: 'both' },
          ...at(0, 0, 200, 100),
        }),
        node('plain', '', { type: 'line', ...at(0, 300, 200, 20) }),
        node('venn', 'Design', {
          type: 'ellipse',
          style: { fill: 'translucent', palette: 'lavender' },
          ...at(0, 0, 400, 200),
        }),
        node('hollow', 'H', { style: { fill: 'none' }, ...at(0, 0) }),
      ],
    });
    const { elements } = toExcalidraw(d);
    expect(byId(elements, 'axis')).toMatchObject({
      type: 'arrow',
      x: 0,
      y: 128,
      points: [
        [0, 0],
        [500, 0],
      ],
      startArrowhead: null,
      endArrowhead: 'arrow',
    });
    expect(byId(elements, 'diag')).toMatchObject({
      type: 'arrow',
      x: 0,
      y: 100,
      points: [
        [0, 0],
        [200, -100],
      ],
      startArrowhead: 'arrow',
      endArrowhead: 'arrow',
    });
    expect(byId(elements, 'plain')).toMatchObject({
      type: 'line',
      points: [
        [0, 0],
        [200, 0],
      ],
    });
    expect(byId(elements, 'venn')).toMatchObject({
      type: 'ellipse',
      opacity: 50,
      backgroundColor: '#ede7f7',
    });
    expect(byId(elements, 'hollow')).toMatchObject({ backgroundColor: 'transparent' });
  });

  it('entities carry their columns as a tagged text part; participants get a dashed lifeline down to the last message', () => {
    const d = diagram({
      nodes: [
        node('u', 'User', {
          type: 'entity',
          data: { columns: [{ name: 'id', type: 'uuid' }, { name: 'email' }] },
          ...at(0, 0, 200, 84),
        }),
        node('api', 'API', {
          type: 'participant',
          data: { kind: 'system' },
          ...at(300, 40, 140, 48),
        }),
        node('db', 'DB', {
          type: 'participant',
          data: { kind: 'database' },
          ...at(600, 40, 140, 48),
        }),
      ],
      edges: [
        edge('m1', 'api', 'db', {
          type: 'message',
          data: { order: 0, kind: 'sync' },
          route: {
            points: [
              { x: 370, y: 128 },
              { x: 670, y: 128 },
            ],
          },
        }),
      ],
    });
    const { elements } = toExcalidraw(d);
    expect(byId(elements, 'u:label')).toMatchObject({
      type: 'text',
      text: 'User\nid: uuid\nemail',
      textAlign: 'left',
      customData: { nivik: { id: 'u', part: 'label', rev: 0 } },
    });
    expect(byId(elements, 'api:lifeline')).toMatchObject({
      type: 'line',
      x: 370,
      y: 88,
      points: [
        [0, 0],
        [0, 80],
      ],
      strokeStyle: 'dashed',
      locked: true,
    });
  });

  it('opts.ids narrows the projection but still resolves edge endpoints and frame children from the whole diagram', () => {
    const { elements } = toExcalidraw(orderPlatformLaidOut(), { ids: ['e1', 'svc'] });
    expect(elements.map((el) => el.id)).toEqual(['e1', 'svc']);
    expect(byId(elements, 'svc')).toMatchObject({ children: ['users', 'orders', 'pay'] });
  });
});
