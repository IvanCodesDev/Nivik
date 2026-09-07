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
import { useT } from '@/lib/i18n/provider';
import { templateCopy } from '@/lib/i18n/template-copy';
import { useFavoritesStore } from '@/lib/stores/favorites-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { TemplateCard } from './template-card';
import { TemplateDetailDialog } from './template-detail-dialog';
import styles from './templates.module.css';

const ALL_TEMPLATES = 'all';
type CategoryChoice = typeof ALL_TEMPLATES | TemplateCategory;

const CATEGORY_ICONS: Record<CategoryChoice, Icon> = {
  [ALL_TEMPLATES]: SquaresFour,
  Architecture: Buildings,
  Flowchart: FlowArrow,
  'Business Flow': Briefcase,
  'Data Flow': Database,
  ERD: Table,
  Sequence: ListNumbers,
  System: Cpu,
  'Mind Map': TreeStructure,
};

const CATEGORY_CHOICES: readonly CategoryChoice[] = [ALL_TEMPLATES, ...TEMPLATE_CATEGORIES];

/** Templates (PRD 5.4): proven structures, previewed and handed to the canvas. */
export function Templates() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<CategoryChoice>(ALL_TEMPLATES);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<DiagramTemplate | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const favorites = useFavoritesStore((s) => s.ids);
  const toggleFavorite = useFavoritesStore((s) => s.toggle);
  const rendererId: RendererId = useSettingsStore((s) => s.saved.renderer);

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
    return TEMPLATES.filter((template) => {
      if (category !== ALL_TEMPLATES && template.category !== category) return false;
      if (!q) return true;
      const copy = templateCopy(t, template);
      const haystack = [
        template.title,
        template.description,
        template.category,
        copy.title,
        copy.description,
        t.templates.categories[template.category],
      ];
      return haystack.join(' ').toLowerCase().includes(q);
    });
  }, [category, query, t]);

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
    toast(wasFavorite ? t.templates.removedFromFavorites : t.templates.savedToFavorites, {
      tone: 'light',
    });
  };

  return (
    <main className={cn('nv-page-main', styles.main)}>
      <div className="nv-page-heading">
        <h1>{t.templates.title}</h1>
        <p>{t.templates.subtitle}</p>
      </div>

      <form className={styles.search} role="search" onSubmit={(event) => event.preventDefault()}>
        <MagnifyingGlass size={18} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          placeholder={t.templates.searchPlaceholder}
          aria-label={t.templates.searchLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Kbd>Ctrl K</Kbd>
      </form>

      <nav className={styles.filters} aria-label={t.templates.categoriesLabel}>
        {CATEGORY_CHOICES.map((choice) => {
          const Icon = CATEGORY_ICONS[choice];
          const coming =
            choice !== ALL_TEMPLATES && COMING_SOON_CATEGORIES.includes(choice as TemplateCategory);
          return (
            <Chip
              key={choice}
              tone="accent"
              active={category === choice}
              onClick={() => setCategory(choice)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>
                {choice === ALL_TEMPLATES
                  ? t.templates.allTemplates
                  : t.templates.categories[choice]}
              </span>
              {coming && <Pill className={styles.coming}>{t.templates.coming}</Pill>}
            </Chip>
          );
        })}
      </nav>

      <section
        className={cn(styles.grid, view === 'list' && styles.list)}
        aria-label={t.templates.gridLabel}
      >
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
      {visible.length === 0 && <p className={styles.empty}>{t.templates.empty}</p>}

      <button type="button" className={styles.help} onClick={() => setHelpOpen(true)}>
        {t.common.help}
      </button>
      <div className={styles.viewSwitch} role="group" aria-label={t.templates.viewLabel}>
        <button
          type="button"
          aria-pressed={view === 'grid'}
          aria-label={t.templates.gridView}
          onClick={() => setView('grid')}
        >
          <SquaresFour size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-pressed={view === 'list'}
          aria-label={t.templates.listView}
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
        title={t.templates.helpTitle}
        description={t.templates.helpDescription}
      />
    </main>
  );
}
