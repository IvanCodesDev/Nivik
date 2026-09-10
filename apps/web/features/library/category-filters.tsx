'use client';

import { Chip } from '@nivik/ui';
import { LIBRARY_FILTER_ICONS } from '@/lib/data/diagrams';
import { useT } from '@/lib/i18n/provider';
import { LIBRARY_FILTERS, type LibraryFilter } from '@/lib/library';
import styles from './library.module.css';

interface CategoryFiltersProps {
  value: LibraryFilter;
  onChange: (value: LibraryFilter) => void;
}

/** PRD §5.3 display groups plus Favorites; the groups are a view over the open `type` label. */
export function CategoryFilters({ value, onChange }: CategoryFiltersProps) {
  const t = useT();
  return (
    <nav className={styles.filters} aria-label={t.library.categoriesLabel}>
      {LIBRARY_FILTERS.map((filter) => {
        const Icon = LIBRARY_FILTER_ICONS[filter];
        return (
          <Chip key={filter} tone="ink" active={value === filter} onClick={() => onChange(filter)}>
            <Icon size={18} aria-hidden="true" />
            <span>{t.library.categories[filter]}</span>
          </Chip>
        );
      })}
    </nav>
  );
}
