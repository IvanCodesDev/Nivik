'use client';

import { PROVIDER_PRESETS } from '@nivik/protocol';
import { Button, Input, Pill, Select, useToast } from '@nivik/ui';
import { CloudCheck, LockSimple, PlugsConnected, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import {
  AgentRuntimeError,
  AgentRuntimeUnavailableError,
  BUILD_RUNTIME_URL,
  HttpAgentClient,
} from '@/lib/agent-client';
import { useT } from '@/lib/i18n/provider';
import {
  KEY_STORAGES,
  type ProviderConfig,
  useProviderKeys,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import { CardHeading, RowsCard, SettingRow } from './primitives';
import { formatContextLength } from './provider-form';
import styles from './settings.module.css';

interface AiSectionProps {
  onAddProvider: () => void;
  onEditProvider: (id: string) => void;
}

export function AiSection({ onAddProvider, onEditProvider }: AiSectionProps) {
  const t = useT();
  const copy = t.settings.ai;
  const toast = useToast();
  const draft = useSettingsStore((s) => s.draft);
  const update = useSettingsStore((s) => s.update);
  const removeProvider = useSettingsStore((s) => s.removeProvider);
  const keys = useProviderKeys((s) => s.keys);

  return (
    <>
      <RowsCard>
        <CardHeading
          title={
            <>
              {copy.models}{' '}
              <span className={styles.count} title={copy.modelsCount(draft.providers.length)}>
                {draft.providers.length}
              </span>
            </>
          }
          description={copy.modelsDescription}
          action={
            <Button variant="primary" size="sm" onClick={onAddProvider}>
              <Plus size={15} weight="bold" aria-hidden="true" /> {copy.addModel}
            </Button>
          }
        />
        {draft.providers.length === 0 ? (
          <div className={styles.emptyProviders}>
            <span className={styles.emptyIcon}>
              <PlugsConnected size={20} aria-hidden="true" />
            </span>
            <h4>{copy.emptyTitle}</h4>
            <p>{copy.emptyDescription}</p>
            <Button variant="secondary" size="sm" onClick={onAddProvider}>
              <Plus size={14} weight="bold" aria-hidden="true" /> {copy.addModel}
            </Button>
          </div>
        ) : (
          <>
            {draft.providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                hasKey={Boolean(keys[provider.id])}
                isDefault={provider.id === draft.defaultModel}
                isFast={provider.id === draft.fastModel}
                onSetDefault={() => {
                  update({ defaultModel: provider.id });
                  toast(copy.defaultChanged(provider.name));
                }}
                onToggleFast={() => {
                  const next = provider.id === draft.fastModel ? null : provider.id;
                  update({ fastModel: next });
                  toast(next ? copy.fastChanged(provider.name) : copy.fastCleared);
                }}
                onConfigure={() => onEditProvider(provider.id)}
                onRemove={() => {
                  removeProvider(provider.id);
                  toast(copy.modelRemoved);
                }}
              />
            ))}
            <p className={styles.quietNote}>{copy.defaultNote}</p>
            <p className={styles.quietNote}>{copy.fastNote}</p>
          </>
        )}
      </RowsCard>

      <RowsCard>
        <CardHeading title={copy.runtime} description={copy.runtimeDescription} />
        <SettingRow
          htmlFor="agent-runtime-url"
          label={copy.runtimeUrl}
          description={
            BUILD_RUNTIME_URL
              ? copy.runtimeUrlBuildDefault(BUILD_RUNTIME_URL)
              : copy.runtimeUrlLocalMode
          }
          width="form"
          control={
            <div className={styles.inlineControl}>
              <Input
                id="agent-runtime-url"
                type="url"
                inputMode="url"
                placeholder={BUILD_RUNTIME_URL ?? 'http://localhost:3400'}
                spellCheck={false}
                value={draft.agentRuntimeUrl}
                onChange={(event) => update({ agentRuntimeUrl: event.target.value })}
              />
              <RuntimeCheckButton url={draft.agentRuntimeUrl.trim() || BUILD_RUNTIME_URL} />
            </div>
          }
        />
        <p className={styles.quietNote}>
          {draft.agentRuntimeUrl.trim() || BUILD_RUNTIME_URL
            ? copy.runtimeModeRemote
            : copy.runtimeModeLocal}
        </p>
      </RowsCard>

      <RowsCard>
        <CardHeading title={copy.keySecurity} description={copy.keySecurityDescription} />
        <SettingRow
          htmlFor="key-storage"
          label={copy.keyStorage}
          description={copy.keyStorageOptions[draft.keyStorage].description}
          width="form"
          control={
            <Select
              id="key-storage"
              value={draft.keyStorage}
              options={KEY_STORAGES.map((value) => ({
                value,
                label: copy.keyStorageOptions[value].label,
              }))}
              onValueChange={(keyStorage) => update({ keyStorage })}
            />
          }
        />
      </RowsCard>

      <p className={styles.note}>
        <LockSimple size={14} aria-hidden="true" />
        {draft.keyStorage === 'device' ? copy.keysNoteDevice : copy.keysNote}
      </p>
    </>
  );
}

