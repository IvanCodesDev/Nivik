'use client';

import { Button, buttonVariants, cn, Input, useToast } from '@nivik/ui';
import { Camera, DownloadSimple } from '@phosphor-icons/react';
import { type ChangeEvent, useId, useState } from 'react';
import {
  AVATAR_COLORS,
  AVATAR_TONES,
  type AvatarColor,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import { CardHeading, RowsCard, SettingRow } from './primitives';
import styles from './settings.module.css';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const SWATCH_COLORS: Record<AvatarColor, string> = {
  violet: '#b59add',
  sage: '#91b9a9',
  sky: '#9cbbd9',
  peach: '#dcae9e',
  slate: '#919bac',
};

export function AccountSection() {
  const toast = useToast();
  const draft = useSettingsStore((s) => s.draft);
  const update = useSettingsStore((s) => s.update);
  const fileId = useId();
  const [deleteNotice, setDeleteNotice] = useState(false);

  const [from, to] = AVATAR_TONES[draft.avatarColor];
  const initial = (draft.userName.trim().charAt(0) || 'N').toUpperCase();

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!AVATAR_TYPES.has(file.type) || file.size > MAX_AVATAR_BYTES) {
      toast('Choose a PNG, JPG or WebP image under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') update({ avatar: reader.result });
    };
    reader.readAsDataURL(file);
  };

  const exportSettings = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      scope: 'Local Nivik preferences only; API keys excluded',
      settings: draft,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nivik-settings.json';
    link.click();
    URL.revokeObjectURL(url);
    toast('Settings exported. No API keys included.');
  };

  return (
    <>
      <section className={styles.avatarCard} aria-label="Profile picture">
        <div className={styles.avatarHalo}>
          <div
            className={styles.avatarBig}
            style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
          >
            {draft.avatar ? (
              // biome-ignore lint/performance/noImgElement: user-supplied data URL
              <img src={draft.avatar} alt="Your avatar" />
            ) : (
              initial
            )}
          </div>
          <label className={styles.avatarCamera} htmlFor={fileId} title="Upload photo">
            <Camera size={14} aria-hidden="true" />
          </label>
        </div>
        <div className={styles.avatarCopy}>
          <p className={styles.eyebrow}>MAKE IT YOURS</p>
          <h3 className={styles.avatarTitle}>Your workspace, your signature.</h3>
          <p className={styles.avatarText}>Add a photo, or make your initials feel like you.</p>
          <div className={styles.avatarActions}>
            <label
              htmlFor={fileId}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              style={{ cursor: 'pointer' }}
            >
              Upload photo
            </label>
            <input
              id={fileId}
              className={styles.fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onFile}
            />
            {draft.avatar && (
              <button
                type="button"
                className={styles.textButton}
                onClick={() => update({ avatar: '' })}
              >
                Use initials
              </button>
            )}
          </div>
          <p className={styles.small}>JPG, PNG or WebP · Up to 2 MB</p>
          <div className={styles.avatarActions} style={{ marginTop: 14 }}>
            <span className={styles.small} style={{ margin: 0 }}>
              Initials color
            </span>
            <div className={styles.swatches} role="radiogroup" aria-label="Initials color">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={draft.avatarColor === color}
                  aria-label={color}
                  className={cn(styles.swatch, styles.swatchSmall)}
                  style={{ backgroundColor: SWATCH_COLORS[color], margin: 0 }}
                  onClick={() => update({ avatarColor: color })}
                />
              ))}
            </div>
            <span className={styles.small} style={{ margin: 0 }}>
              Shown when using initials
            </span>
          </div>
        </div>
      </section>

      <RowsCard>
        <CardHeading title="Profile" description="How you appear in this workspace." />
        <SettingRow
          htmlFor="user-name"
          label="User Name"
          description="Shown in the top bar and on shared diagrams."
          width="wide"
          control={
            <Input
              id="user-name"
              maxLength={60}
              placeholder="Your name"
              value={draft.userName}
              onChange={(event) => update({ userName: event.target.value })}
            />
          }
        />
        <SettingRow
          htmlFor="email"
          label="Email"
          description="Used for account recovery once cloud accounts arrive."
          width="wide"
          control={
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={draft.email}
              onChange={(event) => update({ email: event.target.value })}
            />
          }
        />
      </RowsCard>

      <RowsCard>
        <CardHeading title="Data & account" />
        <SettingRow
          label="Data Export"
          description="Download your local settings and provider configurations. Keys are excluded."
          width="auto"
          control={
            <Button size="sm" onClick={exportSettings}>
              <DownloadSimple size={15} aria-hidden="true" /> Export settings
            </Button>
          }
        />
        <SettingRow
          label="Delete Account"
          description="Permanently remove your account and cloud data."
          width="auto"
          control={
            <Button size="sm" variant="danger" onClick={() => setDeleteNotice(true)}>
              Delete account
            </Button>
          }
        />
        {deleteNotice && (
          <div className={styles.dangerNotice} role="status">
            <strong>No account connected</strong>
            This is a local settings preview. Sign in to Nivik to request permanent deletion of your
            cloud account. No account or local data has been deleted.
          </div>
        )}
      </RowsCard>

      <p className={styles.note}>Local profile preview · No cloud account is connected.</p>
    </>
  );
}
