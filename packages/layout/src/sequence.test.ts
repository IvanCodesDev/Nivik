import { type Diagram, type Rect, rectOf } from '@nivik/ir';
import { edge, node } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { DefaultMeasurer, resolveSizes } from './measure';
import { applyGeometry } from './result';
import { layoutSequence } from './sequence';
import { checkout } from './testing';

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
};
const lay = (d: Diagram) =>
  applyGeometry(d, layoutSequence(d, resolveSizes(d, DefaultMeasurer, 'all'))).diagram;
const rect = (d: Diagram, id: string): Rect => must(rectOf(must(d.nodes.find((n) => n.id === id))));
const route = (d: Diagram, id: string) => must(d.edges.find((e) => e.id === id)?.route).points;

describe('layoutSequence (spec 03 §7.1)', () => {
  it('places participants left to right on one header row', () => {
    const out = lay(checkout());
    expect(['user', 'api', 'db', 'mail'].map((id) => rect(out, id))).toEqual([
      { x: 40, y: 40, w: 140, h: 48 },
      { x: 260, y: 40, w: 140, h: 48 },
      { x: 480, y: 40, w: 140, h: 48 },
      { x: 700, y: 40, w: 140, h: 48 },
    ]);
  });

  it('stacks messages 56 px apart from the first message line, between lifeline centres', () => {
    const out = lay(checkout());
    expect(route(out, 'm1')).toEqual([
      { x: 110, y: 128 },
      { x: 330, y: 128 },
    ]);
    expect(route(out, 'm2')).toEqual([
      { x: 330, y: 184 },
      { x: 550, y: 184 },
    ]);
    expect(route(out, 'm3')).toEqual([
      { x: 550, y: 240 },
      { x: 330, y: 240 },
    ]);
    expect(route(out, 'm6')).toEqual([
      { x: 330, y: 408 },
      { x: 110, y: 408 },
    ]);
  });

  it('draws a self message as a four-point loop bulging 40 px to the right', () => {
    expect(route(lay(checkout()), 'm4')).toEqual([
      { x: 330, y: 296 },
      { x: 370, y: 296 },
      { x: 370, y: 316 },
      { x: 330, y: 316 },
    ]);
  });

  it('orders participants by data.order, then by first appearance in the messages', () => {
    const d = checkout();
    const shuffled: Diagram = {
      ...d,
      nodes: [...d.nodes]
        .reverse()
        .map((n) => ({ ...n, data: { kind: (n.data as { kind: string }).kind } })),
    };
    const out = lay(shuffled);
    expect(['user', 'api', 'db', 'mail'].map((id) => rect(out, id).x)).toEqual([40, 260, 480, 700]);
  });

  it('lines up other nodes under the last message and keeps non-message edges straight', () => {
    const d = checkout();
    const withNote: Diagram = {
      ...d,
      nodes: [...d.nodes, node('n1', 'Retry policy', { type: 'note' })],
      edges: [...d.edges, edge('l1', 'n1', 'api', { type: 'link' })],
    };
    const out = lay(withNote);
    expect(rect(out, 'n1')).toMatchObject({ x: 40, y: 408 + 80 });
    expect(route(out, 'l1')).toHaveLength(2);
  });
});
