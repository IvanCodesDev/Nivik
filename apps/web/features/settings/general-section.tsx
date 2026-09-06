'use client';

import { Select, Switch } from '@nivik/ui';
import { type Settings, useSettingsStore } from '@/lib/stores/settings-store';
import { CardHeading, RowsCard, SettingRow } from './primitives';
import styles from './settings.module.css';

const RENDERERS: readonly { value: Settings['renderer']; label: string }[] = [
  { value: 'Excalidraw', label: 'Excalidraw' },
  { value: 'draw.io', label: 'draw.io' },
];

const DIAGRAM_TYPES: readonly { value: Settings['diagramType']; label: string }[] = [
  { value: 'Auto', label: 'Auto' },
  { value: 'Architecture', label: 'Architecture' },
  { value: 'Flow', label: 'Flow' },
  { value: 'ERD', label: 'ERD' },
  { value: 'Sequence', label: 'Sequence' },
  { value: 'System', label: 'System' },
  { value: 'Data Flow', label: 'Data Flow' },
];

const LANGUAGES: readonly { value: Settings['language']; label: string }[] = [
  { value: 'en', label: 'English (US)' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'ja', label: '日本語' },
];

export function GeneralSection() {
  const draft = useSettingsStore((s) => s.draft);
  const update = useSettingsStore((s) => s.update);

  return (
    <>
      <RowsCard>
        <CardHeading title="Diagram defaults" description="Applied to every new diagram." />
        <SettingRow
          htmlFor="renderer"
          label="Default Renderer"
          description="Where new diagrams open and export by default."
          control={
            <Select
              id="renderer"
              value={draft.renderer}
              options={RENDERERS}
              onValueChange={(renderer) => update({ renderer })}
            />
          }
        />
        <SettingRow
          htmlFor="diagram-type"
          label="Default Diagram Type"
          description="Auto lets Nivik pick the best structure for your prompt."
          control={
            <Select
              id="diagram-type"
              value={draft.diagramType}
              options={DIAGRAM_TYPES}
              onValueChange={(diagramType) => update({ diagramType })}
            />
          }
        />
        <SettingRow
          htmlFor="auto-layout"
          label="Auto Layout"
          description="Re-arrange nodes automatically after AI edits."
          width="auto"
          control={
            <Switch
              id="auto-layout"
              checked={draft.autoLayout}
              onCheckedChange={(autoLayout) => update({ autoLayout })}
            />
          }
        />
        <SettingRow
          htmlFor="auto-save"
          label="Auto Save"
          description="Save changes to this device as you work."
          width="auto"
          control={
            <Switch
              id="auto-save"
              checked={draft.autoSave}
              onCheckedChange={(autoSave) => update({ autoSave })}
            />
          }
        />
      </RowsCard>

      <RowsCard>
        <CardHeading title="Language & region" />
        <SettingRow
          htmlFor="language"
          label="Language"
          description="Interface language for menus and messages."
          control={
            <Select
              id="language"
              value={draft.language}
              options={LANGUAGES}
              onValueChange={(language) => update({ language })}
            />
          }
        />
      </RowsCard>

      <p className={styles.note}>
        Preferences are saved on this device. This preview uses English interface copy.
      </p>
    </>
  );
}
