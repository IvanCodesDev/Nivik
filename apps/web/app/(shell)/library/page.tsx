import type { Metadata } from 'next';
import { DiagramLibrary } from '@/features/library/diagram-library';
import { getRequestDictionary } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestDictionary();
  return { title: t.nav.pages.library };
}

export default function LibraryPage() {
  return <DiagramLibrary />;
}
