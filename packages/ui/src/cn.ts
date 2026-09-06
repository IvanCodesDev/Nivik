import { type ClassValue, clsx } from 'clsx';

/** Compose class names; `false | null | undefined` are dropped. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
