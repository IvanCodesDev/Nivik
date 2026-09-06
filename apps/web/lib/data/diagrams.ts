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
  label: string;
  icon: Icon;
}

/** Category filter chips for the Diagram Library (PRD 5.3). */
export const DIAGRAM_CATEGORIES: readonly CategoryFilter[] = [
  { id: 'all', label: 'All', icon: SquaresFour },
  { id: 'architecture', label: 'Architecture', icon: Buildings },
  { id: 'flow', label: 'Flow', icon: FlowArrow },
  { id: 'system', label: 'System', icon: Cpu },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'sequence', label: 'Sequence', icon: ListNumbers },
];

export interface DiagramSummary {
  id: string;
  title: string;
  categories: DiagramCategory[];
  /** Relative edit time as shown on the card (mock data until @nivik/storage lands). */
  editedLabel: string;
  tint: FolderTint;
}

/**
 * Sample library content. Replaced by IndexedDB-backed diagrams in Phase 0.6;
 * kept here so the folder grid, filters and search can be exercised end to end.
 */
export const SAMPLE_DIAGRAMS: readonly DiagramSummary[] = [
  {
    id: 'rag-architecture',
    title: 'RAG Architecture',
    categories: ['architecture'],
    editedLabel: 'Edited just now',
    tint: 'yellow',
  },
  {
    id: 'checkout-flow',
    title: 'Checkout Flow',
    categories: ['flow'],
    editedLabel: 'Edited 2h ago',
    tint: 'lavender',
  },
  {
    id: 'data-platform',
    title: 'Data Platform',
    categories: ['system', 'data'],
    editedLabel: 'Edited yesterday',
    tint: 'mint',
  },
  {
    id: 'service-map',
    title: 'Service Map',
    categories: ['architecture', 'system'],
    editedLabel: 'Edited 2d ago',
    tint: 'coral',
  },
  {
    id: 'org-workflow',
    title: 'Org Workflow',
    categories: ['flow'],
    editedLabel: 'Edited 3d ago',
    tint: 'blue',
  },
  {
    id: 'ai-agent-workflow',
    title: 'AI Agent Workflow',
    categories: ['flow', 'sequence'],
    editedLabel: 'Edited 3d ago',
    tint: 'lavender',
  },
  {
    id: 'user-login-flow',
    title: 'User Login Flow',
    categories: ['flow', 'sequence'],
    editedLabel: 'Edited 4d ago',
    tint: 'cyan',
  },
  {
    id: 'swatch-cream-yellow',
    title: '奶油黄',
    categories: ['architecture'],
    editedLabel: 'Edited just now',
    tint: 'cream-yellow',
  },
  {
    id: 'swatch-apricot',
    title: '杏桃橙',
    categories: ['flow'],
    editedLabel: 'Edited 2h ago',
    tint: 'apricot',
  },
  {
    id: 'swatch-peach',
    title: '蜜桃粉',
    categories: ['sequence'],
    editedLabel: 'Edited yesterday',
    tint: 'peach',
  },
  {
    id: 'swatch-sakura',
    title: '樱花粉',
    categories: ['flow'],
    editedLabel: 'Edited 2d ago',
    tint: 'sakura',
  },
  {
    id: 'swatch-sage',
    title: '鼠尾草绿',
    categories: ['system'],
    editedLabel: 'Edited 3d ago',
    tint: 'sage',
  },
  {
    id: 'swatch-apple',
    title: '苹果浅绿',
    categories: ['data'],
    editedLabel: 'Edited 4d ago',
    tint: 'apple',
  },
  {
    id: 'swatch-sea-salt',
    title: '海盐青',
    categories: ['flow'],
    editedLabel: 'Edited 5d ago',
    tint: 'sea-salt',
  },
  {
    id: 'swatch-glacier',
    title: '冰川蓝',
    categories: ['data'],
    editedLabel: 'Edited 6d ago',
    tint: 'glacier',
  },
  {
    id: 'swatch-sky',
    title: '天空蓝',
    categories: ['system'],
    editedLabel: 'Edited 7d ago',
    tint: 'sky',
  },
  {
    id: 'swatch-gray-lavender',
    title: '灰薰衣草',
    categories: ['sequence'],
    editedLabel: 'Edited 8d ago',
    tint: 'gray-lavender',
  },
  {
    id: 'swatch-milk-tea',
    title: '奶茶棕',
    categories: ['architecture'],
    editedLabel: 'Edited 9d ago',
    tint: 'milk-tea',
  },
  {
    id: 'swatch-fog-green',
    title: '柔雾灰绿',
    categories: ['system'],
    editedLabel: 'Edited 10d ago',
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
