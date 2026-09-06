import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  isSettingsSection,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
} from '@/features/settings/sections';
import { SettingsPage } from '@/features/settings/settings-page';

interface SettingsSectionPageProps {
  params: Promise<{ section: string }>;
}

export function generateStaticParams() {
  return SETTINGS_SECTION_IDS.map((section) => ({ section }));
}

export async function generateMetadata({ params }: SettingsSectionPageProps): Promise<Metadata> {
  const { section } = await params;
  const match = SETTINGS_SECTIONS.find((s) => s.id === section);
  return { title: match ? `${match.label} · Settings` : 'Settings' };
}

export default async function SettingsSectionPage({ params }: SettingsSectionPageProps) {
  const { section } = await params;
  if (!isSettingsSection(section)) notFound();
  return <SettingsPage section={section} />;
}
