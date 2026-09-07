'use client';

import { Dialog, DialogContent } from '@nivik/ui';
import { Info } from '@phosphor-icons/react';
import Image from 'next/image';
import { useState } from 'react';
import { RENDERERS, type RendererId } from '@/lib/data/integrations';
import type { DiagramTemplate } from '@/lib/data/templates';
import { useT } from '@/lib/i18n/provider';
import { templateCopy } from '@/lib/i18n/template-copy';
import { TemplatePreview } from './template-preview';
import styles from './templates.module.css';

interface TemplateDetailDialogProps {
  template: DiagramTemplate | null;
  defaultRenderer: RendererId;
  onClose: () => void;
  onUse: (template: DiagramTemplate, renderer: RendererId, withAi: boolean) => void;
}

export function TemplateDetailDialog({
  template,
  defaultRenderer,
  onClose,
  onUse,
}: TemplateDetailDialogProps) {
  const t = useT();
  return (
    <Dialog open={template !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" closeLabel={t.templates.closePreview}>
        {template && (
          <DetailBody
            key={template.id}
            template={template}
            defaultRenderer={defaultRenderer}
            onUse={onUse}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface DetailBodyProps {
  template: DiagramTemplate;
  defaultRenderer: RendererId;
  onUse: TemplateDetailDialogProps['onUse'];
}

/** Keyed by template id so the renderer choice resets per template without effects. */
function DetailBody({ template, defaultRenderer, onUse }: DetailBodyProps) {
  const t = useT();
  const copy = templateCopy(t, template);
  const [renderer, setRenderer] = useState<RendererId>(defaultRenderer);

  return (
    <>
      <div className={styles.detail}>
        <div className={styles.detailCopy}>
          <h2>{copy.title}</h2>
          <span className={styles.tag}>
            {t.templates.diagramTag(t.templates.categories[template.category])}
          </span>
          <p className={styles.detailDescription}>{copy.description}</p>
          <ul className={styles.benefits}>
            {t.templates.benefits.map((benefit) => (
              <li key={benefit}>{benefit}</li>
            ))}
          </ul>
          <fieldset className={styles.renderers}>
            <legend>{t.templates.renderer}</legend>
            <div className={styles.rendererGrid} role="group" aria-label={t.templates.renderer}>
              {RENDERERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.rendererChoice}
                  aria-pressed={renderer === option.id}
                  onClick={() => setRenderer(option.id)}
                >
                  <Image src={option.logo} alt="" width={24} height={24} />
                  {option.name}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => onUse(template, renderer, false)}
          >
            {t.templates.useTemplate} <span aria-hidden="true">→</span>
          </button>
          <button
            type="button"
            className={styles.secondaryAction}
            onClick={() => onUse(template, renderer, true)}
          >
            <Image src="/brand/nivik-logo.png" alt="" width={18} height={18} />
            {t.templates.generateWithAi}
          </button>
        </div>
        <div className={styles.detailDiagram}>
          <TemplatePreview template={template} />
        </div>
      </div>
      <p className={styles.detailNote}>
        <Info size={16} aria-hidden="true" />
        {t.templates.note}
      </p>
    </>
  );
}
