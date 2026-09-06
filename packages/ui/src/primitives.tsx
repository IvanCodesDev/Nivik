import type { ComponentProps } from 'react';
import { cn } from './cn';

/** Tiny status label: "Preview", "Coming later", "Key needed". */
export function Pill({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('nv-pill', className)} {...props} />;
}

/** Keyboard hint, e.g. `Ctrl K`. */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return <kbd className={cn('nv-kbd', className)} {...props} />;
}

export interface ChipProps extends ComponentProps<'button'> {
  active?: boolean;
  /** `ink` = solid dark when active (Library filters) · `accent` = lilac when active (Templates). */
  tone?: 'ink' | 'accent';
}

/** Filter chip with pressed state. */
export function Chip({
  className,
  active = false,
  tone = 'ink',
  type = 'button',
  ...props
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn('nv-chip', `nv-chip--${tone}`, active && 'is-active', className)}
      {...props}
    />
  );
}

export type InputProps = ComponentProps<'input'>;

/** Text-like input matching the settings control geometry (40px, radius 10). */
export function Input({ className, ...props }: InputProps) {
  return <input className={cn('nv-input', className)} {...props} />;
}

export interface CardProps extends ComponentProps<'div'> {
  /** `rows` adds horizontal padding for stacked setting rows. */
  padding?: 'none' | 'rows';
}

/** Soft white card surface. */
export function Card({ className, padding = 'none', ...props }: CardProps) {
  return (
    <div className={cn('nv-card', padding === 'rows' && 'nv-card--rows', className)} {...props} />
  );
}
