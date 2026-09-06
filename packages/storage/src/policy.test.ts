import { describe, expect, it } from 'vitest';
import {
  autoSnapshotDue,
  changeSetsToPrune,
  DEFAULT_POLICY,
  resolvePolicy,
  versionsToPrune,
} from './policy';

const MIN = 60_000;

describe('resolvePolicy', () => {
  it('fills the spec defaults and accepts overrides', () => {
    expect(DEFAULT_POLICY).toEqual({
      maxVersions: 50,
      maxChangeSets: 2000,
      autoSnapshotEvery: 20,
      autoSnapshotAfterMs: 10 * MIN,
    });
    expect(resolvePolicy({ maxVersions: 3 })).toEqual({ ...DEFAULT_POLICY, maxVersions: 3 });
    expect(resolvePolicy()).toEqual(DEFAULT_POLICY);
  });
});

describe('autoSnapshotDue (spec 06 §3.3 "auto")', () => {
  const policy = DEFAULT_POLICY;
  const last = { version: 10, createdAt: 1_000_000 };

  it('triggers after 20 user change sets since the last snapshot', () => {
    expect(
      autoSnapshotDue({ policy, last, userChangeSets: 19, changed: true, now: last.createdAt }),
    ).toBe(false);
    expect(
      autoSnapshotDue({ policy, last, userChangeSets: 20, changed: true, now: last.createdAt }),
    ).toBe(true);
  });

  it('triggers after 10 minutes only when something changed', () => {
    const later = last.createdAt + 10 * MIN;
    expect(
      autoSnapshotDue({ policy, last, userChangeSets: 0, changed: true, now: later - 1 }),
    ).toBe(false);
    expect(autoSnapshotDue({ policy, last, userChangeSets: 0, changed: true, now: later })).toBe(
      true,
    );
    expect(autoSnapshotDue({ policy, last, userChangeSets: 0, changed: false, now: later })).toBe(
      false,
    );
  });

  it('never fires without a snapshot to measure from', () => {
    expect(autoSnapshotDue({ policy, last: null, userChangeSets: 99, changed: true, now: 1 })).toBe(
      false,
    );
  });
});

describe('versionsToPrune (keep 50, auto → relayout → oldest, never manual or newest)', () => {
  const v = (
    version: number,
    reason: 'manual' | 'ai-run' | 'auto' | 'import' | 'relayout' | 'restore',
  ) => ({
    id: `v${version}`,
    version,
    reason,
  });

  it('does nothing under the limit', () => {
    expect(
      versionsToPrune([v(1, 'import'), v(2, 'auto')], { ...DEFAULT_POLICY, maxVersions: 2 }),
    ).toEqual([]);
  });

  it('removes auto snapshots first, oldest first', () => {
    const list = [
      v(1, 'import'),
      v(2, 'auto'),
      v(3, 'ai-run'),
      v(4, 'auto'),
      v(5, 'relayout'),
      v(6, 'ai-run'),
    ];
    expect(versionsToPrune(list, { ...DEFAULT_POLICY, maxVersions: 4 })).toEqual(['v2', 'v4']);
    expect(versionsToPrune(list, { ...DEFAULT_POLICY, maxVersions: 3 })).toEqual([
      'v2',
      'v4',
      'v5',
    ]);
    expect(versionsToPrune(list, { ...DEFAULT_POLICY, maxVersions: 2 })).toEqual([
      'v2',
      'v4',
      'v5',
      'v1',
    ]);
  });

  it('never deletes manual snapshots or the newest one, even when over the limit', () => {
    const list = [v(1, 'manual'), v(2, 'manual'), v(3, 'auto'), v(4, 'ai-run')];
    expect(versionsToPrune(list, { ...DEFAULT_POLICY, maxVersions: 1 })).toEqual(['v3']);
  });

  it('is order-independent and protects the newest snapshot even when it is auto', () => {
    const list = [v(4, 'auto'), v(1, 'import'), v(3, 'ai-run'), v(2, 'auto')];
    expect(versionsToPrune(list, { ...DEFAULT_POLICY, maxVersions: 2 })).toEqual(['v2', 'v1']);
  });
});

describe('changeSetsToPrune (keep 2000, never after the latest snapshot)', () => {
  const cs = (resultVersion: number) => ({ id: `cs${resultVersion}`, resultVersion });
  const list = [cs(2), cs(3), cs(4), cs(5), cs(6)];

  it('drops the oldest rows beyond the limit', () => {
    expect(changeSetsToPrune(list, 6, { ...DEFAULT_POLICY, maxChangeSets: 3 })).toEqual([
      'cs2',
      'cs3',
    ]);
  });

  it('keeps every row after the latest snapshot even when over the limit', () => {
    expect(changeSetsToPrune(list, 3, { ...DEFAULT_POLICY, maxChangeSets: 1 })).toEqual([
      'cs2',
      'cs3',
    ]);
    expect(changeSetsToPrune(list, 1, { ...DEFAULT_POLICY, maxChangeSets: 1 })).toEqual([]);
  });

  it('does nothing under the limit', () => {
    expect(changeSetsToPrune(list, 6, DEFAULT_POLICY)).toEqual([]);
  });
});
