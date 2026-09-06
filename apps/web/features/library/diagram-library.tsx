'use client';

import { IconButton } from '@nivik/ui';
import { MagnifyingGlass, SlidersHorizontal } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import { type CategoryFilter, filterDiagrams, SAMPLE_DIAGRAMS } from '@/lib/data/diagrams';
import { CategoryFilters } from './category-filters';
import { DiagramGrid } from './diagram-grid';
import styles from './library.module.css';

/** Diagram Library (PRD 5.3): every diagram, searchable and filterable. */
export function DiagramLibrary() {
  const [category, setCategory] = useState<CategoryFilter['id']>('all');
  const [query, setQuery] = useState('');
  const [tuneOpen, setTuneOpen] = useState(false);

  const visible = useMemo(
    () => filterDiagrams(SAMPLE_DIAGRAMS, category, query),
    [category, query],
  );

  return (
    <main className="nv-page-main">
      <div className="nv-page-heading">
        <h1>Diagram Library</h1>
        <p>All your diagrams in one place. Organize, access, and collaborate.</p>
      </div>

      <form className={styles.search} role="search" onSubmit={(event) => event.preventDefault()}>
        <span className={styles.searchIcon}>
          <MagnifyingGlass size={20} aria-hidden="true" />
        </span>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search diagrams..."
          aria-label="Search diagrams"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <IconButton
          className={styles.tune}
          aria-label="Search filters"
          size="md"
          onClick={() => setTuneOpen(true)}
        >
          <SlidersHorizontal size={21} aria-hidden="true" />
        </IconButton>
      </form>

      <CategoryFilters value={category} onChange={setCategory} />

      <DiagramGrid diagrams={visible} />

      <ChoiceDialog
        open={tuneOpen}
        onOpenChange={setTuneOpen}
        title="Search filters"
        description="Narrow results using the category buttons below the search box."
      />
    </main>
  );
}
