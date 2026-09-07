import { type Diagram, indexDiagram } from '@nivik/ir';
import { diagram, group, node } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import type { LayoutWarning } from '../types';
import { cellAt as c, planCells } from './plan';

const plan = (d: Diagram, skip = new Set<string>(), warnings: LayoutWarning[] = []) =>
  planCells(d, indexDiagram(d), skip, warnings);

describe('planCells (spec 03 §7.2 steps 1–2)', () => {
  it('takes explicit cells and derives group ranges from their children', () => {
    const d = diagram({
      groups: [group('g', 'G')],
      nodes: [
        node('a', 'A', { parent: 'g', cell: c(1, 0) }),
        node('b', 'B', { parent: 'g', cell: c(2, 1) }),
      ],
    });
    const p = plan(d);
    expect(p.ranges.get('g')).toEqual(c(1, 0, 2, 2));
    expect(p.cols).toBe(3);
    expect(p.rows).toBe(2);
  });

  it('appends cell-less top-level nodes below the grid, at least ceil(sqrt(n)) wide', () => {
    const d = diagram({
      nodes: [
        node('x', 'X', { cell: c(0, 0) }),
        node('a', 'A'),
        node('b', 'B'),
        node('c', 'C'),
        node('d', 'D'),
        node('e', 'E'),
      ],
    });
    const p = plan(d);
    expect(p.ranges.get('a')).toEqual(c(0, 1));
    expect(p.ranges.get('c')).toEqual(c(2, 1));
    expect(p.ranges.get('d')).toEqual(c(0, 2));
    expect(p.cols).toBe(3);
  });

  it('lays a cell-less diagram out as a ceil(sqrt(n)) square (legacy grid)', () => {
    const d = diagram({ nodes: ['a', 'b', 'c', 'd', 'e'].map((id) => node(id, id.toUpperCase())) });
    const p = plan(d);
    expect(p.cols).toBe(3);
    expect(p.rows).toBe(2);
    expect(p.ranges.get('e')).toEqual(c(1, 1));
  });

  it('stacks cell-less children inside a group without celled descendants', () => {
    const d = diagram({
      groups: [group('s', 'S', { cell: c(0, 0) })],
      nodes: [node('s1', '1', { parent: 's' }), node('s2', '2', { parent: 's' })],
    });
    const p = plan(d);
    expect(p.stacked.get('s')).toEqual(['s1', 's2']);
    expect(p.ranges.has('s1')).toBe(false);
  });

  it('treats a cell-less group as one unit and stacks its children inside it', () => {
    const d = diagram({
      groups: [group('g', 'G'), group('inner', 'Inner', { parent: 'g' })],
      nodes: [
        node('a', 'A', { cell: c(0, 0) }),
        node('b', 'B', { parent: 'g' }),
        node('i1', 'I1', { parent: 'inner' }),
      ],
    });
    const p = plan(d);
    expect(p.ranges.get('g')).toEqual(c(0, 1));
    expect(p.stacked.get('g')).toEqual(['b', 'inner']);
    expect(p.stacked.get('inner')).toEqual(['i1']);
  });

  it('fills the free cells of a mixed group along its long side and widens it when full', () => {
    const warnings: LayoutWarning[] = [];
    const d = diagram({
      groups: [group('g', 'G', { cell: c(0, 0, 1, 2) })],
      nodes: [
        node('a', 'A', { parent: 'g', cell: c(0, 0) }),
        node('b', 'B', { parent: 'g' }),
        node('x', 'X', { parent: 'g' }),
      ],
    });
    const p = plan(d, new Set(), warnings);
    expect(p.ranges.get('b')).toEqual(c(0, 1));
    expect(p.ranges.get('x')).toEqual(c(1, 0));
    expect(p.ranges.get('g')).toEqual(c(0, 0, 2, 2));
    expect(warnings.map((w) => w.code)).toEqual(['W_UNPLACED']);
  });

  it('widens an explicit group range that does not contain its children', () => {
    const warnings: LayoutWarning[] = [];
    const d = diagram({
      groups: [group('g', 'G', { cell: c(0, 0) })],
      nodes: [node('a', 'A', { parent: 'g', cell: c(3, 0) })],
    });
    const p = plan(d, new Set(), warnings);
    expect(p.ranges.get('g')).toEqual(c(0, 0, 4, 1));
    expect(warnings[0]?.code).toBe('W_UNPLACED');
  });

  it('keeps skipped (pinned) nodes out of the grid', () => {
    const d = diagram({
      nodes: [
        node('p', 'P', { cell: c(0, 0), pinned: true, position: { x: 5, y: 5 } }),
        node('a', 'A'),
      ],
    });
    const p = plan(d, new Set(['p']));
    expect(p.ranges.has('p')).toBe(false);
    expect(p.ranges.get('a')).toEqual(c(0, 0));
  });
});
