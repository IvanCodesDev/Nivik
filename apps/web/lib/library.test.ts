import { FOLDER_TINTS } from '@nivik/ui';
import { describe, expect, it } from 'vitest';
import {
  filterItems,
  groupOf,
  LIBRARY_FILTERS,
  LIBRARY_SORTS,
  type LibraryItem,
  matchesFilter,
  sortItems,
  tintFor,
  touchedAt,
} from './library';

const item = (over: Partial<LibraryItem> & Pick<LibraryItem, 'id'>): LibraryItem => ({
  name: over.id,
  type: 'flow',
  version: 1,
  favorite: false,
  tags: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  ...over,
});

describe('groupOf (PRD §5.3 display groups)', () => {
  it('maps common type labels to their chip and leaves the rest to All', () => {
    expect(groupOf('architecture')).toBe('architecture');
    expect(groupOf('c4')).toBe('architecture');
    expect(groupOf('erd')).toBe('data');
    expect(groupOf('bpmn')).toBe('flow');
    expect(groupOf('class')).toBe('system');
    expect(groupOf('sequence')).toBe('sequence');
    expect(groupOf('generic')).toBeNull();
    expect(groupOf('mindmap')).toBeNull();
    expect(groupOf('user-journey')).toBeNull();
  });

  it('offers every group plus All and Favorite as filters', () => {
    expect(LIBRARY_FILTERS).toEqual([
      'all',
      'architecture',
      'flow',
      'system',
      'data',
      'sequence',
      'favorite',
    ]);
  });
});

describe('filterItems', () => {
  const items = [
    item({ id: 'a', name: 'Checkout flow', type: 'flow' }),
    item({ id: 'b', name: 'Platform', type: 'architecture', favorite: true }),
    item({ id: 'c', name: 'Mind map', type: 'mindmap' }),
    item({ id: 'd', name: 'Login sequence', type: 'sequence', favorite: true }),
  ];

  it('filters by group, favourite and name', () => {
    expect(filterItems(items, 'all', '').map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterItems(items, 'flow', '').map((i) => i.id)).toEqual(['a']);
    expect(filterItems(items, 'favorite', '').map((i) => i.id)).toEqual(['b', 'd']);
    expect(filterItems(items, 'all', '  LOGIN ').map((i) => i.id)).toEqual(['d']);
    expect(filterItems(items, 'favorite', 'plat').map((i) => i.id)).toEqual(['b']);
    expect(matchesFilter(items[2] as LibraryItem, 'data')).toBe(false);
  });
});

describe('sortItems', () => {
  const items = [
    item({ id: 'old', name: 'b-old', type: 'flow', createdAt: 1, updatedAt: 10 }),
    item({
      id: 'opened',
      name: 'a-opened',
      type: 'erd',
      createdAt: 2,
      updatedAt: 5,
      lastOpenedAt: 50,
    }),
    item({ id: 'new', name: 'C-new', type: 'architecture', createdAt: 30, updatedAt: 30 }),
  ];

  it('treats opening as touching for "recently edited"', () => {
    expect(touchedAt(items[1] as LibraryItem)).toBe(50);
    expect(sortItems(items, 'edited').map((i) => i.id)).toEqual(['opened', 'new', 'old']);
  });

  it('sorts by creation, name (case-insensitive) and type', () => {
    expect(sortItems(items, 'created').map((i) => i.id)).toEqual(['new', 'opened', 'old']);
    expect(sortItems(items, 'name').map((i) => i.id)).toEqual(['opened', 'old', 'new']);
    expect(sortItems(items, 'type').map((i) => i.id)).toEqual(['new', 'opened', 'old']);
    expect(LIBRARY_SORTS).toEqual(['edited', 'created', 'name', 'type']);
  });

  it('does not mutate and breaks ties deterministically', () => {
    const twins = [item({ id: 'x', name: 'Same' }), item({ id: 'y', name: 'Same' })];
    const sorted = sortItems(twins, 'edited');
    expect(sorted).not.toBe(twins);
    expect(sorted.map((i) => i.id)).toEqual(['x', 'y']);
    expect(sortItems([...twins].reverse(), 'edited').map((i) => i.id)).toEqual(['x', 'y']);
  });
});

describe('tintFor', () => {
  it('is stable per id and only hands out known tints', () => {
    expect(tintFor('d_abc12345')).toBe(tintFor('d_abc12345'));
    for (const id of ['d_1', 'd_2', 'd_3', 'd_4', 'd_5', 'd_6', 'd_7', 'd_8']) {
      expect(FOLDER_TINTS).toContain(tintFor(id));
    }
    expect(new Set(['d_1', 'd_2', 'd_3', 'd_4', 'd_5'].map(tintFor)).size).toBeGreaterThan(1);
  });
});
