import { type Diagram, type Id, newDiagramId, parseDiagram } from '@nivik/ir';
import authentication from '../data/authentication.nivik.json';
import database from '../data/database.nivik.json';
import ecommerce from '../data/ecommerce.nivik.json';
import journey from '../data/journey.nivik.json';
import microservices from '../data/microservices.nivik.json';
import network from '../data/network.nivik.json';
import pipeline from '../data/pipeline.nivik.json';
import validation from '../data/validation.nivik.json';

export const TEMPLATE_CATEGORIES = [
  'Architecture',
  'Flowchart',
  'Business Flow',
  'Data Flow',
  'ERD',
  'Sequence',
  'System',
  'Mind Map',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** Categories that exist in the gallery switcher but have no templates yet. */
export const COMING_SOON_CATEGORIES: readonly TemplateCategory[] = ['Mind Map'];

/**
 * Template IR coordinates are authored at this multiple of the gallery card's preview pixels,
 * so a card can draw the diagram by dividing positions and sizes by the scale.
 */
export const TEMPLATE_PREVIEW_SCALE = 2;

export interface TemplatePreview {
  /** Card viewport in preview pixels. */
  width: number;
  height: number;
}

export interface TemplateEntry {
  id: string;
  title: string;
  description: string;
  category: TemplateCategory;
  featured: boolean;
  /** Card background tint. */
  wash: string;
  preview: TemplatePreview;
  /** The template document itself; treat as read-only and copy it with `instantiateTemplate`. */
  diagram: Diagram;
}

interface EntryInit {
  id: string;
  category: TemplateCategory;
  wash: string;
  preview: TemplatePreview;
  raw: unknown;
  featured?: boolean;
}

function entry({ id, category, wash, preview, raw, featured = false }: EntryInit): TemplateEntry {
  const diagram = parseDiagram(raw);
  return Object.freeze({
    id,
    title: diagram.name,
    description: diagram.description ?? '',
    category,
    featured,
    wash,
    preview,
    diagram,
  });
}

/** Built-in templates (spec 06 §5), in gallery order. */
export const TEMPLATES: readonly TemplateEntry[] = [
  entry({
    id: 'microservices',
    category: 'Architecture',
    featured: true,
    wash: '#f6f0fc',
    preview: { width: 500, height: 510 },
    raw: microservices,
  }),
  entry({
    id: 'authentication',
    category: 'Flowchart',
    wash: '#f5eefb',
    preview: { width: 500, height: 435 },
    raw: authentication,
  }),
  entry({
    id: 'validation',
    category: 'Flowchart',
    wash: '#fdf0f5',
    preview: { width: 500, height: 435 },
    raw: validation,
  }),
  entry({
    id: 'journey',
    category: 'Business Flow',
    wash: '#faf5f1',
    preview: { width: 500, height: 260 },
    raw: journey,
  }),
  entry({
    id: 'ecommerce',
    category: 'System',
    wash: '#edf9f5',
    preview: { width: 500, height: 315 },
    raw: ecommerce,
  }),
  entry({
    id: 'database',
    category: 'ERD',
    wash: '#f7f0fc',
    preview: { width: 500, height: 385 },
    raw: database,
  }),
  entry({
    id: 'pipeline',
    category: 'Flowchart',
    wash: '#eff5fc',
    preview: { width: 600, height: 270 },
    raw: pipeline,
  }),
  entry({
    id: 'network',
    category: 'System',
    wash: '#f8effc',
    preview: { width: 500, height: 330 },
    raw: network,
  }),
];

export function findTemplate(id: string | null | undefined): TemplateEntry | undefined {
  return id ? TEMPLATES.find((t) => t.id === id) : undefined;
}

export interface InstantiateOptions {
  /** Id for the new diagram; a fresh `d_…` id by default. */
  id?: Id;
  /** Epoch ms stamped on the copy; defaults to `Date.now()`. */
  now?: number;
}

/**
 * "Use template" (spec 06 §5): a deep copy of the template document under a new id, at version 1,
 * with every element attributed to `import` at `now`. The caller persists it as the first version.
 */
export function instantiateTemplate(entry: TemplateEntry, opts: InstantiateOptions = {}): Diagram {
  const now = opts.now ?? Date.now();
  const source = structuredClone(entry.diagram);
  const meta = { createdBy: 'import' as const, createdAt: now, updatedAt: now, rev: 0 };
  return {
    ...source,
    id: opts.id ?? newDiagramId(),
    version: 1,
    nodes: source.nodes.map((n) => ({ ...n, meta })),
    edges: source.edges.map((e) => ({ ...e, meta })),
    groups: source.groups.map((g) => ({ ...g, meta })),
    meta: { createdAt: now, updatedAt: now },
  };
}
