'use client';

import { cn } from '@nivik/ui';
import { BookmarkSimple } from '@phosphor-icons/react';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import { RENDERERS } from '@/lib/data/integrations';
import type { DiagramTemplate } from '@/lib/data/templates';
import { TemplatePreview } from './template-preview';
import styles from './templates.module.css';

interface TemplateCardProps {
  template: DiagramTemplate;
  favorite: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
}

/** Cards advertise the three external renderers; the preview dialog also offers Nivik. */
const CARD_RENDERERS = RENDERERS.filter((r) => r.id !== 'nivik');

export function TemplateCard({ template, favorite, onOpen, onToggleFavorite }: TemplateCardProps) {
  return (
    <article
      className={cn(styles.card, template.featured && styles.featured)}
      style={{ '--wash': template.wash } as CSSProperties}
    >
      <button
        type="button"
        className={styles.favorite}
        aria-label={favorite ? `Remove ${template.title} from favorites` : `Save ${template.title}`}
        aria-pressed={favorite}
        onClick={onToggleFavorite}
      >
        <BookmarkSimple size={14} weight={favorite ? 'fill' : 'regular'} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.preview}
        aria-label={`Preview ${template.title}`}
        onClick={onOpen}
      >
        <div className={styles.slot}>
          <TemplatePreview template={template} />
        </div>
      </button>
      <div className={styles.body}>
        {template.featured && <span className={styles.featuredLabel}>Featured</span>}
        <button type="button" className={styles.title} onClick={onOpen}>
          {template.title}
        </button>
        <p className={styles.type}>{template.category}</p>
        {template.featured && <p className={styles.featuredDescription}>{template.description}</p>}
        <div className={styles.compatibility}>
          {CARD_RENDERERS.map((renderer) => (
            <span
              key={renderer.id}
              className={styles.badge}
              style={{ '--badge-color': renderer.color } as CSSProperties}
            >
              <Image src={renderer.logo} alt="" width={14} height={14} />
              <span>{renderer.name}</span>
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
