'use client';

import { X } from '@phosphor-icons/react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export interface DialogContentProps extends ComponentProps<typeof RadixDialog.Content> {
  /** `sm` = 470px notice/choice dialog · `lg` = 960px detail dialog. */
  size?: 'sm' | 'lg';
  /** Hide the default top-right close button. */
  hideClose?: boolean;
  closeLabel?: string;
}

export function DialogContent({
  size = 'sm',
  hideClose = false,
  closeLabel = 'Close dialog',
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="nv-dialog__overlay">
        <RadixDialog.Content
          className={cn('nv-dialog', `nv-dialog--${size}`, className)}
          {...props}
        >
          {!hideClose && (
            <RadixDialog.Close className="nv-dialog__close" aria-label={closeLabel}>
              <X size={16} weight="bold" aria-hidden="true" />
            </RadixDialog.Close>
          )}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Overlay>
    </RadixDialog.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof RadixDialog.Title>) {
  return <RadixDialog.Title className={cn('nv-dialog__title', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof RadixDialog.Description>) {
  return <RadixDialog.Description className={cn('nv-dialog__text', className)} {...props} />;
}

export interface DialogActionsProps {
  /** `grid` = two equal columns (default) · `stack` = one column · `row` = flexible row. */
  layout?: 'grid' | 'stack' | 'row';
  className?: string;
  children: ReactNode;
}

export function DialogActions({ layout = 'grid', className, children }: DialogActionsProps) {
  return (
    <div className={cn('nv-dialog__actions', `nv-dialog__actions--${layout}`, className)}>
      {children}
    </div>
  );
}
