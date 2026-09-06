import { describe, expect, it } from 'vitest';
import type { Diagram } from '../schema';
import { orderPlatformLaidOut } from '../testing/order-platform';
import { randomChangeSets } from '../testing/random-changesets';
import { validateDiagram } from '../validate';
import { applyChangeSet } from './apply';
import type { ChangeSet } from './changeset';

/** Comparable view: no version / meta, collections order-insensitive. */
const normalize = (d: Diagram) => {
  const strip = <T extends { meta: unknown; id: string }>(list: T[]) =>
    [...list].sort((a, b) => a.id.localeCompare(b.id)).map(({ meta: _meta, ...rest }) => rest);
  const { version: _version, meta: _meta, ...rest } = d;
  return { ...rest, nodes: strip(d.nodes), edges: strip(d.edges), groups: strip(d.groups) };
};

const STEPS = 200;

describe.each([20260905, 42, 7_777_777])('random replay (spec 02 §10), seed %i', (seed) => {
  const initial = orderPlatformLaidOut();
  const initialJson = JSON.stringify(initial);
  const generator = randomChangeSets(seed);

  const changeSets: ChangeSet[] = [];
  const inverses: ChangeSet[] = [];
  let state = initial;

  it(`applies ${STEPS} random change sets, each undoable and never mutating its input`, () => {
    for (let i = 0; i < STEPS; i += 1) {
      const cs = generator.next(state);
      const before = JSON.stringify(state);
      const result = applyChangeSet(state, cs);
      if (!result.ok)
        throw new Error(`step ${i}: ${JSON.stringify(result.error)}\n${JSON.stringify(cs)}`);
      expect(JSON.stringify(state), `step ${i} mutated its input`).toBe(before);
      expect(validateDiagram(result.diagram).errors, `step ${i} left structural errors`).toEqual(
        [],
      );
      expect(result.diagram.version).toBe(state.version + 1);

      const undone = applyChangeSet(result.diagram, result.inverse);
      if (!undone.ok)
        throw new Error(
          `step ${i} inverse failed: ${JSON.stringify(undone.error)}\n${JSON.stringify(cs)}`,
        );
      expect(
        normalize(undone.diagram),
        `step ${i} (${cs.actions.map((a) => a.op).join(',')}) did not undo`,
      ).toEqual(normalize(state));

      changeSets.push(cs);
      inverses.push(result.inverse);
      state = result.diagram;
    }
    expect(state.version).toBe(initial.version + STEPS);
    expect(JSON.stringify(initial)).toBe(initialJson);
  });

  it('replays deterministically: same input, byte-identical output', () => {
    let replayed: Diagram = JSON.parse(initialJson);
    for (const cs of changeSets) {
      const result = applyChangeSet(replayed, cs);
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      replayed = result.diagram;
    }
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(state));
  });

  it('undoes the whole history back to the initial diagram', () => {
    let current = state;
    for (let i = inverses.length - 1; i >= 0; i -= 1) {
      const result = applyChangeSet(current, inverses[i] as ChangeSet, { skipVersionCheck: true });
      if (!result.ok) throw new Error(`undo ${i}: ${JSON.stringify(result.error)}`);
      current = result.diagram;
    }
    expect(normalize(current)).toEqual(normalize(initial));
  });
});
