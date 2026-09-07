import { describe, expect, it } from 'vitest';
import { mergeById } from './merge';
import { excalidrawElement as el } from './testing';

describe('mergeById (spec 04 §6.3, §11)', () => {
  const scene = [
    el('rectangle', { id: 'a', x: 0, y: 0, seed: 7, version: 3, versionNonce: 99 }),
    el('rectangle', { id: 'b', x: 0, y: 0 }),
    el('text', { id: 'a-t', x: 0, y: 0, containerId: 'a' }),
  ];
  it('upserts by id keeping seed / versionNonce / index and bumping the version; untouched elements keep their identity', () => {
    const next = mergeById(scene, {
      upsert: [el('rectangle', { id: 'a', x: 50, y: 60, seed: 1, version: 1, versionNonce: 1 })],
      softDelete: [],
    });
    expect(next[0]).toMatchObject({ id: 'a', x: 50, y: 60, seed: 7, version: 4, versionNonce: 99 });
    expect(next[1]).toBe(scene[1]);
    expect(next[2]).toBe(scene[2]);
  });
  it('soft-deletes and appends brand-new elements', () => {
    const next = mergeById(scene, {
      upsert: [el('ellipse', { id: 'c', x: 1, y: 1 })],
      softDelete: ['a-t'],
    });
    expect(next.find((e) => e.id === 'a-t')).toMatchObject({ isDeleted: true, version: 2 });
    expect(next.at(-1)).toMatchObject({ id: 'c', type: 'ellipse' });
    expect(next).toHaveLength(4);
  });
});
