import { type AgentAction, type ChangeSet, newChangeSetId } from '@nivik/ir';
import type { DoneOutcome, Plan } from '@nivik/protocol';
import { diagramPatchFromPlan } from '../stages/plan-patch';
import type { Documents, StagingDoc } from './documents';

export interface FinishInput {
  summary: string;
  unresolved?: string[];
}

export interface ConvergedDocument {
  doc: StagingDoc;
  changeSet: ChangeSet;
}

export interface Convergence {
  documents: ConvergedDocument[];
  outcome: Extract<DoneOutcome, 'finished' | 'no-changes'>;
}

/**
 * Spec 05 §4.5: at `finish`, every document whose staging differs from its base yields exactly one
 * change set — the accepted actions, with the plan's type / layout decision prepended for the
 * run's own diagram (code writes what the plan decided; the model is not asked twice).
 */
export function converge(
  documents: Documents,
  plan: Plan | null,
  summary: string,
  opts: { runId: string; now(): number },
): Convergence {
  const out: ConvergedDocument[] = [];
  for (const doc of documents.changed()) {
    const fromPlan: AgentAction[] = [];
    if (doc.created) {
      // The host only knows the created document by id / name (the `document` event); the change
      // set carries its type and layout so a bare new diagram at version 1 rebuilds it faithfully.
      fromPlan.push({
        op: 'setDiagram',
        patch: { type: doc.initial.type, layout: doc.initial.layout },
      });
    } else if (plan) {
      const patch = diagramPatchFromPlan(plan, doc.initial);
      if (patch) fromPlan.push({ op: 'setDiagram', patch });
    }
    const actions = [...fromPlan, ...doc.accepted];
    if (actions.length === 0) continue;
    out.push({
      doc,
      changeSet: {
        id: newChangeSetId(),
        diagramId: doc.id,
        baseVersion: doc.initial.version,
        origin: 'ai',
        runId: opts.runId,
        actions,
        summary: summary.slice(0, 300),
        createdAt: opts.now(),
      },
    });
  }
  return { documents: out, outcome: out.length === 0 ? 'no-changes' : 'finished' };
}
