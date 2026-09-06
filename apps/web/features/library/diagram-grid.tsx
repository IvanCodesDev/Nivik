'use client';

import { FolderCard, useToast } from '@nivik/ui';
import { Plus } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import type { DiagramSummary } from '@/lib/data/diagrams';
import styles from './library.module.css';

interface DiagramGridProps {
  diagrams: readonly DiagramSummary[];
  emptyText?: string;
}

/** Folder grid + "New Diagram" card with the PRD 5.3 card interactions. */
export function DiagramGrid({
  diagrams,
  emptyText = 'No diagrams match your search.',
}: DiagramGridProps) {
  const router = useRouter();
  const toast = useToast();
  const [moreFor, setMoreFor] = useState<DiagramSummary | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const openDiagram = (diagram: DiagramSummary) => router.push(`/canvas/${diagram.id}`);

  return (
    <>
      <section className={styles.grid} aria-label="Diagrams">
        {diagrams.map((diagram) => (
          <FolderCard
            key={diagram.id}
            title={diagram.title}
            meta={diagram.editedLabel}
            tint={diagram.tint}
            onOpen={() => openDiagram(diagram)}
            onMore={() => setMoreFor(diagram)}
          />
        ))}
        <button type="button" className={styles.newCard} onClick={() => setNewOpen(true)}>
          <Plus size={30} weight="bold" aria-hidden="true" />
          <span>New Diagram</span>
        </button>
        {diagrams.length === 0 && <p className={styles.empty}>{emptyText}</p>}
      </section>

      <ChoiceDialog
        open={moreFor !== null}
        onOpenChange={(open) => !open && setMoreFor(null)}
        title={moreFor?.title ?? ''}
        description="Choose an action for this diagram."
        actions={[
          { label: 'Rename', onSelect: () => toast('Rename is coming with local storage.') },
          { label: 'Duplicate', onSelect: () => toast('Duplicate is coming with local storage.') },
          {
            label: 'Favorite',
            onSelect: () => toast(`${moreFor?.title ?? 'Diagram'} added to favorites.`),
          },
          { label: 'View Details', onSelect: () => toast('Diagram Detail is coming soon.') },
          {
            label: 'Delete',
            variant: 'danger',
            onSelect: () => toast('Delete is coming with local storage.'),
          },
        ]}
      />

      <ChoiceDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title="New Diagram"
        description="How would you like to begin?"
        actions={[
          { label: 'Start from scratch', onSelect: () => router.push('/canvas/new') },
          { label: 'Create with AI', onSelect: () => router.push('/canvas/new?focus=composer') },
          { label: 'Use a template', onSelect: () => router.push('/templates') },
        ]}
      />
    </>
  );
}
