'use client';

import type { DiagramRecord } from '@nivik/storage';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nivik/ui';
import { useEffect, useState } from 'react';
import { formatInteger } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/provider';
import type { LibraryItem } from '@/lib/library';
import { getRepository } from '@/lib/repository';
import styles from './library.module.css';

interface DiagramDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: LibraryItem | null;
}

/** PRD §5.3 "View Details": the record's index fields plus counts read from the stored document. */
export function DiagramDetailsDialog({ open, onOpenChange, item }: DiagramDetailsDialogProps) {
  const t = useT();
  const locale = useLocale();
  const copy = t.library.details;
  const [record, setRecord] = useState<DiagramRecord | null>(null);

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    setRecord(null);
    void getRepository()
      .get(item.id)
      .then((found) => {
        if (!cancelled && found) setRecord(found);
      });
    return () => {
      cancelled = true;
    };
  }, [open, item]);

  const date = (at: number | undefined) =>
    at === undefined
      ? copy.never
      : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(at);

  const rows: [string, string][] = item
    ? [
        [copy.type, item.type],
        [copy.version, formatInteger(item.version, locale)],
        [copy.nodes, record ? formatInteger(record.ir.nodes.length, locale) : '…'],
        [copy.edges, record ? formatInteger(record.ir.edges.length, locale) : '…'],
        [copy.groups, record ? formatInteger(record.ir.groups.length, locale) : '…'],
        [copy.created, date(item.createdAt)],
        [copy.edited, date(item.updatedAt)],
        [copy.opened, date(item.lastOpenedAt)],
        [copy.tags, item.tags.length ? item.tags.join(', ') : copy.none],
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.closeDialog}>
        <DialogTitle>{item?.name ?? ''}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
        <dl className={styles.details}>
          {rows.map(([label, value]) => (
            <div key={label} className={styles.detailsRow}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
