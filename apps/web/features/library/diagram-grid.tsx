'use client';

import { FolderCard, useToast } from '@nivik/ui';
import { Plus } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import type { DiagramSummary } from '@/lib/data/diagrams';
import { formatRelativePast } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/provider';
import styles from './library.module.css';

interface DiagramGridProps {
  diagrams: readonly DiagramSummary[];
  emptyText?: string;
}

/** Folder grid + "New Diagram" card with the PRD 5.3 card interactions. */
export function DiagramGrid({ diagrams, emptyText }: DiagramGridProps) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [moreFor, setMoreFor] = useState<DiagramSummary | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const openDiagram = (diagram: DiagramSummary) => router.push(`/canvas/${diagram.id}`);
  const editedMeta = (diagram: DiagramSummary) =>
    t.library.edited(formatRelativePast(diagram.editedAgoMs, locale) ?? t.library.justNow);

  return (
    <>
      <section className={styles.grid} aria-label={t.library.gridLabel}>
        {diagrams.map((diagram) => (
          <FolderCard
            key={diagram.id}
            title={diagram.title}
            meta={editedMeta(diagram)}
            tint={diagram.tint}
            openLabel={t.library.open(diagram.title)}
            moreLabel={t.library.moreOptions(diagram.title)}
            onOpen={() => openDiagram(diagram)}
            onMore={() => setMoreFor(diagram)}
          />
        ))}
        <button type="button" className={styles.newCard} onClick={() => setNewOpen(true)}>
          <Plus size={30} weight="bold" aria-hidden="true" />
          <span>{t.library.newDiagram}</span>
        </button>
        {diagrams.length === 0 && <p className={styles.empty}>{emptyText ?? t.library.empty}</p>}
      </section>

      <ChoiceDialog
        open={moreFor !== null}
        onOpenChange={(open) => !open && setMoreFor(null)}
        title={moreFor?.title ?? ''}
        description={t.library.actionsDescription}
        actions={[
          { label: t.library.rename, onSelect: () => toast(t.library.renameSoon) },
          { label: t.library.duplicate, onSelect: () => toast(t.library.duplicateSoon) },
          {
            label: t.library.favorite,
            onSelect: () => toast(t.library.favorited(moreFor?.title ?? t.library.diagramFallback)),
          },
          { label: t.library.viewDetails, onSelect: () => toast(t.library.detailsSoon) },
          {
            label: t.library.delete,
            variant: 'danger',
            onSelect: () => toast(t.library.deleteSoon),
          },
        ]}
      />

      <ChoiceDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title={t.library.newTitle}
        description={t.library.newDescription}
        actions={[
          { label: t.library.startFromScratch, onSelect: () => router.push('/canvas/new') },
          {
            label: t.library.createWithAi,
            onSelect: () => router.push('/canvas/new?focus=composer'),
          },
          { label: t.library.useTemplate, onSelect: () => router.push('/templates') },
        ]}
      />
    </>
  );
}
