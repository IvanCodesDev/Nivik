import {
  type ApplyFailure,
  type ApplySuccess,
  applyChangeSet,
  type ChangeSet,
  type Diagram,
  diffDiagrams,
  type Id,
  newChangeSetId,
} from '@nivik/ir';
import Dexie from 'dexie';
import type { NivikDB } from './db';
import {
  autoSnapshotDue,
  changeSetsToPrune,
  resolvePolicy,
  type StoragePolicy,
  versionsToPrune,
} from './policy';
import type { ChangeSetRecord, DiagramRecord, VersionReason, VersionRecord } from './records';

export type StorageErrorCode =
  | 'E_DIAGRAM_NOT_FOUND'
  | 'E_DIAGRAM_EXISTS'
  | 'E_VERSION_NOT_FOUND'
  | 'E_CONCURRENT_WRITE';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

export interface RepositoryDeps {
  /** Clock used for `updatedAt` and snapshot timestamps; defaults to `Date.now`. */
  now?: () => number;
  policy?: Partial<StoragePolicy>;
}

export interface CreateOptions {
  favorite?: boolean;
  tags?: string[];
}

export interface PersistOptions {
  /** Take a snapshot of the result in the same write (e.g. `'ai-run'` after an AI run). */
  snapshot?: Exclude<VersionReason, 'auto' | 'import'>;
  label?: string;
  runId?: string;
}

export interface SaveVersionOptions {
  reason: Exclude<VersionReason, 'auto' | 'import'>;
  label?: string;
  runId?: string;
}

export type PersistSuccess = ApplySuccess & {
  record: DiagramRecord;
  changeSet: ChangeSetRecord;
  /** Snapshot written alongside, whether requested or triggered by the auto policy. */
  snapshot: VersionRecord | null;
};

export type PersistResult = PersistSuccess | ApplyFailure;

export type RestoreResult =
  | PersistSuccess
  | ApplyFailure
  | { ok: true; unchanged: true; record: DiagramRecord; changeSet: null; snapshot: null };

/** Gallery / list projection of a diagram row (no IR, no thumbnail). */
export type DiagramSummary = Omit<DiagramRecord, 'ir' | 'thumbnail'>;

export interface UpdateOptions {
  favorite?: boolean;
  tags?: string[];
  lastOpenedAt?: number;
  thumbnail?: Blob;
}

const versionRecordId = (diagramId: Id, version: number) => `${diagramId}@${version}`;

/**
 * The only write path into `diagrams` / `versions` / `changeSets` (spec 06 §3). UI code talks to
 * this repository, never to Dexie tables directly.
 */
export class DiagramRepository {
  readonly db: NivikDB;
  private readonly now: () => number;
  private readonly policy: StoragePolicy;

  constructor(db: NivikDB, deps: RepositoryDeps = {}) {
    this.db = db;
    this.now = deps.now ?? (() => Date.now());
    this.policy = resolvePolicy(deps.policy);
  }

