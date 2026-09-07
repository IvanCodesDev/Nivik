import type { Metadata } from 'next';
import { MindMapDemo } from '@/features/mindmap-demo/mind-map-demo';

export const metadata: Metadata = { title: 'Mind Map · Demo' };

/** SPIKE — throwaway page to judge a dedicated mind map editor. Not linked from navigation. */
export default function MindMapDemoPage() {
  return <MindMapDemo />;
}
