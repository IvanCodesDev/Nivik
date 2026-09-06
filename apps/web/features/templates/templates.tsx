'use client';

import { Chip, cn, Kbd, Pill, useToast } from '@nivik/ui';
import {
  Briefcase,
  Buildings,
  Cpu,
  Database,
  FlowArrow,
  type Icon,
  ListBullets,
  ListNumbers,
  MagnifyingGlass,
  SquaresFour,
  Table,
  TreeStructure,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import type { RendererId } from '@/lib/data/integrations';
import {
  COMING_SOON_CATEGORIES,
  type DiagramTemplate,
  TEMPLATE_CATEGORIES,
  TEMPLATES,
  type TemplateCategory,
  templatePrompt,
} from '@/lib/data/templates';
import { useFavoritesStore } from '@/lib/stores/favorites-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { TemplateCard } from './template-card';
import { TemplateDetailDialog } from './template-detail-dialog';
import styles from './templates.module.css';

type CategoryChoice = 'All Templates' | TemplateCategory;

const CATEGORY_ICONS: Record<CategoryChoice, Icon> = {
  'All Templates': SquaresFour,
  Architecture: Buildings,
  Flowchart: FlowArrow,
  'Business Flow': Briefcase,
  'Data Flow': Database,
  ERD: Table,
  Sequence: ListNumbers,
  System: Cpu,
  'Mind Map': TreeStructure,
};

const CATEGORY_CHOICES: readonly CategoryChoice[] = ['All Templates', ...TEMPLATE_CATEGORIES];

/** Templates (PRD 5.4): proven structures, previewed and handed to the canvas. */
export function Templates() {
  const router = useRouter();
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<CategoryChoice>('All Templates');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<DiagramTemplate | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const favorites = useFavoritesStore((s) => s.ids);
  const toggleFavorite = useFavoritesStore((s) => s.toggle);
  const defaultRenderer = useSettingsStore((s) => s.saved.renderer);
  const rendererId: RendererId = defaultRenderer === 'draw.io' ? 'drawio' : 'excalidraw';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TEMPLATES.filter(
      (t) =>
        (category === 'All Templates' || t.category === category) &&
        (!q || `${t.title} ${t.category} ${t.description}`.toLowerCase().includes(q)),
    );
  }, [category, query]);

  const applyTemplate = (template: DiagramTemplate, renderer: RendererId, withAi: boolean) => {
    const params = new URLSearchParams({
      template: template.id,
      renderer,
      prompt: templatePrompt(template, withAi),
    });
    setSelected(null);
    router.push(`/canvas/new?${params.toString()}`);
  };

  const onToggleFavorite = (template: DiagramTemplate) => {
    const wasFavorite = favorites.includes(template.id);
    toggleFavorite(template.id);
    toast(wasFavorite ? 'Removed from favorites' : 'Saved to favorites', { tone: 'light' });
  };

  return (
    <main className={cn('nv-page-main', styles.main)}>
      <div className="nv-page-heading">
        <h1>Templates</h1>
        <p>Start from proven structures. Build faster from a strong foundation.</p>
      </div>

      <form className={styles.search} role="search" onSubmit={(event) => event.preventDefault()}>
        <MagnifyingGlass size={18} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          placeholder="Search templates..."
          aria-label="Search templates"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Kbd>Ctrl K</Kbd>
      </form>

      <nav className={styles.filters} aria-label="Template categories">
        {CATEGORY_CHOICES.map((choice) => {
          const Icon = CATEGORY_ICONS[choice];
          const coming = COMING_SOON_CATEGORIES.includes(choice as TemplateCategory);
          return (
            <Chip
              key={choice}
              tone="accent"
              active={category === choice}
              onClick={() => setCategory(choice)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{choice}</span>
              {coming && <Pill className={styles.coming}>Coming</Pill>}
            </Chip>
          );
        })}
      </nav>

      <section className={cn(styles.grid, view === 'list' && styles.list)} aria-label="Templates">
        {visible.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            favorite={favorites.includes(template.id)}
            onOpen={() => setSelected(template)}
            onToggleFavorite={() => onToggleFavorite(template)}
          />
        ))}
      </section>
      {visible.length === 0 && (
        <p className={styles.empty}>
          No templates match your search. Try another category or keyword.
        </p>
      )}

      <button type="button" className={styles.help} onClick={() => setHelpOpen(true)}>
        Help
      </button>
      <div className={styles.viewSwitch} role="group" aria-label="View">
        <button
          type="button"
          aria-pressed={view === 'grid'}
          aria-label="Grid view"
          onClick={() => setView('grid')}
        >
          <SquaresFour size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-pressed={view === 'list'}
          aria-label="List view"
          onClick={() => setView('list')}
        >
          <ListBullets size={16} aria-hidden="true" />
        </button>
      </div>

      <TemplateDetailDialog
        template={selected}
        defaultRenderer={rendererId}
        onClose={() => setSelected(null)}
        onUse={applyTemplate}
      />
      <ChoiceDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="Template library"
        description="Search or choose a category, preview a template, then select Use Template to continue on the canvas. Save templates with the button in the upper-right corner of each card."
      />
    </main>
  );
}
