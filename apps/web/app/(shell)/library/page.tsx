import type { Metadata } from 'next';
import { DiagramLibrary } from '@/features/library/diagram-library';

export const metadata: Metadata = { title: 'Diagram Library' };

export default function LibraryPage() {
  return <DiagramLibrary />;
}
