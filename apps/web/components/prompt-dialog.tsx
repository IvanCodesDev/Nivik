'use client';

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@nivik/ui';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import styles from './prompt-dialog.module.css';

export interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Accessible label of the single text field. */
  label: string;
  initialValue?: string;
  placeholder?: string;
  maxLength?: number;
  confirmLabel: string;
  /** Called with the trimmed value; the dialog closes itself afterwards. */
  onConfirm: (value: string) => void;
}

/** One text field and a confirm button; Enter submits, Escape closes (Radix). */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialValue = '',
  placeholder,
  maxLength,
  confirmLabel,
  onConfirm,
}: PromptDialogProps) {
  const t = useT();
  const id = useId();
  const [value, setValue] = useState(initialValue);

  // Each opening starts from the caller's current value, not from what was typed last time.
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const trimmed = value.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === '') return;
    onOpenChange(false);
    onConfirm(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.closeDialog}>
        <form onSubmit={submit}>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
          <Input
            id={id}
            className={styles.field}
            aria-label={label}
            autoFocus
            value={value}
            placeholder={placeholder}
            maxLength={maxLength}
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
          <DialogActions>
            <Button type="button" variant="soft" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={trimmed === ''}>
              {confirmLabel}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
