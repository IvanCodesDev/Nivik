import { diagram, edge, node } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { defaultAlgorithmFor } from './strategy';

describe('defaultAlgorithmFor (spec 03 §3 fallback table)', () => {
  const withEdges = diagram({
    nodes: [node('a', 'A'), node('b', 'B')],
    edges: [edge('e', 'a', 'b')],
  });
  const noEdges = diagram();

  it.each([
    ['flow', 'layered'],
    ['erd', 'layered'],
    ['orgchart', 'layered'],
    ['mindmap', 'radial'],
    ['sequence', 'sequence'],
    ['timeline', 'grid'],
    ['gantt', 'grid'],
    ['roadmap', 'grid'],
    ['swot', 'grid'],
    ['kanban', 'grid'],
    ['pyramid', 'grid'],
    ['cycle', 'radial'],
  ] as const)('%s → %s', (type, algorithm) => {
    expect(defaultAlgorithmFor(type, noEdges)).toBe(algorithm);
  });

  it('falls back on structure for open types', () => {
    expect(defaultAlgorithmFor('customer-journey', withEdges)).toBe('layered');
    expect(defaultAlgorithmFor('customer-journey', noEdges)).toBe('grid');
    expect(defaultAlgorithmFor('generic', noEdges)).toBe('grid');
  });
});
