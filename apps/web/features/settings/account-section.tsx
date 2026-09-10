'use client';

import { Button, buttonVariants, cn, Input, useToast } from '@nivik/ui';
import { Camera, DownloadSimple, Trash } from '@phosphor-icons/react';
import { type ChangeEvent, useId, useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import { backupBlob, backupFilename, clearLocalData, exportAllData } from '@/lib/backup';
import { useT } from '@/lib/i18n/provider';
import { getRepository } from '@/lib/repository';
import {
  AVATAR_COLORS,
  AVATAR_TONES,
  type AvatarColor,
  FALLBACK_INITIAL,
  useProviderKeys,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import { CardHeading, RowsCard, SettingRow } from './primitives';
import styles from './settings.module.css';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

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
  const t = useT();
  const copy = t.settings.account;
  const toast = useToast();
  const draft = useSettingsStore((s) => s.draft);
  const update = useSettingsStore((s) => s.update);
  const fileId = useId();
  const [deleteNotice, setDeleteNotice] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState<'export' | 'clear' | null>(null);

  const [from, to] = AVATAR_TONES[draft.avatarColor];
  const initial = (draft.userName.trim().charAt(0) || FALLBACK_INITIAL).toUpperCase();

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!AVATAR_TYPES.has(file.type) || file.size > MAX_AVATAR_BYTES) {
      toast(copy.invalidFile);
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
      scope: copy.exportScope,
      settings: draft,
    };
    download(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      'nivik-settings.json',
    );
    toast(copy.exported);
  };

  // Spec 06 §6.2: diagrams, versions, runs, templates and the saved settings; never the API keys.
  const exportAll = async () => {
    setBusy('export');
    try {
      const backup = await exportAllData(getRepository().db, useSettingsStore.getState().saved);
      download(backupBlob(backup), backupFilename());
      toast(copy.exportedAll(backup.tables.diagrams.length));
    } catch (error) {
      toast(copy.exportFailed(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(null);
    }
  };

  const clearAll = async () => {
    setBusy('clear');
    try {
      await clearLocalData({
        db: getRepository().db,
        storage: typeof localStorage === 'undefined' ? null : localStorage,
        clearKeys: () => useProviderKeys.getState().clear(),
        reload: () => window.location.assign('/'),
      });
    } catch (error) {
      setBusy(null);
      toast(copy.clearFailed(error instanceof Error ? error.message : String(error)));
    }
  };

  return (
    <>
      <section className={styles.avatarCard} aria-label={copy.profilePicture}>
        <div className={styles.avatarHalo}>
          <div
            className={styles.avatarBig}
            style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
          >
            {draft.avatar ? (
              // biome-ignore lint/performance/noImgElement: user-supplied data URL
              <img src={draft.avatar} alt={copy.yourAvatar} />
            ) : (
              initial
            )}
          </div>
          <label className={styles.avatarCamera} htmlFor={fileId} title={copy.uploadPhoto}>
            <Camera size={14} aria-hidden="true" />
          </label>
        </div>
        <div className={styles.avatarCopy}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h3 className={styles.avatarTitle}>{copy.heroTitle}</h3>
          <p className={styles.avatarText}>{copy.heroText}</p>
          <div className={styles.avatarActions}>
            <label
              htmlFor={fileId}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              style={{ cursor: 'pointer' }}
            >
              {copy.uploadPhoto}
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
                {copy.useInitials}
              </button>
            )}
          </div>
          <p className={styles.small}>{copy.fileHint}</p>
          <div className={styles.avatarActions} style={{ marginTop: 14 }}>
            <span className={styles.small} style={{ margin: 0 }}>
              {copy.initialsColor}
            </span>
            <div className={styles.swatches} role="radiogroup" aria-label={copy.initialsColor}>
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={draft.avatarColor === color}
                  aria-label={copy.colors[color]}
                  className={cn(styles.swatch, styles.swatchSmall)}
                  style={{ backgroundColor: SWATCH_COLORS[color], margin: 0 }}
                  onClick={() => update({ avatarColor: color })}
                />
              ))}
            </div>
            <span className={styles.small} style={{ margin: 0 }}>
              {copy.initialsColorNote}
            </span>
          </div>
        </div>
      </section>

      <RowsCard>
        <CardHeading title={copy.profile} description={copy.profileDescription} />
        <SettingRow
          htmlFor="user-name"
          label={copy.userName}
          description={copy.userNameDescription}
          width="wide"
          control={
            <Input
              id="user-name"
              maxLength={60}
              placeholder={copy.namePlaceholder}
              value={draft.userName}
              onChange={(event) => update({ userName: event.target.value })}
            />
          }
        />
        <SettingRow
          htmlFor="email"
          label={copy.email}
          description={copy.emailDescription}
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
        <CardHeading title={copy.localData} description={copy.localDataDescription} />
        <SettingRow
          label={copy.exportAll}
          description={copy.exportAllDescription}
          width="auto"
          control={
            <Button size="sm" onClick={() => void exportAll()} disabled={busy !== null}>
              <DownloadSimple size={15} aria-hidden="true" />{' '}
              {busy === 'export' ? copy.exporting : copy.exportAllButton}
            </Button>
          }
        />
        <SettingRow
          label={copy.dataExport}
          description={copy.dataExportDescription}
          width="auto"
          control={
            <Button size="sm" onClick={exportSettings}>
              <DownloadSimple size={15} aria-hidden="true" /> {copy.exportButton}
            </Button>
          }
        />
        <SettingRow
          label={copy.clearLocal}
          description={copy.clearLocalDescription}
          width="auto"
          control={
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmClear(true)}
              disabled={busy !== null}
            >
              <Trash size={15} aria-hidden="true" />{' '}
              {busy === 'clear' ? copy.clearing : copy.clearLocalButton}
            </Button>
          }
        />
      </RowsCard>

      <ChoiceDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={copy.clearConfirmTitle}
        description={copy.clearConfirmText}
        actions={[
          { label: t.common.cancel, onSelect: () => {} },
          { label: copy.clearConfirmButton, variant: 'danger', onSelect: () => void clearAll() },
        ]}
      />

      <RowsCard>
        <CardHeading title={copy.dataAccount} />
        <SettingRow
          label={copy.deleteAccount}
          description={copy.deleteDescription}
          width="auto"
          control={
            <Button size="sm" variant="danger" onClick={() => setDeleteNotice(true)}>
              {copy.deleteButton}
            </Button>
          }
        />
        {deleteNotice && (
          <div className={styles.dangerNotice} role="status">
            <strong>{copy.noAccountTitle}</strong>
            {copy.noAccountText}
          </div>
        )}
      </RowsCard>

      <p className={styles.note}>{copy.note}</p>
    </>
  );
}
