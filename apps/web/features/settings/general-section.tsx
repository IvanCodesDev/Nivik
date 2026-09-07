'use client';

import { Select, type SelectOption, Switch } from '@nivik/ui';
import { useMemo } from 'react';
import { useT } from '@/lib/i18n/provider';
import {
  LANGUAGES,
  RENDERER_OPTIONS,
  type Settings,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import { CardHeading, ComingSoon, RowsCard, SettingRow } from './primitives';
import styles from './settings.module.css';

export function GeneralSection() {
  const t = useT();
  const draft = useSettingsStore((s) => s.draft);
  const update = useSettingsStore((s) => s.update);

  const languageOptions = useMemo<SelectOption<Settings['language']>[]>(
    () => LANGUAGES.map((value) => ({ value, label: t.settings.general.languages[value] })),
    [t],
  );

  return (
    <>
      <RowsCard>
        <CardHeading
          title={t.settings.general.diagramDefaults}
          description={t.settings.general.diagramDefaultsDescription}
        />
        <SettingRow
          htmlFor="renderer"
          label={t.settings.general.renderer}
          description={t.settings.general.rendererDescription}
          control={
            <Select
              id="renderer"
              value={draft.renderer}
              options={RENDERER_OPTIONS}
              onValueChange={(renderer) => update({ renderer })}
            />
          }
        />
        <SettingRow
          htmlFor="auto-layout"
          label={
            <>
              {t.settings.general.autoLayout} <ComingSoon />
            </>
          }
          description={t.settings.general.autoLayoutDescription}
          width="auto"
          control={
            <Switch
              id="auto-layout"
              checked={draft.autoLayout}
              disabled
              onCheckedChange={(autoLayout) => update({ autoLayout })}
            />
          }
        />
        <SettingRow
          htmlFor="auto-save"
          label={
            <>
              {t.settings.general.autoSave} <ComingSoon />
            </>
          }
          description={t.settings.general.autoSaveDescription}
          width="auto"
          control={
            <Switch
              id="auto-save"
              checked={draft.autoSave}
              disabled
              onCheckedChange={(autoSave) => update({ autoSave })}
            />
          }
        />
      </RowsCard>

      <RowsCard>
        <CardHeading title={t.settings.general.languageRegion} />
        <SettingRow
          htmlFor="language"
          label={t.settings.general.language}
          description={t.settings.general.languageDescription}
          control={
            <Select
              id="language"
              value={draft.language}
              options={languageOptions}
              onValueChange={(language) => update({ language })}
            />
          }
        />
      </RowsCard>

      <p className={styles.note}>{t.settings.general.note}</p>
    </>
  );
}
