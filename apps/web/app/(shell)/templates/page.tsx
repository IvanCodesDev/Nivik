import type { Metadata } from 'next';
import { Templates } from '@/features/templates/templates';

export const metadata: Metadata = { title: 'Templates' };

export default function TemplatesPage() {
  return <Templates />;
}
