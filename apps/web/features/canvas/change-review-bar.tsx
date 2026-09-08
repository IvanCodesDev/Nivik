'use client';

import { Button } from '@nivik/ui';
import { ArrowCounterClockwise, Check, ListMagnifyingGlass } from '@phosphor-icons/react';
import { useT } from '@/lib/i18n/provider';
import type { ReviewState } from '@/lib/stores/run-store';
import styles from './canvas.module.css';

interface ChangeReviewBarProps {
  review: ReviewState;
  /** False once the user edited after the run: the run is no longer the latest history group. */
  canUndo: boolean;
  onAccept(): void;
  onUndo(): void;
  onDetails(): void;
}

/** PRD 6.4 / spec 07 §3 `<ChangeReviewBar/>`, minimal: summary · Accept · Undo run · Details. */
export function ChangeReviewBar({
  review,
  canUndo,
  onAccept,
  onUndo,
  onDetails,
}: ChangeReviewBarProps) {
  const t = useT();
  const { added, modified, deleted } = review.affected;
  const count = added.length + modified.length + deleted.length;
  return (
    <div className={styles.reviewBar} role="region" aria-label={t.canvas.reviewSummary(count)}>
      <div className={styles.reviewText}>
        <strong className={styles.reviewTitle}>{t.canvas.reviewSummary(count)}</strong>
        {review.summary && <span className={styles.reviewSummary}>{review.summary}</span>}
      </div>
      <div className={styles.reviewActions}>
        <Button variant="ghost" size="sm" onClick={onDetails}>
          <ListMagnifyingGlass size={16} aria-hidden="true" />
          {t.canvas.viewDetails}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onUndo}
          disabled={!canUndo}
          title={canUndo ? undefined : t.canvas.undoUnavailable}
        >
          <ArrowCounterClockwise size={16} aria-hidden="true" />
          {t.canvas.undoRun}
        </Button>
        <Button variant="primary" size="sm" onClick={onAccept}>
          <Check size={16} weight="bold" aria-hidden="true" />
          {t.canvas.accept}
        </Button>
      </div>
    </div>
  );
}
