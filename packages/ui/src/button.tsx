'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const buttonVariants = cva('nv-btn', {
  variants: {
    variant: {
      /** Translucent white pill used in the top bar and floating canvas controls. */
      surface: 'nv-btn--surface',
      /** Purple gradient call-to-action. */
      primary: 'nv-btn--primary',
      /** White bordered button (settings actions). */
      secondary: 'nv-btn--secondary',
      /** Borderless. */
      ghost: 'nv-btn--ghost',
      /** Destructive, soft red. */
      danger: 'nv-btn--danger',
      /** Soft lilac card-style action (dialog choices). */
      soft: 'nv-btn--soft',
    },
    size: {
      xs: 'nv-btn--xs',
      sm: 'nv-btn--sm',
      md: 'nv-btn--md',
      lg: 'nv-btn--lg',
    },
    block: {
      true: 'nv-btn--block',
    },
  },
  defaultVariants: {
    variant: 'secondary',
    size: 'md',
  },
});

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  block,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
}

export type IconButtonProps = Omit<ButtonProps, 'block' | 'aria-label'> & {
  /** Icon-only buttons must always be labelled. */
  'aria-label': string;
};

export function IconButton({ className, variant = 'ghost', size, ...props }: IconButtonProps) {
  return (
    <Button className={cn('nv-btn--icon', className)} variant={variant} size={size} {...props} />
  );
}
