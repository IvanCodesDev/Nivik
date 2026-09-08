import { createDiagram, type Id } from '@nivik/ir';
import { type DiagramRecord, DiagramRepository, NivikDB } from '@nivik/storage';

let repository: DiagramRepository | null = null;

/** Browser singleton over the Dexie database; tests inject their own via `setRepository`. */
export function getRepository(): DiagramRepository {
  repository ??= new DiagramRepository(new NivikDB());
  return repository;
}

export function setRepository(repo: DiagramRepository | null): void {
  repository = repo;
}

export interface OpenDiagramInit {
  name: string;
}

/**
 * `/canvas/[id]` lands here: the route allocates the id (`canvas/new/route.ts`), the workspace
 * opens the stored diagram or creates an empty `generic` one that the first run will classify.
 */
export async function openDiagram(
  repo: DiagramRepository,
  id: Id,
  init: OpenDiagramInit,
): Promise<DiagramRecord> {
  const existing = await repo.get(id);
  if (existing) return repo.update(id, { lastOpenedAt: Date.now() });
  return repo.create(createDiagram({ id, name: init.name, type: 'generic' }));
}
