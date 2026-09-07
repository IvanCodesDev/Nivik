'use client';

import { Button, cn } from '@nivik/ui';
import { BookOpen, CaretDown } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { NAV_PAGES } from '@/lib/navigation';
import menu from './menu.module.css';
import styles from './top-bar.module.css';

/** "Open page" switcher — a light button that pops a single-line-per-page menu (PRD 4.1). */
export function PageSwitcher() {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="surface"
          size="lg"
          className={cn(styles.openPage, open && styles.isOpen)}
          aria-label={t.nav.openPage}
        >
          <BookOpen size={21} aria-hidden="true" />
          <span>{t.nav.openPage}</span>
          <span className={styles.chevron}>
            <CaretDown size={18} aria-hidden="true" />
          </span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={menu.menu}
          align="start"
          sideOffset={12}
          collisionPadding={12}
          aria-label={t.nav.openPage}
        >
          <nav className={menu.list}>
            {NAV_PAGES.map((page) => {
              const active = page.matches(pathname);
              const Icon = page.icon;
              return (
                <Link
                  key={page.id}
                  href={page.href}
                  className={cn(menu.item, active && menu.active)}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span className={menu.icon}>
                    <Icon size={21} weight="duotone" aria-hidden="true" />
                  </span>
                  <span>{t.nav.pages[page.id]}</span>
                </Link>
              );
            })}
          </nav>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
