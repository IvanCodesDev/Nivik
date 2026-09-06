import { redirect } from 'next/navigation';

/** The Diagram Library is the landing page; a separate Home would only duplicate it. */
export default function RootPage() {
  redirect('/library');
}
