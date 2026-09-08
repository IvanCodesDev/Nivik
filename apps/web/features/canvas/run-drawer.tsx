'use client';

import { cn, IconButton } from '@nivik/ui';
import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useT } from '@/lib/i18n/provider';
import type { RunView } from '@/lib/stores/run-store';
import styles from './canvas.module.css';

interface RunDrawerProps {
  open: boolean;
  run: RunView | null;
  onClose(): void;
}

/** Spec 07 §3 `<RunDrawer/>`, minimal: plan, action timeline, validation, errors, usage. */
export function RunDrawer({ open, run, onClose }: RunDrawerProps) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <aside
      className={cn(styles.drawer, open && styles.drawerOpen)}
      aria-label={t.canvas.drawerTitle}
      aria-hidden={!open}
    >
      <header className={styles.drawerHeader}>
        <h2>{t.canvas.drawerTitle}</h2>
        {run && (
          <span className={styles.drawerStatus} data-status={run.status}>
            {t.canvas.drawerStatus[run.status]}
          </span>
        )}
        <IconButton aria-label={t.canvas.close} onClick={onClose} tabIndex={open ? 0 : -1}>
          <X size={18} aria-hidden="true" />
        </IconButton>
      </header>

      {!run ? (
        <p className={styles.drawerEmpty}>{t.canvas.drawerEmpty}</p>
      ) : (
        <div className={styles.drawerBody}>
          <section>
            <h3>{t.canvas.drawerPlan}</h3>
            {run.plan ? (
              <>
                <p>{run.plan.summary}</p>
                <p className={styles.drawerMeta}>
                  {run.plan.intent} · {run.plan.diagramType} · {run.plan.layout.algorithm}
                  {run.plan.layout.direction ? ` · ${run.plan.layout.direction}` : ''}
                </p>
                <ol>
                  {run.plan.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </>
            ) : (
              <p className={styles.drawerMeta}>—</p>
            )}
          </section>

          <section>
            <h3>
              {t.canvas.drawerActions} · {run.actions.length}
            </h3>
            <ol className={styles.drawerActions}>
              {run.actions.map((action) => (
                <li key={action.index} data-ok={action.ok}>
                  <span>{action.index + 1}</span>
                  <code>{action.op}</code>
                  {action.ok ? (
                    <CheckCircle size={14} weight="fill" aria-hidden="true" />
                  ) : (
                    <WarningCircle size={14} weight="fill" aria-hidden="true" />
                  )}
                  {action.message && <em>{action.message}</em>}
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h3>{t.canvas.drawerValidation}</h3>
            {run.validation ? (
              run.validation.ok && run.validation.warnings.length === 0 ? (
                <p className={styles.drawerMeta}>{t.canvas.validationOk}</p>
              ) : (
                <ul className={styles.drawerIssues}>
                  {[...run.validation.errors, ...run.validation.warnings].map((issue) => (
                    <li key={`${issue.code}-${issue.ids.join(',')}`} data-severity={issue.severity}>
                      <code>{issue.code}</code> {issue.message}
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className={styles.drawerMeta}>—</p>
            )}
          </section>

          {run.errors.length > 0 && (
            <section>
              <h3>{t.canvas.drawerErrors}</h3>
              <ul className={styles.drawerIssues}>
                {run.errors.map((error, index) => (
                  <li key={`${error.code}-${index}`} data-severity="error">
                    <code>{error.code}</code> {error.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {run.usage && (
            <section>
              <h3>{t.canvas.drawerUsage}</h3>
              <p className={styles.drawerMeta}>
                {run.usage.inputTokens} in · {run.usage.outputTokens} out · {run.usage.calls} calls
              </p>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
