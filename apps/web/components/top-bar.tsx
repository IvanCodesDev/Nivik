'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  useToast,
} from '@nivik/ui';
import { Bell, GearSix, SignOut } from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { type CSSProperties, useState } from 'react';
import { AVATAR_TONES, useSettingsStore } from '@/lib/stores/settings-store';
import menu from './menu.module.css';
import { PageSwitcher } from './page-switcher';
import styles from './top-bar.module.css';

export function TopBar() {
  return (
    <header className={styles.topbar}>
      <Link href="/" className={styles.brand} aria-label="Nivik home">
        <Image
          src="/brand/nivik-logo.png"
          alt=""
          width={40}
          height={40}
          className={styles.logo}
          priority
        />
        <span className={styles.brandName}>Nivik</span>
      </Link>
      <PageSwitcher />
      <div className={styles.right}>
        <NotificationsButton />
        <AccountMenu />
      </div>
    </header>
  );
}

function NotificationsButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <IconButton
        variant="surface"
        size="lg"
        className={styles.bell}
        aria-label="Notifications"
        onClick={() => setOpen(true)}
      >
        <Bell size={21} aria-hidden="true" />
      </IconButton>
      <DialogContent>
        <DialogTitle>Notifications</DialogTitle>
        <DialogDescription>You're all caught up. No new notifications.</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

function AccountMenu() {
  const router = useRouter();
  const toast = useToast();
  const userName = useSettingsStore((s) => s.saved.userName);
  const avatar = useSettingsStore((s) => s.saved.avatar);
  const avatarColor = useSettingsStore((s) => s.saved.avatarColor);
  const tone = AVATAR_TONES[avatarColor];
  const initial = (userName.trim() || 'S').slice(0, 1).toUpperCase();
  const style = avatar
    ? undefined
    : ({ background: `linear-gradient(145deg, ${tone[0]}, ${tone[1]})` } as CSSProperties);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={styles.avatar} style={style} aria-label="Account menu">
          {avatar ? (
            // biome-ignore lint/performance/noImgElement: user-uploaded data URL, not an optimizable asset.
            <img src={avatar} alt="" />
          ) : (
            initial
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`${menu.menu} ${menu.compact}`}
          align="end"
          sideOffset={12}
          collisionPadding={12}
        >
          <div className={menu.header}>
            <span className={menu.headerName}>{userName.trim() || 'Sophie'}</span>
            <span className={menu.headerNote}>Personal workspace · Local session</span>
          </div>
          <div className={menu.separator} />
          <DropdownMenu.Item
            className={menu.item}
            onSelect={() => router.push('/settings/account')}
          >
            <span className={menu.icon}>
              <GearSix size={19} weight="duotone" aria-hidden="true" />
            </span>
            Account settings
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={menu.item}
            onSelect={() => toast('Local workspace — nothing to sign out of yet.')}
          >
            <span className={menu.icon}>
              <SignOut size={19} weight="duotone" aria-hidden="true" />
            </span>
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
