'use client';

import type { FidelityReport } from '@nivik/renderer-core';
import { FolderCard, useToast } from '@nivik/ui';
import { Plus } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useRef, useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import { PromptDialog } from '@/components/prompt-dialog';
import {
  DiagramFileError,
  type DiagramFileFormat,
  exportDiagramFile,
  IMPORT_ACCEPT,
  importDiagramFile,
} from '@/lib/diagram-files';
import { download } from '@/lib/download';
import { formatRelativePast } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/provider';
import { type LibraryItem, tintFor, touchedAt } from '@/lib/library';
import {
  deleteDiagram,
  duplicateStoredDiagram,
  MAX_DIAGRAM_NAME,
  renameDiagram,
  setFavorite,
} from '@/lib/library-actions';
import { getRepository } from '@/lib/repository';
import { DiagramDetailsDialog } from './diagram-details';
import styles from './library.module.css';

interface DiagramGridProps {
  diagrams: readonly LibraryItem[];
  emptyText?: string;
}

type Pending =
  | { kind: 'menu'; item: LibraryItem }
  | { kind: 'rename'; item: LibraryItem }
  | { kind: 'details'; item: LibraryItem }
  | { kind: 'export'; item: LibraryItem }
  | { kind: 'delete'; item: LibraryItem }
  | null;

