import type { ReactNode } from 'react';
import { TopBar } from '@/components/top-bar';

/** Pages with the shared top bar and "Open page" switcher on dotted paper. */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="nv-paper">
      <TopBar />
      {children}
    </div>
  );
}
