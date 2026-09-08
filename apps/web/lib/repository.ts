import { createDiagram, type Id } from '@nivik/ir';
import { type DiagramRecord, DiagramRepository, NivikDB, StorageError } from '@nivik/storage';

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
 * Two concurrent opens of a new id (StrictMode replays effects) both resolve to the same record.
 */
export async function openDiagram(
  repo: DiagramRepository,
  id: Id,
  init: OpenDiagramInit,
): Promise<DiagramRecord> {
  const existing = await repo.get(id);
  if (existing) return repo.update(id, { lastOpenedAt: Date.now() });
  try {
    return await repo.create(createDiagram({ id, name: init.name, type: 'generic' }));
  } catch (error) {
    if (error instanceof StorageError && error.code === 'E_DIAGRAM_EXISTS') return repo.require(id);
    throw error;
  }
}
