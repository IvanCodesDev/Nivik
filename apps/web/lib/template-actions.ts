import type { Diagram, RendererId } from '@nivik/ir';
import type { DiagramRecord, DiagramRepository } from '@nivik/storage';
import { findTemplate, instantiateTemplate } from '@nivik/templates';

export interface CreateFromTemplateOptions {
  /** Renderer the user picked in the template dialog; becomes the new diagram's preference. */
  renderer?: RendererId;
  now?: () => number;
}

/**
 * "Use Template" (spec 06 §5): the template document copied under a new id at version 1 and stored
 * with its `import` snapshot. The canvas then opens an existing diagram — it never has to know
 * where the content came from.
 */
export async function createFromTemplate(
  repo: DiagramRepository,
  templateId: string,
  opts: CreateFromTemplateOptions = {},
): Promise<DiagramRecord> {
  const entry = findTemplate(templateId);
  if (!entry) throw new Error(`Unknown template "${templateId}"`);
  const now = opts.now ?? Date.now;
  const draft = instantiateTemplate(entry, { now: now() });
  const ir: Diagram = opts.renderer
    ? { ...draft, renderer: { preferred: opts.renderer, state: {} } }
    : draft;
  return repo.create(ir);
}
