import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReconcileQueue } from './queue';

describe('createReconcileQueue (spec 04 §5.2 step 1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces bursts to the latest snapshot', () => {
    const seen: number[] = [];
    const q = createReconcileQueue<number>({ onFlush: (s) => seen.push(s) });
    q.push(1);
    q.push(2);
    vi.advanceTimersByTime(249);
    expect(seen).toEqual([]);
    q.push(3);
    vi.advanceTimersByTime(250);
    expect(seen).toEqual([3]);
    expect(q.pending).toBe(false);
  });
  it('flush() delivers immediately and cancels the timer', () => {
    const seen: number[] = [];
    const q = createReconcileQueue<number>({ debounceMs: 100, onFlush: (s) => seen.push(s) });
    q.push(7);
    q.flush();
    expect(seen).toEqual([7]);
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([7]);
    q.flush();
    expect(seen).toEqual([7]);
  });
  it('dispose() drops what is pending', () => {
    const seen: number[] = [];
    const q = createReconcileQueue<number>({ onFlush: (s) => seen.push(s) });
    q.push(1);
    q.dispose();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
  });
});
