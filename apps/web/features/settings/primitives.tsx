'use client';

import { Card, cn, Pill } from '@nivik/ui';
import { CaretDown } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/provider';
import styles from './settings.module.css';

/** Marks a preference that is stored but has no consumer yet (its control should be disabled). */
export function ComingSoon() {
  const t = useT();
  return <Pill className={styles.soon}>{t.common.comingSoon}</Pill>;
}

interface RowsCardProps {
  children: ReactNode;
  className?: string;
}

/** White card that stacks setting rows. */
export function RowsCard({ children, className }: RowsCardProps) {
  return (
    <Card padding="rows" className={cn(styles.card, className)}>
      {children}
    </Card>
  );
}

interface CardHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function CardHeading({ title, description, action }: CardHeadingProps) {
  return (
    <div className={styles.cardHeading}>
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <p className={styles.groupLabel}>{children}</p>;
}

interface SettingRowProps {
  /** Control id used to associate the label. Omit for controls that carry their own label. */
  htmlFor?: string;
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  width?: 'default' | 'wide' | 'narrow' | 'form' | 'auto';
  compact?: boolean;
}

const WIDTHS = {
  default: undefined,
  wide: styles.wide,
  narrow: styles.narrow,
  form: styles.form,
  auto: styles.auto,
} as const;

/** Label + description on the left, control on the right. */
export function SettingRow({
  htmlFor,
  label,
  description,
  control,
  width = 'default',
  compact = false,
}: SettingRowProps) {
  return (
    <div className={cn(styles.row, compact && styles.compact)}>
      <div className={styles.rowLabel}>
        {htmlFor ? (
          <label htmlFor={htmlFor}>{label}</label>
        ) : (
          <span className={styles.labelText}>{label}</span>
        )}
        {description && <p>{description}</p>}
      </div>
      <div className={cn(styles.control, WIDTHS[width])}>{control}</div>
    </div>
  );
}

interface DetailsCardProps {
  title: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Collapsible card (`<details>`) for secondary settings groups. */
export function DetailsCard({ title, description, defaultOpen, children }: DetailsCardProps) {
  return (
    <details className={styles.details} open={defaultOpen}>
      <summary>
        <div>
          <h3 className={styles.detailsTitle}>{title}</h3>
          {description && <p className={styles.detailsText}>{description}</p>}
        </div>
        <CaretDown size={16} aria-hidden="true" className={styles.detailsCaret} />
      </summary>
      <div className={styles.detailsBody}>{children}</div>
    </details>
  );
}
