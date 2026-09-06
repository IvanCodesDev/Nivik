import { type Diagram, type DiagramNode, EntityDataSchema } from '@nivik/ir';
import {
  TEMPLATES as CATALOG,
  findTemplate as findEntry,
  TEMPLATE_PREVIEW_SCALE,
  type TemplateEntry,
} from '@nivik/templates';

export {
  COMING_SOON_CATEGORIES,
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
} from '@nivik/templates';

export type PreviewTone = 'lavender' | 'sky' | 'mint' | 'sand' | 'rose' | 'decision';

/** A node as drawn on a gallery card, in card pixels. */
export interface TemplateNode {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: PreviewTone;
  shape?: 'rect' | 'diamond';
}

export interface TemplateEdge {
  from: number;
  to: number;
  label?: string;
}

/** Gallery projection of a built-in template; `diagram` is the IR document behind it. */
export interface DiagramTemplate {
  id: string;
  title: string;
  category: TemplateEntry['category'];
  description: string;
  /** Card background tint. */
  wash: string;
  featured?: boolean;
  width?: number;
  height: number;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
  diagram: Diagram;
}

const PREVIEW_TONES: ReadonlySet<string> = new Set(['lavender', 'sky', 'mint', 'sand', 'rose']);

const toneOf = (node: DiagramNode): PreviewTone | undefined => {
  if (node.type === 'diamond') return 'decision';
  const palette = node.style?.palette;
  return palette && PREVIEW_TONES.has(palette) ? (palette as PreviewTone) : undefined;
};

/** Cards draw entities as a name line followed by one line per column, marking keys. */
function previewLabel(node: DiagramNode): string {
  if (node.type !== 'entity') return node.label;
  const parsed = EntityDataSchema.safeParse(node.data);
  if (!parsed.success) return node.label;
  const columns = parsed.data.columns.map(
    (c) => `${c.name}${c.pk ? ' (PK)' : c.fk ? ' (FK)' : ''}`,
  );
  return [node.label, ...columns].join('\n');
}

function toPreviewNode(node: DiagramNode): TemplateNode {
  const s = TEMPLATE_PREVIEW_SCALE;
  const preview: TemplateNode = {
    label: previewLabel(node),
    x: (node.position?.x ?? 0) / s,
    y: (node.position?.y ?? 0) / s,
    w: (node.size?.w ?? 0) / s,
    h: (node.size?.h ?? 0) / s,
  };
  const tone = toneOf(node);
  if (tone) preview.tone = tone;
  if (node.type === 'diamond') preview.shape = 'diamond';
  return preview;
}

function toGalleryTemplate(entry: TemplateEntry): DiagramTemplate {
  const { diagram } = entry;
  const indexOf = new Map(diagram.nodes.map((n, i) => [n.id, i] as const));
  const edges: TemplateEdge[] = [];
  for (const e of diagram.edges) {
    const from = indexOf.get(e.source);
    const to = indexOf.get(e.target);
    if (from === undefined || to === undefined) continue;
    edges.push(e.label ? { from, to, label: e.label } : { from, to });
  }
  return {
    id: entry.id,
    title: entry.title,
    category: entry.category,
    description: entry.description,
    wash: entry.wash,
    ...(entry.featured ? { featured: true } : {}),
    width: entry.preview.width,
    height: entry.preview.height,
    nodes: diagram.nodes.map(toPreviewNode),
    edges,
    diagram,
  };
}

/** Built-in templates as shown in the gallery, derived from `@nivik/templates`. */
export const TEMPLATES: readonly DiagramTemplate[] = CATALOG.map(toGalleryTemplate);

export function findTemplate(id: string | null | undefined): DiagramTemplate | undefined {
  const entry = findEntry(id);
  return entry ? TEMPLATES.find((t) => t.id === entry.id) : undefined;
}

/** First line of each node label — used to build starter prompts. */
export function templateNodeNames(template: DiagramTemplate): string[] {
  return template.nodes.map((node) => node.label.split('\n')[0] ?? node.label);
}

/** Starter prompt handed to the canvas composer when a template is used. */
export function templatePrompt(template: DiagramTemplate, withAi: boolean): string {
  const names = templateNodeNames(template);
  return withAi
    ? `Build ${template.title} using this structure: ${names.join(', ')}`
    : names.slice(0, 5).join(' → ');
}