  /** Stores a new diagram and its `import` snapshot (spec 06 §3.3). */
  async create(ir: Diagram, opts: CreateOptions = {}): Promise<DiagramRecord> {
    const now = this.now();
    const record: DiagramRecord = {
      id: ir.id,
      ir,
      name: ir.name,
      type: ir.type,
      version: ir.version,
      favorite: opts.favorite ?? false,
      tags: opts.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    const { db } = this;
    await db.transaction('rw', db.diagrams, db.versions, async () => {
      if (await db.diagrams.get(ir.id)) {
        throw new StorageError('E_DIAGRAM_EXISTS', `diagram "${ir.id}" already exists`);
      }
      await db.diagrams.add(record);
      await db.versions.put(this.snapshotOf(ir, 'import', now));
    });
    return record;
  }

  get(id: Id): Promise<DiagramRecord | undefined> {
    return this.db.diagrams.get(id);
  }

  async require(id: Id): Promise<DiagramRecord> {
    const record = await this.get(id);
    if (!record) throw new StorageError('E_DIAGRAM_NOT_FOUND', `diagram "${id}" not found`);
    return record;
  }

  /** Newest-first summaries for the gallery. */
  async list(): Promise<DiagramSummary[]> {
    const rows = await this.db.diagrams.orderBy('updatedAt').reverse().toArray();
    return rows.map(({ ir: _ir, thumbnail: _thumbnail, ...summary }) => summary);
  }

  /** Deletes the diagram with its snapshots, change sets, runs and sources. */
  async remove(id: Id): Promise<void> {
    const { db } = this;
    await db.transaction(
      'rw',
      [db.diagrams, db.versions, db.changeSets, db.runs, db.sources],
      async () => {
        await db.diagrams.delete(id);
        await db.versions.where('diagramId').equals(id).delete();
        await db.changeSets.where('diagramId').equals(id).delete();
        await db.runs.where('diagramId').equals(id).delete();
        await db.sources.where('diagramId').equals(id).delete();
      },
    );
  }

  /** Record-level metadata; never creates a version. Favorite/tag edits bump `updatedAt`. */
  async update(id: Id, patch: UpdateOptions): Promise<DiagramRecord> {
    const { db } = this;
    return db.transaction('rw', db.diagrams, async () => {
      const record = await this.require(id);
      const next: DiagramRecord = { ...record };
      if (patch.favorite !== undefined) next.favorite = patch.favorite;
      if (patch.tags !== undefined) next.tags = [...patch.tags];
      if (patch.lastOpenedAt !== undefined) next.lastOpenedAt = patch.lastOpenedAt;
      if (patch.thumbnail !== undefined) next.thumbnail = patch.thumbnail;
      if (patch.favorite !== undefined || patch.tags !== undefined) next.updatedAt = this.now();
      await db.diagrams.put(next);
      return next;
    });
  }

  /**
   * Renderer-side metadata (`renderer.preferred`, `renderer.state`) is stored straight into the IR
   * without a version (spec 04 §5.6 / 06 §2.1).
   */
  async updateRenderer(id: Id, renderer: Diagram['renderer']): Promise<DiagramRecord> {
    const { db } = this;
    return db.transaction('rw', db.diagrams, async () => {
      const record = await this.require(id);
      const next: DiagramRecord = {
        ...record,
        ir: { ...record.ir, renderer },
        updatedAt: this.now(),
      };
      await db.diagrams.put(next);
      return next;
    });
  }

  /**
   * Applies `cs` to the stored diagram and persists diagram, change set (with inverse and
   * affected ids) and an optional snapshot atomically (spec 06 §3.2). Apply failures are returned,
   * not thrown, and write nothing.
   */
  async applyAndPersist(id: Id, cs: ChangeSet, opts: PersistOptions = {}): Promise<PersistResult> {
    const current = await this.require(id);
    const result = applyChangeSet(current.ir, cs);
    if (!result.ok) return result;

    const now = this.now();
    const { db } = this;
    const record: DiagramRecord = {
      ...current,
      ir: result.diagram,
      name: result.diagram.name,
      type: result.diagram.type,
      version: result.diagram.version,
      updatedAt: now,
    };
    const changeSet: ChangeSetRecord = {
      ...cs,
      resultVersion: result.diagram.version,
      inverse: result.inverse,
      affected: result.affected,
    };

    try {
      const snapshot = await db.transaction(
        'rw',
        [db.diagrams, db.changeSets, db.versions],
        async () => {
          // The apply ran against a read taken outside the transaction; a writer that landed in
          // between must not be overwritten (lost update), so re-check the version under the lock.
          const fresh = await db.diagrams.get(id);
          if (!fresh || fresh.version !== current.version) {
            throw new StorageError(
              'E_CONCURRENT_WRITE',
              `diagram "${id}" moved from version ${current.version} to ${fresh?.version ?? 'deleted'} while applying ${cs.id}`,
            );
          }
          await db.diagrams.put(record);
          await db.changeSets.put(changeSet);
          const reason = opts.snapshot ?? (await this.autoReason(id, changeSet, now));
          const written = reason
            ? await this.writeSnapshot(result.diagram, reason, now, opts)
            : null;
          await this.prune(id);
          return written;
        },
      );
      return { ...result, record, changeSet, snapshot };
    } catch (error) {
      if (error instanceof StorageError && error.code === 'E_CONCURRENT_WRITE') {
        return {
          ok: false,
          error: { code: 'E_BASE_VERSION_MISMATCH', actionIndex: null, message: error.message },
        };
      }
      throw error;
    }
  }

  /** "Save version": snapshots the current state; a `manual` save upgrades an existing snapshot. */
  async saveVersion(id: Id, opts: SaveVersionOptions): Promise<VersionRecord> {
    const { db } = this;
    return db.transaction('rw', [db.diagrams, db.versions, db.changeSets], async () => {
      const record = await this.require(id);
      const existing = await db.versions.get(versionRecordId(id, record.version));
      if (existing && (existing.reason === 'manual' || opts.reason !== 'manual')) return existing;
      const snapshot = await this.writeSnapshot(record.ir, opts.reason, this.now(), opts);
      await this.prune(id);
      return snapshot;
    });
  }

  /** Snapshots of a diagram, oldest first. */
  listVersions(id: Id): Promise<VersionRecord[]> {
    return this.db.versions
      .where('[diagramId+version]')
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .toArray();
  }

  /** Change sets of a diagram ordered by `resultVersion`; `after` excludes rows up to that version. */
  listChangeSets(
    id: Id,
    range: { after?: number; upTo?: number } = {},
  ): Promise<ChangeSetRecord[]> {
    const lower = range.after === undefined ? Dexie.minKey : range.after + 1;
    const upper = range.upTo ?? Dexie.maxKey;
    return this.db.changeSets
      .where('[diagramId+resultVersion]')
      .between([id, lower], [id, upper], true, true)
      .toArray();
  }

  /**
   * Recomputes the current IR from the snapshot at `fromVersion` and the change sets after it
   * (spec 06 §3.1 invariant). Throws when the history is inconsistent.
   */
  async replay(id: Id, fromVersion: number): Promise<Diagram> {
    const base = await this.db.versions.get(versionRecordId(id, fromVersion));
    if (!base)
      throw new StorageError('E_VERSION_NOT_FOUND', `no snapshot at version ${fromVersion}`);
    let d = base.ir;
    for (const cs of await this.listChangeSets(id, { after: fromVersion })) {
      const r = applyChangeSet(d, cs);
      if (!r.ok) throw new Error(`replay failed at ${cs.id}: ${r.error.code} ${r.error.message}`);
      d = r.diagram;
    }
    return d;
  }

  /**
   * Restores a snapshot as a forward change set (history stays linear) and snapshots the result
   * with reason `restore`. A restore to the current state is a no-op.
   */
  async restore(id: Id, version: number, opts: { label?: string } = {}): Promise<RestoreResult> {
    const target = await this.db.versions.get(versionRecordId(id, version));
    if (!target) throw new StorageError('E_VERSION_NOT_FOUND', `no snapshot at version ${version}`);
    const current = await this.require(id);
    const now = this.now();
    const cs = diffDiagrams(current.ir, target.ir, {
      origin: 'system',
      id: newChangeSetId(),
      now,
      summary: `Restore version ${version}`,
    });
    if (!cs) return { ok: true, unchanged: true, record: current, changeSet: null, snapshot: null };
    return this.applyAndPersist(id, cs, { snapshot: 'restore', label: opts.label });
  }

  private snapshotOf(
    ir: Diagram,
    reason: VersionReason,
    now: number,
    extra: { label?: string; runId?: string } = {},
  ): VersionRecord {
    return {
      id: versionRecordId(ir.id, ir.version),
      diagramId: ir.id,
      version: ir.version,
      ir,
      reason,
      ...(extra.runId !== undefined ? { runId: extra.runId } : {}),
      ...(extra.label !== undefined ? { label: extra.label } : {}),
      createdAt: now,
    };
  }

  private async writeSnapshot(
    ir: Diagram,
    reason: VersionReason,
    now: number,
    extra: { label?: string; runId?: string },
  ): Promise<VersionRecord> {
    const snapshot = this.snapshotOf(ir, reason, now, extra);
    await this.db.versions.put(snapshot);
    return snapshot;
  }

  private async latestSnapshot(id: Id): Promise<VersionRecord | undefined> {
    return this.db.versions
      .where('[diagramId+version]')
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .last();
  }

  /** Spec 06 §3.3 "auto": evaluated after `latest` landed, counting rows since the last snapshot. */
  private async autoReason(
    id: Id,
    latest: ChangeSetRecord,
    now: number,
  ): Promise<VersionReason | null> {
    const last = await this.latestSnapshot(id);
    if (!last) return null;
    const since = await this.listChangeSets(id, { after: last.version });
    const due = autoSnapshotDue({
      policy: this.policy,
      last,
      userChangeSets: since.filter((c) => c.origin === 'user').length,
      changed: since.length > 0 || latest.resultVersion > last.version,
      now,
    });
    return due ? 'auto' : null;
  }

  private async prune(id: Id): Promise<void> {
    const versions = await this.listVersions(id);
    const doomedVersions = versionsToPrune(versions, this.policy);
    if (doomedVersions.length) await this.db.versions.bulkDelete(doomedVersions);
    const remaining = versions.filter((v) => !doomedVersions.includes(v.id));
    const latest = remaining.at(-1);
    if (!latest) return;
    const changeSets = await this.listChangeSets(id);
    const doomedChangeSets = changeSetsToPrune(changeSets, latest.version, this.policy);
    if (doomedChangeSets.length) await this.db.changeSets.bulkDelete(doomedChangeSets);
  }
}
