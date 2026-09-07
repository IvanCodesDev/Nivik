/**
 * Pure data about the settings sections — safe to import from server components.
 * Copy lives in the i18n dictionaries (`t.settings.sections[id]`); icons in `settings-page.tsx`.
 */
export const SETTINGS_SECTION_IDS = ['general', 'ai', 'appearance', 'account'] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export function isSettingsSection(value: string): value is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}
