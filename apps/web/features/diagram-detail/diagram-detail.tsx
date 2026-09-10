'use client';

import type { ChangeSetRecord, DiagramRecord, SourceRecord, VersionRecord } from '@nivik/storage';
import { Button, IconButton, Pill, useToast } from '@nivik/ui';
import { ArrowLeft, ArrowSquareOut, PencilSimple, Star } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import { DiagramPreview } from '@/components/diagram-preview';
import { PromptDialog } from '@/components/prompt-dialog';
import { type DiagramFileFormat, exportDiagramFile } from '@/lib/diagram-files';
import { download } from '@/lib/download';
import { type ChangeCounts, compareVersions, describeChangeSet, totalChanges } from '@/lib/history';
import { formatInteger, formatRelativePast } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/provider';
import {
  deleteDiagram,
  duplicateStoredDiagram,
  MAX_DIAGRAM_NAME,
  renameDiagram,
  setFavorite,
} from '@/lib/library-actions';
import { getRepository } from '@/lib/repository';
import { useLiveQuery } from '@/lib/use-live-query';
import styles from './diagram-detail.module.css';

interface DiagramDetailProps {
  diagramId: string;
}

type Pending =
  | { kind: 'rename' }
  | { kind: 'export' }
  | { kind: 'delete' }
  | { kind: 'save-version' }
  | { kind: 'restore'; version: VersionRecord }
  | { kind: 'compare'; version: VersionRecord; counts: ChangeCounts; identical: boolean }
  | null;

/** Everything the page shows, read live so a change from the canvas in another tab shows up. */
function useDetailData(diagramId: string) {
  const record = useLiveQuery(
    () =>
      getRepository()
        .get(diagramId)
        .then((found) => found ?? null),
    [diagramId],
  );
  const versions = useLiveQuery(() => getRepository().listVersions(diagramId), [diagramId]);
  const changeSets = useLiveQuery(() => getRepository().listChangeSets(diagramId), [diagramId]);
  const sources = useLiveQuery(() => getRepository().listSources(diagramId), [diagramId]);
  return { record, versions, changeSets, sources };
}

export function DiagramDetail({ diagramId }: DiagramDetailProps) {
  const t = useT();
  const copy = t.detail;
  const { record, versions, changeSets, sources } = useDetailData(diagramId);

  if (record === undefined) return <main className="nv-page-main" aria-busy="true" />;
  if (record === null) {
    return (
      <main className="nv-page-main">
        <div className="nv-page-heading">
          <h1>{copy.missingTitle}</h1>
          <p>{copy.missingText}</p>
        </div>
        <Link href="/library" className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" /> {copy.backToLibrary}
        </Link>
      </main>
    );
  }
  return (
    <DetailBody
      record={record}
      versions={versions ?? []}
      changeSets={changeSets ?? []}
      sources={sources ?? []}
    />
  );
}

interface DetailBodyProps {
  record: DiagramRecord;
  versions: VersionRecord[];
  changeSets: ChangeSetRecord[];
  sources: SourceRecord[];
}

