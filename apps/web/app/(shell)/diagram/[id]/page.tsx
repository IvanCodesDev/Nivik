import { isId } from '@nivik/ir';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DiagramDetail } from '@/features/diagram-detail/diagram-detail';
import { getRequestDictionary } from '@/lib/i18n/server';

interface DiagramDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestDictionary();
  return { title: t.detail.title };
}

/** PRD §5.6: the management page for one diagram; the document itself lives in the browser. */
export default async function DiagramDetailPage({ params }: DiagramDetailPageProps) {
  const { id } = await params;
  if (!isId(id)) notFound();
  return <DiagramDetail diagramId={id} />;
}
