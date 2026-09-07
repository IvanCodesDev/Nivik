import type { DiagramTemplate } from '@/lib/data/templates';
import type { Dictionary } from './dictionaries';

export interface TemplateCopy {
  title: string;
  description: string;
}

/**
 * Localized title/description for a built-in template, falling back to the English copy carried
 * by the template document itself for templates the dictionaries do not know yet.
 */
export function templateCopy(
  t: Dictionary,
  template: Pick<DiagramTemplate, 'id' | 'title' | 'description'>,
): TemplateCopy {
  const catalog = t.templates.catalog as Partial<Record<string, TemplateCopy>>;
  return catalog[template.id] ?? { title: template.title, description: template.description };
}
