import {
  FolderSimple,
  GearSix,
  type Icon,
  Layout,
  PuzzlePiece,
  SquaresFour,
} from '@phosphor-icons/react';

export type NavPageId = 'canvas' | 'library' | 'templates' | 'integrations' | 'settings';

export interface NavPage {
  id: NavPageId;
  href: string;
  icon: Icon;
  /** Returns true when `pathname` belongs to this page. */
  matches: (pathname: string) => boolean;
}

/**
 * Top-level pages exposed by the "Open page" switcher (PRD 4.1). `/` lands on the Library.
 * Labels come from the dictionaries (`t.nav.pages[id]`).
 */
export const NAV_PAGES: readonly NavPage[] = [
  {
    id: 'canvas',
    href: '/canvas/new',
    icon: SquaresFour,
    matches: (p) => p.startsWith('/canvas'),
  },
  {
    id: 'library',
    href: '/library',
    icon: FolderSimple,
    matches: (p) => p === '/' || p.startsWith('/library') || p.startsWith('/diagrams'),
  },
  {
    id: 'templates',
    href: '/templates',
    icon: Layout,
    matches: (p) => p.startsWith('/templates'),
  },
  {
    id: 'integrations',
    href: '/integrations',
    icon: PuzzlePiece,
    matches: (p) => p.startsWith('/integrations'),
  },
  {
    id: 'settings',
    href: '/settings/general',
    icon: GearSix,
    matches: (p) => p.startsWith('/settings'),
  },
];

export function currentNavPage(pathname: string): NavPage | undefined {
  return NAV_PAGES.find((page) => page.matches(pathname));
}