function DetailBody({ record, versions, changeSets, sources }: DetailBodyProps) {
  const t = useT();
  const copy = t.detail;
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const { ir } = record;
  const closePending = (open: boolean) => {
    if (!open) setPending(null);
  };
  const date = (at: number | undefined) =>
    at === undefined
      ? copy.never
      : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
  const ago = (at: number) => formatRelativePast(Date.now() - at, locale) ?? t.library.justNow;
  const count = (n: number) => formatInteger(n, locale);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    try {
      const message = await work();
      if (message) toast(message);
    } catch (error) {
      toast(t.library.actionFailed(error instanceof Error ? error.message : String(error)), {
        tone: 'light',
      });
    } finally {
      setBusy(false);
    }
  };

  const exportAs = (format: DiagramFileFormat) =>
    void run(async () => {
      const file = await exportDiagramFile(ir, format);
      download(file.blob, file.filename);
      return t.library.exported(file.filename);
    });

  const newestFirst = [...versions].sort((a, b) => b.version - a.version);
  const changesNewestFirst = [...changeSets].sort((a, b) => b.resultVersion - a.resultVersion);
  const currentSnapshot = versions.some((v) => v.version === record.version);

  const countsText = (counts: ChangeCounts) => {
    const parts: string[] = [];
    if (counts.added) parts.push(copy.counts.added(counts.added));
    if (counts.updated) parts.push(copy.counts.updated(counts.updated));
    if (counts.deleted) parts.push(copy.counts.deleted(counts.deleted));
    if (counts.layout) parts.push(copy.counts.layout(counts.layout));
    if (counts.diagram) parts.push(copy.counts.diagram(counts.diagram));
    return parts.join(' · ');
  };

  return (
    <main className="nv-page-main">
      <Link href="/library" className={styles.backLink}>
        <ArrowLeft size={16} aria-hidden="true" /> {copy.backToLibrary}
      </Link>

      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{record.name}</h1>
            <IconButton
              size="sm"
              aria-label={t.library.rename}
              disabled={busy}
              onClick={() => setPending({ kind: 'rename' })}
            >
              <PencilSimple size={18} aria-hidden="true" />
            </IconButton>
            <IconButton
              size="sm"
              aria-label={record.favorite ? t.library.unfavorite : t.library.favorite}
              aria-pressed={record.favorite}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await setFavorite(getRepository(), record.id, !record.favorite);
                  return record.favorite
                    ? t.library.unfavorited(record.name)
                    : t.library.favorited(record.name);
                })
              }
            >
              <Star size={18} weight={record.favorite ? 'fill' : 'regular'} aria-hidden="true" />
            </IconButton>
          </div>
          <div className={styles.badges}>
            <Pill>{record.type}</Pill>
            <Pill>{ir.renderer.preferred}</Pill>
            <Pill>{copy.versionBadge(record.version)}</Pill>
            <span className={styles.muted}>{copy.editedAgo(ago(record.updatedAt))}</span>
          </div>
          {ir.description && <p className={styles.description}>{ir.description}</p>}
        </div>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => router.push(`/canvas/${record.id}`)}>
            <ArrowSquareOut size={16} aria-hidden="true" /> {copy.openInCanvas}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const copyRecord = await duplicateStoredDiagram(
                  getRepository(),
                  record.id,
                  t.library.duplicateName(record.name),
                );
                router.push(`/diagram/${copyRecord.id}`);
                return t.library.duplicated(copyRecord.name);
              })
            }
          >
            {t.library.duplicate}
          </Button>
          <Button disabled={busy} onClick={() => setPending({ kind: 'export' })}>
            {t.library.export}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => setPending({ kind: 'delete' })}>
            {t.library.delete}
          </Button>
        </div>
      </header>

      <div className={styles.grid}>
        <section className={styles.card} aria-label={copy.preview}>
          <h2 className={styles.cardTitle}>{copy.preview}</h2>
          <div className={styles.previewFrame}>
            {ir.nodes.length === 0 ? (
              <p className={styles.empty}>{copy.previewEmpty}</p>
            ) : (
              <DiagramPreview diagram={ir} />
            )}
          </div>
        </section>

        <section className={styles.card} aria-label={copy.info}>
          <h2 className={styles.cardTitle}>{copy.info}</h2>
          <dl className={styles.facts}>
            <Fact label={copy.facts.type} value={record.type} />
            <Fact label={copy.facts.renderer} value={ir.renderer.preferred} />
            <Fact
              label={copy.facts.layout}
              value={`${ir.layout.algorithm} · ${ir.layout.direction}`}
            />
            <Fact label={copy.facts.version} value={count(record.version)} />
            <Fact
              label={copy.facts.elements}
              value={copy.elements(
                count(ir.nodes.length),
                count(ir.edges.length),
                count(ir.groups.length),
              )}
            />
            <Fact label={copy.facts.created} value={date(record.createdAt)} />
            <Fact label={copy.facts.edited} value={date(record.updatedAt)} />
            <Fact label={copy.facts.opened} value={date(record.lastOpenedAt)} />
            <Fact
              label={copy.facts.tags}
              value={record.tags.length ? record.tags.join(', ') : copy.none}
            />
          </dl>
        </section>

        <section className={styles.card} aria-label={copy.sources}>
          <h2 className={styles.cardTitle}>{copy.sources}</h2>
          {sources.length === 0 ? (
            <p className={styles.empty}>{copy.sourcesEmpty}</p>
          ) : (
            <ul className={styles.list}>
              {sources.map((source) => (
                <li key={source.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTitle}>
                      <Pill>{copy.sourceKinds[source.kind]}</Pill>
                      <span>{source.title || source.ref}</span>
                    </div>
                    <div className={styles.rowMeta}>
                      {source.ref} · {date(source.addedAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.card} aria-label={copy.versions}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>{copy.versions}</h2>
            <Button size="sm" disabled={busy} onClick={() => setPending({ kind: 'save-version' })}>
              {copy.saveVersion}
            </Button>
          </div>
          <p className={styles.hint}>{currentSnapshot ? copy.currentSaved : copy.currentUnsaved}</p>
          <ul className={styles.list}>
            {newestFirst.map((version) => {
              const isCurrent = version.version === record.version;
              return (
                <li key={version.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTitle}>
                      <strong>{copy.versionBadge(version.version)}</strong>
                      <Pill>{copy.reasons[version.reason]}</Pill>
                      {isCurrent && <Pill className={styles.currentPill}>{copy.current}</Pill>}
                      {version.label && <span className={styles.label}>{version.label}</span>}
                    </div>
                    <div className={styles.rowMeta}>
                      {date(version.createdAt)} ·{' '}
                      {copy.elements(
                        count(version.ir.nodes.length),
                        count(version.ir.edges.length),
                        count(version.ir.groups.length),
                      )}
                    </div>
                  </div>
                  <div className={styles.rowActions}>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isCurrent && !currentSnapshot}
                      onClick={() => {
                        const comparison = compareVersions(version.ir, ir);
                        setPending({
                          kind: 'compare',
                          version,
                          counts: comparison.counts,
                          identical: comparison.identical,
                        });
                      }}
                    >
                      {copy.compare}
                    </Button>
                    {!isCurrent && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => setPending({ kind: 'restore', version })}
                      >
                        {copy.restore}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={`${styles.card} ${styles.wide}`} aria-label={copy.changes}>
          <h2 className={styles.cardTitle}>{copy.changes}</h2>
          {changesNewestFirst.length === 0 ? (
            <p className={styles.empty}>{copy.changesEmpty}</p>
          ) : (
            <ul className={styles.list}>
              {changesNewestFirst.map((cs) => {
                const described = describeChangeSet(cs);
                return (
                  <li key={cs.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <div className={styles.rowTitle}>
                        <Pill className={styles[`origin_${described.origin}`]}>
                          {copy.origins[described.origin]}
                        </Pill>
                        <span>
                          {described.summary ?? (countsText(described.counts) || copy.noSummary)}
                        </span>
                      </div>
                      <div className={styles.rowMeta}>
                        {copy.versionArrow(cs.baseVersion, cs.resultVersion)} · {date(cs.createdAt)}
                        {described.summary && totalChanges(described.counts) > 0
                          ? ` · ${countsText(described.counts)}`
                          : ''}
                        {described.highlights.length > 0
                          ? ` · ${described.highlights.join(', ')}`
                          : ''}
                        {described.runId ? ` · ${copy.run(described.runId)}` : ''}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <PromptDialog
        open={pending?.kind === 'rename'}
        onOpenChange={closePending}
        title={t.library.renameTitle}
        description={t.library.renameDescription}
        label={t.library.nameLabel}
        initialValue={record.name}
        maxLength={MAX_DIAGRAM_NAME}
        confirmLabel={t.library.rename}
        onConfirm={(name) =>
          void run(async () => {
            const renamed = await renameDiagram(getRepository(), record.id, name);
            return t.library.renamed(renamed.name);
          })
        }
      />

      <PromptDialog
        open={pending?.kind === 'save-version'}
        onOpenChange={closePending}
        title={copy.saveVersionTitle}
        description={copy.saveVersionText}
        label={copy.versionLabel}
        placeholder={copy.versionLabelPlaceholder}
        maxLength={80}
        confirmLabel={copy.saveVersion}
        onConfirm={(label) =>
          void run(async () => {
            const saved = await getRepository().saveVersion(record.id, { reason: 'manual', label });
            return copy.versionSaved(saved.version);
          })
        }
      />

      <ChoiceDialog
        open={pending?.kind === 'export'}
        onOpenChange={closePending}
        title={t.library.exportTitle(record.name)}
        description={t.library.exportDescription}
        layout="stack"
        actions={[
          { label: t.library.exportNivik, variant: 'primary', onSelect: () => exportAs('nivik') },
          { label: t.library.exportExcalidraw, onSelect: () => exportAs('excalidraw') },
        ]}
      />

      <ChoiceDialog
        open={pending?.kind === 'delete'}
        onOpenChange={closePending}
        title={t.library.deleteTitle(record.name)}
        description={t.library.deleteDescription}
        actions={[
          { label: t.common.cancel, onSelect: () => {} },
          {
            label: t.library.deleteConfirm,
            variant: 'danger',
            onSelect: () =>
              void run(async () => {
                await deleteDiagram(getRepository(), record.id);
                router.push('/library');
                return t.library.deleted(record.name);
              }),
          },
        ]}
      />

      <ChoiceDialog
        open={pending?.kind === 'restore'}
        onOpenChange={closePending}
        title={pending?.kind === 'restore' ? copy.restoreTitle(pending.version.version) : ''}
        description={copy.restoreText}
        actions={[
          { label: t.common.cancel, onSelect: () => {} },
          {
            label: copy.restoreConfirm,
            variant: 'primary',
            onSelect: () => {
              if (pending?.kind !== 'restore') return;
              const target = pending.version;
              void run(async () => {
                const result = await getRepository().restore(record.id, target.version, {
                  label: copy.restoredLabel(target.version),
                });
                if (!result.ok) throw new Error(result.error.message);
                return 'unchanged' in result
                  ? copy.restoreUnchanged
                  : copy.restored(target.version, result.record.version);
              });
            },
          },
        ]}
      />

      <ChoiceDialog
        open={pending?.kind === 'compare'}
        onOpenChange={closePending}
        title={pending?.kind === 'compare' ? copy.compareTitle(pending.version.version) : ''}
        description={
          pending?.kind === 'compare'
            ? pending.identical
              ? copy.compareIdentical
              : copy.compareText(countsText(pending.counts))
            : ''
        }
      />
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
