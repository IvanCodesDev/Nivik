import type { DiagramSummary } from '@nivik/storage';
import { FOLDER_TINTS, type FolderTint } from '@nivik/ui';

/** What the Library shows per diagram: the record minus its document and thumbnail. */
export type LibraryItem = DiagramSummary;

/**
 * PRD §5.3 display groups. `diagram.type` is an open label written by the agent's plan; these
 * groups only decide which filter chip a common value falls under. Anything outside the table
 * (including `generic`) shows under All only. Adjustable, not a taxonomy.
 */
export const LIBRARY_GROUPS = {
  architecture: ['architecture', 'deployment', 'c4'],
  system: ['network', 'class', 'component'],
  flow: ['flow', 'state', 'swimlane', 'bpmn'],
  data: ['dataflow', 'erd'],
  sequence: ['sequence'],
} as const;
export type LibraryGroup = keyof typeof LIBRARY_GROUPS;

export const LIBRARY_FILTERS = [
  'all',
  'architecture',
  'flow',
  'system',
  'data',
  'sequence',
  'favorite',
] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

const GROUP_BY_TYPE: ReadonlyMap<string, LibraryGroup> = new Map(
  (Object.keys(LIBRARY_GROUPS) as LibraryGroup[]).flatMap((group) =>
    LIBRARY_GROUPS[group].map((type): [string, LibraryGroup] => [type, group]),
  ),
);

export const groupOf = (type: string): LibraryGroup | null => GROUP_BY_TYPE.get(type) ?? null;

export const LIBRARY_SORTS = ['edited', 'created', 'name', 'type'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

/** "Recently edited" counts opening a diagram as touching it (spec 07 §4: `lastOpenedAt` first). */
export const touchedAt = (item: LibraryItem): number =>
  Math.max(item.updatedAt, item.lastOpenedAt ?? 0);

const byName = (a: LibraryItem, b: LibraryItem) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) ||
  a.id.localeCompare(b.id);

/** A new array; ties always break the same way so the grid never shuffles. */
export function sortItems(items: readonly LibraryItem[], sort: LibrarySort): LibraryItem[] {
  const list = [...items];
  switch (sort) {
    case 'edited':
      return list.sort((a, b) => touchedAt(b) - touchedAt(a) || byName(a, b));
    case 'created':
      return list.sort((a, b) => b.createdAt - a.createdAt || byName(a, b));
    case 'name':
      return list.sort(byName);
    case 'type':
      return list.sort(
        (a, b) => a.type.localeCompare(b.type) || touchedAt(b) - touchedAt(a) || byName(a, b),
      );
  }
}

export function matchesFilter(item: LibraryItem, filter: LibraryFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'favorite') return item.favorite;
  return groupOf(item.type) === filter;
}

/** Name search (PRD §5.3); node text and semantic metadata come later. */
export function filterItems(
  items: readonly LibraryItem[],
  filter: LibraryFilter,
  query: string,
): LibraryItem[] {
  const q = query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      matchesFilter(item, filter) && (q === '' || item.name.toLocaleLowerCase().includes(q)),
  );
}

/** Stable pastel per diagram: the id decides, so a card keeps its colour across sessions. */
export function tintFor(id: string): FolderTint {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return FOLDER_TINTS[hash % FOLDER_TINTS.length] ?? FOLDER_TINTS[0];
}