/** Folder grid + "New Diagram" card with the PRD §5.3 card actions, all through the repository. */
export function DiagramGrid({ diagrams, emptyText }: DiagramGridProps) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [newOpen, setNewOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Spec 04 §4: say what an approximate format dropped, in one line.
  const fidelityNote = (fidelity: FidelityReport | null) => {
    if (!fidelity || fidelity.lossless) return null;
    const count = fidelity.lost.reduce((sum, entry) => sum + entry.ids.length, 0);
    const reasons = fidelity.lost.slice(0, 2).map((entry) => entry.reason);
    return t.library.fidelityLost(count, reasons.join('; '));
  };

  const exportAs = (item: LibraryItem, format: DiagramFileFormat) =>
    void run(async () => {
      const record = await getRepository().require(item.id);
      const file = await exportDiagramFile(record.ir, format);
      download(file.blob, file.filename);
      const note = fidelityNote(file.fidelity);
      return note
        ? `${t.library.exported(file.filename)} ${note}`
        : t.library.exported(file.filename);
    });

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await run(async () => {
      const imported = await importDiagramFile(file);
      const record = await getRepository().create(imported.diagram);
      router.push(`/canvas/${record.id}`);
      const note = fidelityNote(imported.fidelity);
      return note ? `${t.library.imported(record.name)} ${note}` : t.library.imported(record.name);
    });
  };

  const openDiagram = (item: LibraryItem) => router.push(`/canvas/${item.id}`);
  const editedMeta = (item: LibraryItem) => {
    const when = formatRelativePast(Date.now() - touchedAt(item), locale) ?? t.library.justNow;
    const edited = t.library.edited(when);
    return item.favorite ? `★ ${edited}` : edited;
  };

  const run = async (work: () => Promise<string>) => {
    try {
      toast(await work());
    } catch (error) {
      const message =
        error instanceof DiagramFileError && error.code === 'E_UNKNOWN_FORMAT'
          ? t.library.unknownFormat
          : t.library.actionFailed(error instanceof Error ? error.message : String(error));
      toast(message, { tone: 'light' });
    }
  };

  const menuActions = (item: LibraryItem) => [
    { label: t.library.rename, onSelect: () => setPending({ kind: 'rename', item }) },
    {
      label: t.library.duplicate,
      onSelect: () =>
        void run(async () => {
          const copy = await duplicateStoredDiagram(
            getRepository(),
            item.id,
            t.library.duplicateName(item.name),
          );
          return t.library.duplicated(copy.name);
        }),
    },
    {
      label: item.favorite ? t.library.unfavorite : t.library.favorite,
      onSelect: () =>
        void run(async () => {
          await setFavorite(getRepository(), item.id, !item.favorite);
          return item.favorite ? t.library.unfavorited(item.name) : t.library.favorited(item.name);
        }),
    },
    { label: t.library.viewDetails, onSelect: () => setPending({ kind: 'details', item }) },
    { label: t.library.export, onSelect: () => setPending({ kind: 'export', item }) },
    {
      label: t.library.delete,
      variant: 'danger' as const,
      onSelect: () => setPending({ kind: 'delete', item }),
    },
  ];

  const closePending = (open: boolean) => {
    if (!open) setPending(null);
  };

  return (
    <>
      <section className={styles.grid} aria-label={t.library.gridLabel}>
        {diagrams.map((item) => (
          <FolderCard
            key={item.id}
            title={item.name}
            meta={editedMeta(item)}
            tint={tintFor(item.id)}
            openLabel={t.library.open(item.name)}
            moreLabel={t.library.moreOptions(item.name)}
            onOpen={() => openDiagram(item)}
            onMore={() => setPending({ kind: 'menu', item })}
          />
        ))}
        <button type="button" className={styles.newCard} onClick={() => setNewOpen(true)}>
          <Plus size={30} weight="bold" aria-hidden="true" />
          <span>{t.library.newDiagram}</span>
        </button>
        {diagrams.length === 0 && <p className={styles.empty}>{emptyText ?? t.library.empty}</p>}
      </section>

      <ChoiceDialog
        open={pending?.kind === 'menu'}
        onOpenChange={closePending}
        title={pending?.item.name ?? ''}
        description={t.library.actionsDescription}
        actions={pending ? menuActions(pending.item) : []}
      />

      <PromptDialog
        open={pending?.kind === 'rename'}
        onOpenChange={closePending}
        title={t.library.renameTitle}
        description={t.library.renameDescription}
        label={t.library.nameLabel}
        initialValue={pending?.item.name ?? ''}
        maxLength={MAX_DIAGRAM_NAME}
        confirmLabel={t.library.rename}
        onConfirm={(name) => {
          const item = pending?.item;
          if (!item) return;
          void run(async () => {
            const record = await renameDiagram(getRepository(), item.id, name);
            return t.library.renamed(record.name);
          });
        }}
      />

      <DiagramDetailsDialog
        open={pending?.kind === 'details'}
        onOpenChange={closePending}
        item={pending?.kind === 'details' ? pending.item : null}
      />

      <ChoiceDialog
        open={pending?.kind === 'export'}
        onOpenChange={closePending}
        title={t.library.exportTitle(pending?.item.name ?? t.library.diagramFallback)}
        description={t.library.exportDescription}
        layout="stack"
        actions={[
          {
            label: t.library.exportNivik,
            variant: 'primary',
            onSelect: () => pending && exportAs(pending.item, 'nivik'),
          },
          {
            label: t.library.exportExcalidraw,
            onSelect: () => pending && exportAs(pending.item, 'excalidraw'),
          },
        ]}
      />

      <ChoiceDialog
        open={pending?.kind === 'delete'}
        onOpenChange={closePending}
        title={t.library.deleteTitle(pending?.item.name ?? t.library.diagramFallback)}
        description={t.library.deleteDescription}
        actions={[
          { label: t.common.cancel, onSelect: () => {} },
          {
            label: t.library.deleteConfirm,
            variant: 'danger',
            onSelect: () => {
              const item = pending?.item;
              if (!item) return;
              void run(async () => {
                await deleteDiagram(getRepository(), item.id);
                return t.library.deleted(item.name);
              });
            },
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
          { label: t.library.importFile, onSelect: () => fileInput.current?.click() },
        ]}
      />
      <input
        ref={fileInput}
        type="file"
        accept={IMPORT_ACCEPT}
        aria-label={t.library.importFile}
        className={styles.fileInput}
        onChange={(event) => void onImportFile(event)}
      />
    </>
  );
}
