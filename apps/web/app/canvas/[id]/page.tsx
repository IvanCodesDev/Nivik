import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CanvasWorkspace } from '@/features/canvas/canvas-workspace';
import { getRequestDictionary } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestDictionary();
  return { title: t.nav.pages.canvas };
}

interface CanvasPageProps {
  params: Promise<{ id: string }>;
}

export default async function CanvasPage({ params }: CanvasPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <CanvasWorkspace diagramId={id} />
    </Suspense>
  );
}