/** `null` in local mode: there is no runtime to check. */
function RuntimeCheckButton({ url }: { url: string | null }) {
  const t = useT();
  const copy = t.settings.ai;
  const toast = useToast();
  const [checking, setChecking] = useState(false);

  const check = async () => {
    if (!url) return;
    setChecking(true);
    const client = new HttpAgentClient(url);
    try {
      const health = await client.health(AbortSignal.timeout(5_000));
      toast(copy.runtimeOnline(health.version, health.runs.running));
    } catch (error) {
      if (error instanceof AgentRuntimeUnavailableError) {
        toast(copy.runtimeUnreachable(client.baseUrl), { tone: 'light' });
      } else if (error instanceof AgentRuntimeError) {
        toast(copy.runtimeError(error.message), { tone: 'light' });
      } else {
        toast(copy.checkTimedOut, { tone: 'light' });
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <Button size="sm" variant="secondary" disabled={checking || !url} onClick={check}>
      <CloudCheck size={15} aria-hidden="true" /> {checking ? copy.checking : copy.check}
    </Button>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface ProviderRowProps {
  provider: ProviderConfig;
  hasKey: boolean;
  isDefault: boolean;
  isFast: boolean;
  onSetDefault: () => void;
  onToggleFast: () => void;
  onConfigure: () => void;
  onRemove: () => void;
}

/** "3 days ago" style stamp for a verification; `at: 0` is a result from before probing existed. */
function verifiedText(
  copy: ReturnType<typeof useT>['settings']['ai'],
  verified: NonNullable<ProviderConfig['verified']>,
  now: number,
): string {
  if (verified.at === 0) return copy.testedLegacy(verified.latencyMs);
  const days = Math.floor((now - verified.at) / 86_400_000);
  return copy.verified(verified.latencyMs, days);
}

const CAPABILITY_ORDER = ['text', 'json', 'tools', 'vision'] as const;

function ProviderRow({
  provider,
  hasKey,
  isDefault,
  isFast,
  onSetDefault,
  onToggleFast,
  onConfigure,
  onRemove,
}: ProviderRowProps) {
  const t = useT();
  const copy = t.settings.ai;
  const keyStorage = useSettingsStore((s) => s.saved.keyStorage);
  const driver =
    provider.kind === 'openai-compatible'
      ? copy.formats[provider.compatibility]
      : PROVIDER_PRESETS[provider.kind].name;

  return (
    <div className={styles.providerRow}>
      <div>
        <div className={styles.providerName}>
          {provider.name}
          {isDefault && <Pill className={styles.defaultPill}>{copy.defaultBadge}</Pill>}
          {isFast && <Pill className={styles.fastPill}>{copy.fastBadge}</Pill>}
          <Pill>
            {hasKey
              ? keyStorage === 'device'
                ? copy.keyOnDevice
                : copy.keyInSession
              : copy.keyNeeded}
          </Pill>
        </div>
        <p className={styles.providerMeta}>
          {provider.model} · {driver} · {hostOf(provider.url)}
        </p>
        <p className={styles.providerCaps}>
          {provider.verified ? verifiedText(copy, provider.verified, Date.now()) : copy.notTested}
          {provider.capabilities && (
            <>
              {' · '}
              {CAPABILITY_ORDER.filter((name) => provider.capabilities?.[name])
                .map((name) => copy.capabilityNames[name])
                .join(' · ')}
              {' · '}
              {copy.contextLength(formatContextLength(provider.capabilities.contextLength))}
            </>
          )}
        </p>
      </div>
      <div className={styles.providerActions}>
        {!isDefault && (
          <Button size="sm" variant="ghost" onClick={onSetDefault}>
            {copy.setDefault}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onToggleFast}>
          {isFast ? copy.clearFast : copy.setFast}
        </Button>
        <Button size="sm" onClick={onConfigure}>
          {t.common.configure}
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          {t.common.remove}
        </Button>
      </div>
    </div>
  );
}
