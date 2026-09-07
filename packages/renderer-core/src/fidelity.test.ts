import { diagram, group, node } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { emptyFidelity, fidelityFor, mergeFidelity } from './fidelity';

describe('fidelityFor (spec 04 §2.3, §5.6)', () => {
  const d = diagram({
    groups: [group('outer', 'Outer'), group('inner', 'Inner', { parent: 'outer' })],
    nodes: [
      node('a', 'A'),
      node('db', 'DB', { type: 'cylinder' }),
      node('q', 'Q', { type: 'hexagon' }),
    ],
  });
  it('is lossless when every shape and group is native', () => {
    const r = fidelityFor(d, {
      shapes: new Set(['rounded', 'cylinder', 'hexagon']),
      groups: 'frame',
      nestedGroups: true,
    });
    expect(r).toEqual(emptyFidelity());
    expect(r.lossless).toBe(true);
  });
  it('approximates unsupported shapes and nested groups, loses groups without a primitive', () => {
    const r = fidelityFor(d, {
      shapes: new Set(['rounded']),
      groups: 'frame',
      nestedGroups: false,
    });
    expect(r.lossless).toBe(false);
    expect(r.approximated).toEqual([
      { ids: ['db'], from: 'cylinder', to: 'box' },
      { ids: ['q'], from: 'hexagon', to: 'box' },
      { ids: ['inner'], from: 'nested group', to: 'flat group' },
    ]);
    const none = fidelityFor(d, {
      shapes: new Set(['rounded', 'cylinder', 'hexagon']),
      groups: 'none',
      nestedGroups: false,
    });
    expect(none.lost).toEqual([
      { kind: 'group', ids: ['outer', 'inner'], reason: 'renderer has no group primitive' },
    ]);
  });
  it('merges reports', () => {
    const merged = mergeFidelity(
      { lossless: false, lost: [{ kind: 'style', ids: ['a'], reason: 'x' }], approximated: [] },
      emptyFidelity(),
    );
    expect(merged.lossless).toBe(false);
    expect(merged.lost).toHaveLength(1);
  });
});
