import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

/**
 * Spec 04 §6.3: one `updateScene` per patch. Upserts keep the old element's identity fields so
 * Excalidraw sees an update rather than a new element; soft deletes preserve undo; everything
 * else is passed through by reference.
 */
export function mergeById(
  scene: readonly ExcalidrawElement[],
  patch: { upsert: readonly ExcalidrawElement[]; softDelete: readonly string[] },
): ExcalidrawElement[] {
  const upserts = new Map(patch.upsert.map((el) => [el.id, el]));
  const deletes = new Set(patch.softDelete);
  const out: ExcalidrawElement[] = [];
  for (const el of scene) {
    const next = upserts.get(el.id);
    if (next) {
      upserts.delete(el.id);
      out.push({
        ...next,
        seed: el.seed,
        versionNonce: el.versionNonce,
        index: el.index,
        version: el.version + 1,
      } as ExcalidrawElement);
    } else if (deletes.has(el.id) && !el.isDeleted) {
      out.push({ ...el, isDeleted: true, version: el.version + 1 } as ExcalidrawElement);
    } else {
      out.push(el);
    }
  }
  for (const el of upserts.values()) out.push(el);
  return out;
}
