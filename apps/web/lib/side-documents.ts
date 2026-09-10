import { type ChangeSet, createDiagram, type Diagram, type Id } from '@nivik/ir';
import { DefaultMeasurer, type ElkEngine, type NodeMeasurer } from '@nivik/layout';
import type { DocumentInfo, RendererId } from '@nivik/protocol';
import type { DiagramRepository } from '@nivik/storage';
import { runLayout } from '@/lib/layout-pipeline';

export interface SideDocumentDeps {
  repo: DiagramRepository;
  now(): number;
  measurer?: NodeMeasurer;
  engine?: ElkEngine;
  /** The renderer the person is using; new documents open with it. */
  renderer: RendererId;
}

export type SideDocumentOutcome =
  | { ok: true; id: Id; diagram: Diagram; changeSets: ChangeSet[] }
  | { ok: false; id: Id; error: string };

/**
 * Design D14′ §5: a change set for a document other than the one on the canvas. Created documents
 * become new records (the change set carries their type / layout); existing ones are updated in
 * place. Nothing here touches the canvas or the undo stack — the drawer lists the results and the
 * library shows the new diagrams.
 */
export async function persistSideDocument(
  deps: SideDocumentDeps,
  changeSet: ChangeSet,
  created: DocumentInfo | undefined,
): Promise<SideDocumentOutcome> {
  const id = changeSet.diagramId;
  try {
    if (!(await deps.repo.get(id))) {
      if (!created) return { ok: false, id, error: `Unknown document "${id}"` };
      await deps.repo.create(
        createDiagram({ id, name: created.name, type: created.type, now: deps.now() }),
      );
    }
    const first = await deps.repo.applyAndPersist(id, changeSet, {
      snapshot: 'ai-run',
      ...(changeSet.summary ? { label: changeSet.summary } : {}),
      ...(changeSet.runId ? { runId: changeSet.runId } : {}),
    });
    if (!first.ok) return { ok: false, id, error: first.error.message };
    const applied = [changeSet];
    let diagram = first.diagram;
    if (first.layoutRequest) {
      const { changeSet: layoutCs } = await runLayout(diagram, first.layoutRequest, {
        measurer: deps.measurer ?? DefaultMeasurer,
        affected: first.affected,
        ...(deps.engine ? { engine: deps.engine } : {}),
        ...(changeSet.runId ? { runId: changeSet.runId } : {}),
        now: deps.now,
      });
      if (layoutCs) {
        const second = await deps.repo.applyAndPersist(
          id,
          layoutCs,
          changeSet.runId ? { runId: changeSet.runId } : {},
        );
        if (second.ok) {
          diagram = second.diagram;
          applied.push(layoutCs);
        }
      }
    }
    if (created && diagram.renderer.preferred !== deps.renderer) {
      diagram = (
        await deps.repo.updateRenderer(id, { ...diagram.renderer, preferred: deps.renderer })
      ).ir;
    }
    return { ok: true, id, diagram, changeSets: applied };
  } catch (error) {
    return { ok: false, id, error: error instanceof Error ? error.message : String(error) };
  }
}
