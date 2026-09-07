import type { Metadata } from 'next';
import { Templates } from '@/features/templates/templates';
import { getRequestDictionary } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestDictionary();
  return { title: t.nav.pages.templates };
}

export default function TemplatesPage() {
  return <Templates />;
}
