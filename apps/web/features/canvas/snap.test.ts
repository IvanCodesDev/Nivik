import { describe, expect, it } from 'vitest';
import { dragTranslation, nudgeStep, snapToGrid } from './snap';

describe('snapToGrid', () => {
  it('rounds to the nearest grid line measured from the origin', () => {
    expect(snapToGrid(107, 0, 24)).toBe(96);
    expect(snapToGrid(109, 0, 24)).toBe(120);
    expect(snapToGrid(500, 512, 24)).toBe(512);
    expect(snapToGrid(-13, 0, 24)).toBe(-24);
  });

  it('passes values through when the grid has no size', () => {
    expect(snapToGrid(107, 0, 0)).toBe(107);
  });
});

describe('dragTranslation', () => {
  const frame = { origin: { x: 500, y: 300 }, gridSize: 24, scale: 1 };
  const start = { left: 400, top: 200, dx: 0, dy: 0 };

  it('moves the node with the pointer when snapping is off', () => {
    expect(dragTranslation({ ...frame, snap: false, start, pointer: { x: 37, y: -12 } })).toEqual({
      dx: 37,
      dy: -12,
    });
  });

  it('divides pointer movement by the zoom so the node stays under the cursor', () => {
    expect(
      dragTranslation({ ...frame, scale: 2, snap: false, start, pointer: { x: 30, y: 10 } }),
    ).toEqual({ dx: 15, dy: 5 });
  });

  it('lands the node corner on a grid dot when snapping is on', () => {
    // Corner ends at screen (437, 188); nearest dots from the (500, 300) origin are 428 and 180.
    const result = dragTranslation({ ...frame, snap: true, start, pointer: { x: 37, y: -12 } });
    expect(result).toEqual({ dx: 28, dy: -20 });
    expect(start.left + result.dx).toBe(428);
    expect(start.top + result.dy).toBe(180);
  });

  it('accounts for the existing translation and the zoom when snapping', () => {
    const zoomed = { ...frame, scale: 2, snap: true };
    // Screen cell is 48px. Corner x lands exactly on the origin dot; y (200) snaps to 204.
    expect(
      dragTranslation({ ...zoomed, start: { ...start, dx: 10 }, pointer: { x: 100, y: 0 } }),
    ).toEqual({ dx: 60, dy: 2 });
  });
});

describe('nudgeStep', () => {
  it('steps one grid cell when snapping, else one pixel', () => {
    expect(nudgeStep(true, 24)).toBe(24);
    expect(nudgeStep(false, 24)).toBe(1);
  });
});
