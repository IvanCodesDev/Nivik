import type { ChangeSetRecord, VersionRecord } from './records';

/** Retention and snapshot thresholds (spec 06 §3.3). */
export interface StoragePolicy {
  /** Snapshots kept per diagram; `manual` snapshots and the newest one are never auto-deleted. */
  maxVersions: number;
  /** Change sets kept per diagram; rows after the latest snapshot are always kept. */
  maxChangeSets: number;
  /** User change sets since the last snapshot that trigger an `auto` snapshot. */
  autoSnapshotEvery: number;
  /** Age of the last snapshot after which any change triggers an `auto` snapshot. */
  autoSnapshotAfterMs: number;
}

export const DEFAULT_POLICY: StoragePolicy = Object.freeze({
  maxVersions: 50,
  maxChangeSets: 2000,
  autoSnapshotEvery: 20,
  autoSnapshotAfterMs: 10 * 60_000,
});

export function resolvePolicy(overrides: Partial<StoragePolicy> = {}): StoragePolicy {
  return { ...DEFAULT_POLICY, ...overrides };
}

export interface AutoSnapshotInput {
  policy: StoragePolicy;
  /** Newest snapshot of the diagram, if any. */
  last: Pick<VersionRecord, 'version' | 'createdAt'> | null;
  /** `origin: 'user'` change sets applied after `last`. */
  userChangeSets: number;
  /** Whether any change set was applied after `last`. */
  changed: boolean;
  now: number;
}

/** Whether an `auto` snapshot is due: ≥ N user change sets, or ≥ T elapsed with changes. */
export function autoSnapshotDue(input: AutoSnapshotInput): boolean {
  const { policy, last, userChangeSets, changed, now } = input;
  if (!last) return false;
  if (userChangeSets >= policy.autoSnapshotEvery) return true;
  return changed && now - last.createdAt >= policy.autoSnapshotAfterMs;
}

type PrunableVersion = Pick<VersionRecord, 'id' | 'version' | 'reason'>;

const DELETION_ORDER: readonly PrunableVersion['reason'][] = ['auto', 'relayout'];

/**
 * Ids of snapshots to delete so that at most `maxVersions` remain: `auto` first, then `relayout`,
 * then the oldest of the rest — never `manual` snapshots and never the newest one.
 */
export function versionsToPrune(
  versions: readonly PrunableVersion[],
  policy: StoragePolicy,
): string[] {
  let excess = versions.length - policy.maxVersions;
  if (excess <= 0) return [];
  const newest = Math.max(...versions.map((v) => v.version));
  const candidates = [...versions]
    .filter((v) => v.reason !== 'manual' && v.version !== newest)
    .sort((a, b) => a.version - b.version);
  const victims: string[] = [];
  const take = (matches: (v: PrunableVersion) => boolean) => {
    for (const v of candidates) {
      if (excess <= 0) return;
      if (!victims.includes(v.id) && matches(v)) {
        victims.push(v.id);
        excess -= 1;
      }
    }
  };
  for (const reason of DELETION_ORDER) take((v) => v.reason === reason);
  take(() => true);
  return victims;
}

type PrunableChangeSet = Pick<ChangeSetRecord, 'id' | 'resultVersion'>;

/**
 * Ids of the oldest change sets beyond `maxChangeSets`, excluding every row newer than the latest
 * snapshot (those are required to replay the current state).
 */
export function changeSetsToPrune(
  changeSets: readonly PrunableChangeSet[],
  latestSnapshotVersion: number,
  policy: StoragePolicy,
): string[] {
  let excess = changeSets.length - policy.maxChangeSets;
  if (excess <= 0) return [];
  const victims: string[] = [];
  for (const cs of [...changeSets].sort((a, b) => a.resultVersion - b.resultVersion)) {
    if (excess <= 0 || cs.resultVersion > latestSnapshotVersion) break;
    victims.push(cs.id);
    excess -= 1;
  }
  return victims;
}
