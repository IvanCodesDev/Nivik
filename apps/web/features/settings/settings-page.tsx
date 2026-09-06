'use client';

import { Button, cn, useToast } from '@nivik/ui';
import { Check, GearSix, type Icon, Palette, Sparkle, User, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { selectIsDirty, useSettingsStore } from '@/lib/stores/settings-store';
import { AccountSection } from './account-section';
import { AiSection } from './ai-section';
import { AppearanceSection } from './appearance-section';
import { GeneralSection } from './general-section';
import { ProviderForm } from './provider-form';
import { SETTINGS_SECTIONS, type SettingsSectionId } from './sections';
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
  const toast = useToast();
  const dirty = useSettingsStore(selectIsDirty);
  const save = useSettingsStore((s) => s.save);
  const discard = useSettingsStore((s) => s.discard);
  const [providerEdit, setProviderEdit] = useState<ProviderEdit>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const current = SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];
  const showProviderForm = section === 'ai' && providerEdit !== null;

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <h1>Settings</h1>
        <p>Customize your Nivik experience.</p>
        <nav className={styles.tabs} aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((item) => {
            const Icon = SECTION_ICONS[item.id];
            const active = item.id === section;
            return (
              <Link
                key={item.id}
                href={`/settings/${item.id}`}
                className={cn(styles.tab, active && styles.active)}
                aria-current={active ? 'page' : undefined}
                onClick={() => setProviderEdit(null)}
              >
                <Icon size={22} weight="duotone" className={styles.tabIcon} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className={styles.sidebarNote}>Personal workspace</p>
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
              <h2 id="settings-section-title">{current?.title}</h2>
              <p>{current?.description}</p>
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
                    <Warning size={16} aria-hidden="true" className={styles.saveIcon} /> Unsaved
                    changes
                  </>
                ) : (
                  <>
                    <Check size={16} weight="bold" aria-hidden="true" className={styles.saveIcon} />{' '}
                    All preferences saved locally
                  </>
                )}
              </span>
              <div className={styles.footerActions}>
                <Button
                  disabled={!dirty}
                  onClick={() => {
                    discard();
                    toast('Unsaved preference changes discarded.');
                  }}
                >
                  Discard changes
                </Button>
                <Button
                  variant="primary"
                  disabled={!dirty}
                  onClick={() => {
                    save();
                    toast('Preferences saved on this device.');
                  }}
                >
                  Save changes
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
