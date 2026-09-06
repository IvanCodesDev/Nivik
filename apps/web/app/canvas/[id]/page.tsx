import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CanvasWorkspace } from '@/features/canvas/canvas-workspace';

export const metadata: Metadata = { title: 'Canvas' };

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
