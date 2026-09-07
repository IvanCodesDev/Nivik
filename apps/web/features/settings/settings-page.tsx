'use client';

import { Button, cn, useToast } from '@nivik/ui';
import { Check, GearSix, type Icon, Palette, Sparkle, User, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { matchLanguages } from '@/lib/i18n/locales';
import { useLocale, useT } from '@/lib/i18n/provider';
import { selectIsDirty, useSettingsStore } from '@/lib/stores/settings-store';
import { AccountSection } from './account-section';
import { AiSection } from './ai-section';
import { AppearanceSection } from './appearance-section';
import { GeneralSection } from './general-section';
import { ProviderForm } from './provider-form';
import { SETTINGS_SECTION_IDS, type SettingsSectionId } from './sections';
import styles from './settings.module.css';

const SECTION_ICONS: Record<SettingsSectionId, Icon> = {
  general: GearSix,
  ai: Sparkle,
  appearance: Palette,
  account: User,
};

interface SettingsPageProps {
  section: SettingsSectionId;
}

type ProviderEdit = { id: string | null } | null;

/** Settings (PRD 5.6): sidebar tabs, draft/saved preferences, inline provider setup. */
export function SettingsPage({ section }: SettingsPageProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const dirty = useSettingsStore(selectIsDirty);
  const draftLanguage = useSettingsStore((s) => s.draft.language);
  const save = useSettingsStore((s) => s.save);
  const discard = useSettingsStore((s) => s.discard);
  const [providerEdit, setProviderEdit] = useState<ProviderEdit>(null);

  // The confirmation should already speak the language that is about to take effect.
  const savedToast = () => {
    const next =
      draftLanguage === 'auto' ? (matchLanguages(navigator.languages) ?? locale) : draftLanguage;
    return getDictionary(next).settings.savedToast;
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const current = t.settings.sections[section];
  const showProviderForm = section === 'ai' && providerEdit !== null;

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <h1>{t.settings.title}</h1>
        <p>{t.settings.subtitle}</p>
        <nav className={styles.tabs} aria-label={t.settings.sectionsLabel}>
          {SETTINGS_SECTION_IDS.map((id) => {
            const Icon = SECTION_ICONS[id];
            const active = id === section;
            return (
              <Link
                key={id}
                href={`/settings/${id}`}
                className={cn(styles.tab, active && styles.active)}
                aria-current={active ? 'page' : undefined}
                onClick={() => setProviderEdit(null)}
              >
                <Icon size={22} weight="duotone" className={styles.tabIcon} aria-hidden="true" />
                {t.settings.sections[id].label}
              </Link>
            );
          })}
        </nav>
        <p className={styles.sidebarNote}>{t.settings.workspaceNote}</p>
      </aside>

      <section className={styles.panel} aria-labelledby="settings-section-title">
        {showProviderForm ? (
          <ProviderForm
            key={providerEdit?.id ?? 'new'}
            providerId={providerEdit?.id ?? null}
            onDone={() => setProviderEdit(null)}
          />
        ) : (
          <>
            <div className={styles.sectionHead}>
              <h2 id="settings-section-title">{current.title}</h2>
              <p>{current.description}</p>
            </div>

            {section === 'general' && <GeneralSection />}
            {section === 'ai' && (
              <AiSection
                onAddProvider={() => setProviderEdit({ id: null })}
                onEditProvider={(id) => setProviderEdit({ id })}
              />
            )}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'account' && <AccountSection />}

            <footer className={styles.footer}>
              <span className={cn(styles.saveStatus, dirty && styles.dirty)} role="status">
                {dirty ? (
                  <>
                    <Warning size={16} aria-hidden="true" className={styles.saveIcon} />{' '}
                    {t.settings.unsaved}
                  </>
                ) : (
                  <>
                    <Check size={16} weight="bold" aria-hidden="true" className={styles.saveIcon} />{' '}
                    {t.settings.allSaved}
                  </>
                )}
              </span>
              <div className={styles.footerActions}>
                <Button
                  disabled={!dirty}
                  onClick={() => {
                    discard();
                    toast(t.settings.discardedToast);
                  }}
                >
                  {t.settings.discard}
                </Button>
                <Button
                  variant="primary"
                  disabled={!dirty}
                  onClick={() => {
                    const message = savedToast();
                    save();
                    toast(message);
                  }}
                >
                  {t.settings.save}
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
