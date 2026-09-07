import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isSettingsSection, SETTINGS_SECTION_IDS } from '@/features/settings/sections';
import { SettingsPage } from '@/features/settings/settings-page';
import { getRequestDictionary } from '@/lib/i18n/server';

interface SettingsSectionPageProps {
  params: Promise<{ section: string }>;
}

export function generateStaticParams() {
  return SETTINGS_SECTION_IDS.map((section) => ({ section }));
}

export async function generateMetadata({ params }: SettingsSectionPageProps): Promise<Metadata> {
  const [{ section }, t] = await Promise.all([params, getRequestDictionary()]);
  return {
    title: isSettingsSection(section)
      ? t.meta.settingsSection(t.settings.sections[section].label)
      : t.settings.title,
  };
}

export default async function SettingsSectionPage({ params }: SettingsSectionPageProps) {
  const { section } = await params;
  if (!isSettingsSection(section)) notFound();
  return <SettingsPage section={section} />;
}
