'use client';

import { cn, IconButton } from '@nivik/ui';
import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect } from 'react';
import { useT } from '@/lib/i18n/provider';
import { budgetRatio, type RunView } from '@/lib/stores/run-store';
import styles from './canvas.module.css';
import trace from './run-drawer.module.css';

interface RunDrawerProps {
  open: boolean;
  run: RunView | null;
  onClose(): void;
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

/**
 * Spec 07 §3 `<RunDrawer/>`: plan, the loop's trace (replies, tool calls, questions, reviewer
 * notes, other diagrams, budget), action timeline, validation, errors, usage.
 */
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

          {(run.replies.length > 0 || run.pendingReply || run.summary) && (
            <section>
              <h3>{t.canvas.drawerReplies}</h3>
              <ul className={trace.replies}>
                {run.replies.map((reply, index) => (
                  <li key={`${index}-${reply.slice(0, 16)}`}>{reply}</li>
                ))}
                {run.pendingReply && <li>{run.pendingReply}</li>}
                {run.summary && !run.replies.includes(run.summary) && <li>{run.summary}</li>}
              </ul>
              {run.outcome && (
                <p className={trace.outcome}>
                  {t.canvas.drawerOutcome[run.outcome]}
                  {run.unresolved.length > 0 &&
                    ` · ${t.canvas.drawerUnresolved}: ${run.unresolved.join('; ')}`}
                </p>
              )}
            </section>
          )}

          {run.questions.length > 0 && (
            <section>
              <h3>{t.canvas.drawerQuestions}</h3>
              <ul className={trace.questions}>
                {run.questions.map((q) => (
                  <li key={q.questionId}>
                    <strong>{q.text}</strong>
                    <em>{q.answer ?? t.canvas.drawerUnanswered}</em>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {run.trace.length > 0 && (
            <section>
              <h3>
                {t.canvas.drawerTrace} · {run.trace.length}
              </h3>
              <ol className={trace.trace}>
                {run.trace.map((entry) => (
                  <li key={entry.call} data-status={entry.status}>
                    <code>{entry.name}</code>
                    <em>{entry.summary ?? ''}</em>
                    <span>{entry.status === 'end' ? fmtMs(entry.durationMs) : ''}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {run.subagentIssues.length > 0 && (
            <section>
              <h3>{t.canvas.drawerReview}</h3>
              <ul className={styles.drawerIssues}>
                {run.subagentIssues.flatMap(({ role, issues }, i) =>
                  issues.map((issue, j) => (
                    <li key={`${role}-${i}-${j}`} data-severity={issue.severity}>
                      <code>{role}</code> {issue.message}
                    </li>
                  )),
                )}
              </ul>
            </section>
          )}

          {run.documents.length > 0 && (
            <section>
              <h3>{t.canvas.drawerDocuments}</h3>
              <ul className={trace.documents}>
                {run.documents.map((doc) => (
                  <li key={doc.id}>
                    <Link href={`/canvas/${doc.id}`} tabIndex={open ? 0 : -1}>
                      {doc.name}
                    </Link>{' '}
                    <span className={styles.drawerMeta}>{doc.type}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

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

          {run.budget && (
            <section>
              <h3>{t.canvas.drawerBudget}</h3>
              <div className={trace.budget} data-phase={run.budget.phase}>
                <div className={trace.budgetBar} aria-hidden="true">
                  <div
                    className={trace.budgetFill}
                    style={{ width: `${Math.round(100 * budgetRatio(run.budget))}%` }}
                  />
                </div>
                <span>
                  {t.canvas.budgetLine(
                    run.budget.used.inputTokens + run.budget.used.outputTokens,
                    run.budget.limit.inputTokens + run.budget.limit.outputTokens,
                    Math.round(run.budget.used.elapsedMs / 1000),
                  )}
                  {run.budget.phase !== 'normal' && ` · ${t.canvas.budgetPhase[run.budget.phase]}`}
                </span>
              </div>
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
