import type { FolderTint } from '@nivik/ui';
import {
  Buildings,
  Cpu,
  Database,
  FlowArrow,
  type Icon,
  ListNumbers,
  SquaresFour,
} from '@phosphor-icons/react';

export type DiagramCategory = 'architecture' | 'flow' | 'system' | 'data' | 'sequence';

export interface CategoryFilter {
  id: 'all' | DiagramCategory;
  icon: Icon;
}

/** Category filter chips for the Diagram Library (PRD 5.3); labels come from `t.library.categories`. */
export const DIAGRAM_CATEGORIES: readonly CategoryFilter[] = [
  { id: 'all', icon: SquaresFour },
  { id: 'architecture', icon: Buildings },
  { id: 'flow', icon: FlowArrow },
  { id: 'system', icon: Cpu },
  { id: 'data', icon: Database },
  { id: 'sequence', icon: ListNumbers },
];

export interface DiagramSummary {
  id: string;
  title: string;
  categories: DiagramCategory[];
  /** How long ago the diagram was last edited (mock data until @nivik/storage lands). */
  editedAgoMs: number;
  tint: FolderTint;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Sample library content. Replaced by IndexedDB-backed diagrams in Phase 0.6;
 * kept here so the folder grid, filters and search can be exercised end to end.
 */
export const SAMPLE_DIAGRAMS: readonly DiagramSummary[] = [
  {
    id: 'rag-architecture',
    title: 'RAG Architecture',
    categories: ['architecture'],
    editedAgoMs: 0,
    tint: 'yellow',
  },
  {
    id: 'checkout-flow',
    title: 'Checkout Flow',
    categories: ['flow'],
    editedAgoMs: 2 * HOUR,
    tint: 'lavender',
  },
  {
    id: 'data-platform',
    title: 'Data Platform',
    categories: ['system', 'data'],
    editedAgoMs: DAY,
    tint: 'mint',
  },
  {
    id: 'service-map',
    title: 'Service Map',
    categories: ['architecture', 'system'],
    editedAgoMs: 2 * DAY,
    tint: 'coral',
  },
  {
    id: 'org-workflow',
    title: 'Org Workflow',
    categories: ['flow'],
    editedAgoMs: 3 * DAY,
    tint: 'blue',
  },
  {
    id: 'ai-agent-workflow',
    title: 'AI Agent Workflow',
    categories: ['flow', 'sequence'],
    editedAgoMs: 3 * DAY,
    tint: 'lavender',
  },
  {
    id: 'user-login-flow',
    title: 'User Login Flow',
    categories: ['flow', 'sequence'],
    editedAgoMs: 4 * DAY,
    tint: 'cyan',
  },
  {
    id: 'swatch-cream-yellow',
    title: '奶油黄',
    categories: ['architecture'],
    editedAgoMs: 0,
    tint: 'cream-yellow',
  },
  {
    id: 'swatch-apricot',
    title: '杏桃橙',
    categories: ['flow'],
    editedAgoMs: 2 * HOUR,
    tint: 'apricot',
  },
  {
    id: 'swatch-peach',
    title: '蜜桃粉',
    categories: ['sequence'],
    editedAgoMs: DAY,
    tint: 'peach',
  },
  {
    id: 'swatch-sakura',
    title: '樱花粉',
    categories: ['flow'],
    editedAgoMs: 2 * DAY,
    tint: 'sakura',
  },
  {
    id: 'swatch-sage',
    title: '鼠尾草绿',
    categories: ['system'],
    editedAgoMs: 3 * DAY,
    tint: 'sage',
  },
  {
    id: 'swatch-apple',
    title: '苹果浅绿',
    categories: ['data'],
    editedAgoMs: 4 * DAY,
    tint: 'apple',
  },
  {
    id: 'swatch-sea-salt',
    title: '海盐青',
    categories: ['flow'],
    editedAgoMs: 5 * DAY,
    tint: 'sea-salt',
  },
  {
    id: 'swatch-glacier',
    title: '冰川蓝',
    categories: ['data'],
    editedAgoMs: 6 * DAY,
    tint: 'glacier',
  },
  {
    id: 'swatch-sky',
    title: '天空蓝',
    categories: ['system'],
    editedAgoMs: 7 * DAY,
    tint: 'sky',
  },
  {
    id: 'swatch-gray-lavender',
    title: '灰薰衣草',
    categories: ['sequence'],
    editedAgoMs: 8 * DAY,
    tint: 'gray-lavender',
  },
  {
    id: 'swatch-milk-tea',
    title: '奶茶棕',
    categories: ['architecture'],
    editedAgoMs: 9 * DAY,
    tint: 'milk-tea',
  },
  {
    id: 'swatch-fog-green',
    title: '柔雾灰绿',
    categories: ['system'],
    editedAgoMs: 10 * DAY,
    tint: 'fog-green',
  },
];

export function filterDiagrams(
  diagrams: readonly DiagramSummary[],
  category: CategoryFilter['id'],
  query: string,
): DiagramSummary[] {
  const q = query.trim().toLowerCase();
  return diagrams.filter(
    (d) =>
      (category === 'all' || d.categories.includes(category)) &&
      (!q || d.title.toLowerCase().includes(q)),
  );
}
