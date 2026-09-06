'use client';

import { Chip } from '@nivik/ui';
import { type CategoryFilter, DIAGRAM_CATEGORIES } from '@/lib/data/diagrams';
import styles from './library.module.css';

interface CategoryFiltersProps {
  value: CategoryFilter['id'];
  onChange: (value: CategoryFilter['id']) => void;
}

export function CategoryFilters({ value, onChange }: CategoryFiltersProps) {
  return (
    <nav className={styles.filters} aria-label="Diagram categories">
      {DIAGRAM_CATEGORIES.map((category) => {
        const Icon = category.icon;
        return (
          <Chip
            key={category.id}
            tone="ink"
            active={value === category.id}
            onClick={() => onChange(category.id)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{category.label}</span>
          </Chip>
        );
      })}
    </nav>
  );
}
