import { describe, expect, it } from 'vitest';
import { orthogonalRoute, straightRoute } from './routing';

const a = { x: 0, y: 0, w: 100, h: 50 };

describe('straightRoute', () => {
  it('connects the facing borders of two boxes', () => {
    expect(straightRoute(a, { x: 300, y: 0, w: 100, h: 50 })).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 25 },
    ]);
  });
});

describe('orthogonalRoute (spec 03 §6.3)', () => {
  const b = { x: 300, y: 200, w: 100, h: 50 };
  it('exits horizontally when the horizontal distance dominates', () => {
    expect(orthogonalRoute(a, b, [], 24)).toEqual([
      { x: 100, y: 25 },
      { x: 200, y: 25 },
      { x: 200, y: 225 },
      { x: 300, y: 225 },
    ]);
  });
  it('pushes the midline past a box it would cut through', () => {
    const blocker = { x: 180, y: 80, w: 40, h: 60 };
    expect(orthogonalRoute(a, b, [blocker], 24)[1]?.x).toBe(180 - 24);
  });
  it('collapses to three points when the boxes are aligned', () => {
    expect(orthogonalRoute(a, { x: 300, y: 0, w: 100, h: 50 }, [], 24)).toEqual([
      { x: 100, y: 25 },
      { x: 200, y: 25 },
      { x: 300, y: 25 },
    ]);
  });
  it('routes vertically when the vertical distance dominates', () => {
    expect(orthogonalRoute(a, { x: 0, y: 300, w: 100, h: 50 }, [], 24)).toEqual([
      { x: 50, y: 50 },
      { x: 50, y: 175 },
      { x: 50, y: 300 },
    ]);
  });
});
