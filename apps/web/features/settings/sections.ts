/**
 * Pure data about the settings sections — safe to import from server components.
 * Icons live in `settings-page.tsx` (client) because Phosphor components need React context.
 */
export const SETTINGS_SECTION_IDS = ['general', 'ai', 'appearance', 'account'] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  title: string;
  description: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'general',
    label: 'General',
    title: 'General',
    description: 'Defaults for new diagrams and how Nivik behaves day to day.',
  },
  {
    id: 'ai',
    label: 'AI & Models',
    title: 'AI & Models',
    description: 'Choose the models behind generation and connect your own providers.',
  },
  {
    id: 'appearance',
    label: 'Canvas & Appearance',
    title: 'Canvas & Appearance',
    description: 'Tune the canvas, editing helpers, and default shape styles.',
  },
  {
    id: 'account',
    label: 'Account',
    title: 'Account',
    description: 'Your profile, your data, and account controls.',
  },
];

export function isSettingsSection(value: string): value is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}
