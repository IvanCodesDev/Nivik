'use client';

import { IconButton } from '@nivik/ui';
import { MagnifyingGlass, SlidersHorizontal } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import { useT } from '@/lib/i18n/provider';
import { filterItems, LIBRARY_SORTS, type LibraryFilter, sortItems } from '@/lib/library';
import { getRepository } from '@/lib/repository';
import { useLibraryPrefs } from '@/lib/stores/library-prefs-store';
import { useLiveQuery } from '@/lib/use-live-query';
import { CategoryFilters } from './category-filters';
import { DiagramGrid } from './diagram-grid';
import styles from './library.module.css';

/**
 * Diagram Library (PRD §5.3): every diagram on this device, live from the repository, searchable
 * by name, grouped by the display filters and ordered by the saved sort.
 */
export function DiagramLibrary() {
  const t = useT();
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const [sortOpen, setSortOpen] = useState(false);
  const sort = useLibraryPrefs((s) => s.sort);
  const setSort = useLibraryPrefs((s) => s.setSort);

  const items = useLiveQuery(() => getRepository().list(), []);

  const visible = useMemo(
    () => (items ? sortItems(filterItems(items, filter, query), sort) : null),
    [items, filter, query, sort],
  );

  const emptyText =
    items && items.length === 0
      ? t.library.emptyLibrary
      : filter === 'favorite' && query.trim() === ''
        ? t.library.emptyFavorites
        : t.library.empty;

  return (
    <main className="nv-page-main">
      <div className="nv-page-heading">
        <h1>{t.library.title}</h1>
        <p>{t.library.subtitle}</p>
      </div>

      <form className={styles.search} role="search" onSubmit={(event) => event.preventDefault()}>
        <span className={styles.searchIcon}>
          <MagnifyingGlass size={20} aria-hidden="true" />
        </span>
        <input
          type="search"
          className={styles.searchInput}
          placeholder={t.library.searchPlaceholder}
          aria-label={t.library.searchLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <IconButton
          className={styles.tune}
          aria-label={t.library.sortLabel(t.library.sorts[sort])}
          size="md"
          onClick={() => setSortOpen(true)}
        >
          <SlidersHorizontal size={21} aria-hidden="true" />
        </IconButton>
      </form>

      <CategoryFilters value={filter} onChange={setFilter} />

      {visible && <DiagramGrid diagrams={visible} emptyText={emptyText} />}

      <ChoiceDialog
        open={sortOpen}
        onOpenChange={setSortOpen}
        title={t.library.sortTitle}
        description={t.library.sortDescription}
        layout="stack"
        actions={LIBRARY_SORTS.map((option) => ({
          label: option === sort ? `✓ ${t.library.sorts[option]}` : t.library.sorts[option],
          variant: option === sort ? 'primary' : 'soft',
          onSelect: () => setSort(option),
        }))}
      />
    </main>
  );
}
