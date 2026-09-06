import type { Affected, ChangeSet, Diagram, DiagramType, Id, SourceRef } from '@nivik/ir';
import type { Plan, RunEvent } from '@nivik/protocol';

/** Table row types of `nivik-db` (spec 06 §2.1). Every row carries an `id` and is cloud-migratable. */

export interface DiagramRecord {
  id: Id;
  /** Current complete IR (including geometry). */
  ir: Diagram;
  /** Redundant index fields kept in sync with `ir`. */
  name: string;
  type: DiagramType;
  version: number;
  favorite: boolean;
  tags: string[];
  /** 320×200 PNG produced by the renderer. */
  thumbnail?: Blob;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  remoteRev?: string;
}

export type VersionReason = 'manual' | 'ai-run' | 'auto' | 'import' | 'relayout' | 'restore';

export interface VersionRecord {
  id: string;
  diagramId: Id;
  version: number;
  /** Snapshot of the IR at `version`. */
  ir: Diagram;
  reason: VersionReason;
  runId?: string;
  label?: string;
  createdAt: number;
}

export type ChangeSetRecord = ChangeSet & {
  /** Version of the diagram after this change set was applied (`baseVersion + 1`). */
  resultVersion: number;
  inverse: ChangeSet;
  affected: Affected;
};

export type RunStatus = 'running' | 'done' | 'error' | 'aborted' | 'conflict' | 'clarify';

/** Action events are stored without the full action payload to bound record size. */
export type StoredRunEvent =
  | Exclude<RunEvent, { type: 'action' }>
  | { type: 'action'; index: number; ok: boolean; error?: { code: string; message: string } };

export interface RunRecord {
  id: string;
  diagramId: Id;
  prompt: string;
  selection: Id[];
  sourceIds: Id[];
  model: { providerId: string; model: string };
  plan?: Plan;
  events: StoredRunEvent[];
  status: RunStatus;
  error?: { code: string; message: string };
  usage?: { inputTokens: number; outputTokens: number; calls: number };
  /** Change sets produced by this run (AI + system layout). */
  changeSetIds: string[];
  /** Prompt version hash (spec 05 §12.1). */
  promptHash: string;
  startedAt: number;
  endedAt?: number;
}

export type SourceRecord = SourceRef & {
  diagramId: Id;
  content?: Blob;
  contentHash: string;
  digestText?: string;
};

export interface TemplateRecord {
  id: string;
  name: string;
  category: string;
  description: string;
  ir: Diagram;
  builtin: boolean;
  thumbnail?: Blob;
  createdAt: number;
}

/** Provider configuration; the full schema arrives with `@nivik/agent` (spec 05 §9). */
export interface ProviderRecord {
  id: string;
  kind: string;
  [field: string]: unknown;
}

export interface SecretRecord {
  providerId: string;
  cipher: ArrayBuffer;
  iv: Uint8Array;
  createdAt: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}
