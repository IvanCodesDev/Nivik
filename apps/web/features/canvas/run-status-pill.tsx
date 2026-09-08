'use client';

import { Stop } from '@phosphor-icons/react';
import { useT } from '@/lib/i18n/provider';
import type { RunView } from '@/lib/stores/run-store';
import styles from './canvas.module.css';

interface RunStatusPillProps {
  run: RunView;
  onStop(): void;
  onOpen(): void;
}

/** PRD 9.1 / spec 07 §3: stage name, accepted action count while building, and Stop. */
export function RunStatusPill({ run, onStop, onOpen }: RunStatusPillProps) {
  const t = useT();
  const accepted = run.actions.filter((action) => action.ok).length;
  return (
    <div className={styles.runPill} role="status" aria-live="polite">
      <button
        type="button"
        className={styles.runBody}
        onClick={onOpen}
        aria-label={t.canvas.openDrawer}
      >
        <span className={styles.runDot} aria-hidden="true" />
        <span className={styles.runLabel}>
          {t.canvas.stages[run.stage]}
          {run.stage === 'building' && accepted > 0 ? ` · ${accepted}` : ''}
        </span>
      </button>
      <button type="button" className={styles.runStop} onClick={onStop}>
        <Stop size={12} weight="fill" aria-hidden="true" />
        {t.canvas.stop}
      </button>
    </div>
  );
}
