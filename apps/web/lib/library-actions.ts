import { type ChangeSet, type Diagram, duplicateDiagram, newChangeSetId } from '@nivik/ir';
import type { DiagramRecord, DiagramRepository } from '@nivik/storage';

/** Names are trimmed and bounded like the IR's `name` field (spec 01 §3.1). */
export const MAX_DIAGRAM_NAME = 120;

export class LibraryActionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LibraryActionError';
    this.code = code;
  }
}

export function normalizeDiagramName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_DIAGRAM_NAME);
}

/**
 * Rename is an edit like any other (spec 06 §3: one write path): a user `setDiagram` change set
 * through `applyAndPersist`, so it lands in history, keeps `record.name` in sync and can be undone
 * from the canvas. Returns the new record; a no-op when the name did not change.
 */
export async function renameDiagram(
  repo: DiagramRepository,
  id: string,
  rawName: string,
  now: () => number = Date.now,
): Promise<DiagramRecord> {
  const name = normalizeDiagramName(rawName);
  if (name === '') throw new LibraryActionError('E_EMPTY_NAME', 'Diagram name cannot be empty');
  const current = await repo.require(id);
  if (current.name === name) return current;
  const cs: ChangeSet = {
    id: newChangeSetId(),
    diagramId: id,
    baseVersion: current.version,
    origin: 'user',
    actions: [{ op: 'setDiagram', patch: { name } }],
    summary: `Renamed to "${name}"`,
    createdAt: now(),
  };
  const result = await repo.applyAndPersist(id, cs);
  if (!result.ok) throw new LibraryActionError(result.error.code, result.error.message);
  return result.record;
}

/** A full copy (document, layout, renderer state) as a new diagram with its own `import` snapshot. */
export async function duplicateStoredDiagram(
  repo: DiagramRepository,
  id: string,
  name: string,
  now: () => number = Date.now,
): Promise<DiagramRecord> {
  const source = await repo.require(id);
  const copy: Diagram = duplicateDiagram(source.ir, {
    name: normalizeDiagramName(name),
    now: now(),
  });
  return repo.create(copy, { tags: [...source.tags] });
}

export async function setFavorite(
  repo: DiagramRepository,
  id: string,
  favorite: boolean,
): Promise<DiagramRecord> {
  return repo.update(id, { favorite });
}

/** Removes the diagram with its history, change sets, runs and sources. */
export async function deleteDiagram(repo: DiagramRepository, id: string): Promise<void> {
  await repo.remove(id);
}
