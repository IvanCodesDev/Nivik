import type { Metadata } from 'next';
import { Integrations } from '@/features/integrations/integrations';
import { getRequestDictionary } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestDictionary();
  return { title: t.nav.pages.integrations };
}

export default function IntegrationsPage() {
  return <Integrations />;
}
