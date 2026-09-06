'use client';

import { DotsThree } from '@phosphor-icons/react';
import type { CSSProperties } from 'react';
import { cn } from './cn';
import { FOLDER_TINT_COLORS, type FolderTint } from './palettes';

export interface FolderCardProps {
  title: string;
  meta: string;
  tint: FolderTint;
  onOpen?: () => void;
  onMore?: () => void;
  className?: string;
}

/**
 * Pastel folder card (PRD 5.1): translucent body with a soft top-to-bottom wash,
 * a colored tab, and a creamy information strip at the bottom. No decorative stickers.
 * The whole card is one button; the "more" control sits beside it, not inside it.
 */
export function FolderCard({ title, meta, tint, onOpen, onMore, className }: FolderCardProps) {
  const colors = FOLDER_TINT_COLORS[tint];
  const style = {
    '--folder-top': colors.top,
    '--folder-mid': colors.mid,
    '--folder-bottom': colors.bottom,
    '--folder-tab': colors.tab,
  } as CSSProperties;

  return (
    <article className={cn('nv-folder', className)} style={style}>
      <span className="nv-folder__tab" aria-hidden="true" />
      <div className="nv-folder__border" aria-hidden="true">
        <div className="nv-folder__body" />
      </div>
      <button
        type="button"
        className="nv-folder__open"
        aria-label={`Open ${title}`}
        onClick={onOpen}
      />
      {onMore && (
        <button
          type="button"
          className="nv-folder__more"
          aria-label={`More options for ${title}`}
          onClick={onMore}
        >
          <DotsThree size={20} weight="bold" aria-hidden="true" />
        </button>
      )}
      <div className="nv-folder__copy" aria-hidden="true">
        <span className="nv-folder__title">{title}</span>
        <span className="nv-folder__meta">{meta}</span>
      </div>
    </article>
  );
}
