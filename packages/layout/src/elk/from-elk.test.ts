import { diagram, edge, group, node } from '@nivik/ir/testing';
import type { ElkNode } from 'elkjs/lib/elk-api';
import { describe, expect, it } from 'vitest';
import { straightRoute } from '../routing';
import { fromElk } from './from-elk';

const d = diagram({
  groups: [group('g', 'G')],
  nodes: [
    node('a', 'A'),
    node('b', 'B', { parent: 'g' }),
    node('c', 'C', { parent: 'g' }),
    node('d', 'D'),
  ],
  edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd')],
});

// Shape and numbers recorded from elkjs 0.12.0 on 2026-09-06.
const elkOut: ElkNode = {
  id: 'root',
  children: [
    { id: 'a', x: 12, y: 60, width: 120, height: 56 },
    {
      id: 'g',
      x: 157,
      y: 12,
      width: 348,
      height: 128,
      children: [
        { id: 'b', x: 24, y: 48, width: 120, height: 56 },
        { id: 'c', x: 164, y: 48, width: 160, height: 56 },
      ],
    },
    { id: 'd', x: 530, y: 60, width: 120, height: 56 },
  ],
  edges: [
    {
      id: 'e1',
      sources: ['a'],
      targets: ['b'],
      container: 'root',
      sections: [{ id: 'e1_s0', startPoint: { x: 132, y: 88 }, endPoint: { x: 181, y: 88 } }],
    },
    {
      id: 'e2',
      sources: ['b'],
      targets: ['c'],
      container: 'g',
      sections: [{ id: 'e2_s0', startPoint: { x: 144, y: 76 }, endPoint: { x: 164, y: 76 } }],
    },
    { id: 'e3', sources: ['c'], targets: ['d'] },
  ],
};

describe('fromElk (spec 03 §5.3)', () => {
  it('converts child and section coordinates to absolute ones', () => {
    const g = fromElk(elkOut, d, false);
    expect(g.positions.get('b')).toEqual({ x: 181, y: 60 });
    expect(g.positions.get('c')).toEqual({ x: 321, y: 60 });
    expect(g.sizes.get('g')).toEqual({ w: 348, h: 128 });
    expect(g.positions.get('g')).toEqual({ x: 157, y: 12 });
    expect(g.routes.get('e1')).toEqual([
      { x: 132, y: 88 },
      { x: 181, y: 88 },
    ]);
    // e2 lives in container g → shifted by g's absolute origin (157, 12)
    expect(g.routes.get('e2')).toEqual([
      { x: 301, y: 88 },
      { x: 321, y: 88 },
    ]);
    // no sections → straight border-to-border route
    expect(g.routes.get('e3')).toEqual(
      straightRoute({ x: 321, y: 60, w: 160, h: 56 }, { x: 530, y: 60, w: 120, h: 56 }),
    );
  });
  it('ignores sections when the diagram wants straight edges', () => {
    const g = fromElk(elkOut, d, true);
    expect(g.routes.get('e1')).toEqual(
      straightRoute({ x: 12, y: 60, w: 120, h: 56 }, { x: 181, y: 60, w: 120, h: 56 }),
    );
  });
  it('rounds fractional ELK coordinates', () => {
    const g = fromElk(
      { id: 'root', children: [{ id: 'a', x: 12.4, y: 59.6, width: 120.2, height: 56 }] },
      diagram({ nodes: [node('a', 'A')] }),
      false,
    );
    expect(g.positions.get('a')).toEqual({ x: 12, y: 60 });
    expect(g.sizes.get('a')).toEqual({ w: 120, h: 56 });
  });
});
