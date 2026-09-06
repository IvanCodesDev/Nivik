import { z } from 'zod';
import type { Id } from '../ids';
import { IdSchema } from '../ids';
import type { Diagram } from '../schema/diagram';
import { OriginSchema } from '../schema/enums';
import { ActionSchema } from './actions';

export const MAX_CHANGE_SET_ACTIONS = 500;

/**
 * The single write path into a diagram (spec 02 §3). AI runs, user edits (via renderer reconcile),
 * imports and template instantiation are all expressed as Change Sets.
 */
export const ChangeSetSchema = z
  .object({
    id: z.string().min(1),
    diagramId: IdSchema,
    baseVersion: z.number().int().positive(),
    origin: OriginSchema,
    runId: z.string().optional(),
    actions: z.array(ActionSchema).min(1).max(MAX_CHANGE_SET_ACTIONS),
    summary: z.string().max(300).optional(),
    createdAt: z.number().int(),
  })
  .superRefine((cs, ctx) => {
    if (cs.origin === 'ai' && !cs.runId) {
      ctx.addIssue({
        code: 'custom',
        path: ['runId'],
        message: 'runId is required for AI change sets',
      });
    }
  });
export type ChangeSet = z.infer<typeof ChangeSetSchema>;
export type ChangeSetInput = z.input<typeof ChangeSetSchema>;

export interface Affected {
  added: Id[];
  modified: Id[];
  deleted: Id[];
}

export type LayoutReason = 'relayout' | 'structural' | 'measure';

export interface LayoutRequest {
  scope: 'all' | Id[];
  reason: LayoutReason;
  /** node id -> node it should end up close to (from `addNode.near` / `relayout.near`). */
  hints: Record<Id, Id>;
}

export type ChangeSetErrorCode =
  | 'E_BASE_VERSION_MISMATCH'
  | 'E_ID_COLLISION'
  | 'E_UNKNOWN_REF'
  | 'E_REF_KIND'
  | 'E_PARENT_CYCLE'
  | 'E_SELF_LOOP'
  | 'E_INVALID_ACTION'
  | 'E_TOO_MANY_ACTIONS';

export interface ChangeSetError {
  code: ChangeSetErrorCode;
  /** Index of the offending action; `null` for change-set-level failures (version, post-check). */
  actionIndex: number | null;
  message: string;
  detail?: Record<string, unknown>;
}

export interface ApplySuccess {
  ok: true;
  diagram: Diagram;
  /** Undo change set: `origin: 'system'`, based on the resulting version. */
  inverse: ChangeSet;
  affected: Affected;
  layoutRequest: LayoutRequest | null;
  /** True when `setDiagram` touched diagram-level fields. */
  diagramChanged: boolean;
}

export interface ApplyFailure {
  ok: false;
  error: ChangeSetError;
}

export type ApplyResult = ApplySuccess | ApplyFailure;
