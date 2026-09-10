'use client';

import { Button, Input, Pill, useToast } from '@nivik/ui';
import { CloudCheck, LockSimple, PlugsConnected, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import {
  AgentRuntimeError,
  AgentRuntimeUnavailableError,
  DEFAULT_AGENT_RUNTIME_URL,
  HttpAgentClient,
} from '@/lib/agent-client';
import { useT } from '@/lib/i18n/provider';
import {
  type ProviderConfig,
  useProviderKeys,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import { CardHeading, RowsCard, SettingRow } from './primitives';
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
                onSetDefault={() => {
                  update({ defaultModel: provider.id });
                  toast(copy.defaultChanged(provider.name));
                }}
                onConfigure={() => onEditProvider(provider.id)}
                onRemove={() => {
                  removeProvider(provider.id);
                  toast(copy.modelRemoved);
                }}
              />
            ))}
            <p className={styles.quietNote}>{copy.defaultNote}</p>
          </>
        )}
      </RowsCard>

      <RowsCard>
        <CardHeading title={copy.runtime} description={copy.runtimeDescription} />
        <SettingRow
          htmlFor="agent-runtime-url"
          label={copy.runtimeUrl}
          description={copy.runtimeUrlDescription(DEFAULT_AGENT_RUNTIME_URL)}
          width="form"
          control={
            <div className={styles.inlineControl}>
              <Input
                id="agent-runtime-url"
                type="url"
                inputMode="url"
                placeholder={DEFAULT_AGENT_RUNTIME_URL}
                spellCheck={false}
                value={draft.agentRuntimeUrl}
                onChange={(event) => update({ agentRuntimeUrl: event.target.value })}
              />
              <RuntimeCheckButton url={draft.agentRuntimeUrl} />
            </div>
          }
        />
      </RowsCard>

      <p className={styles.note}>
        <LockSimple size={14} aria-hidden="true" />
        {copy.keysNote}
      </p>
    </>
  );
}

function RuntimeCheckButton({ url }: { url: string }) {
  const t = useT();
  const copy = t.settings.ai;
  const toast = useToast();
  const [checking, setChecking] = useState(false);

  const check = async () => {
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
    <Button size="sm" variant="secondary" disabled={checking} onClick={check}>
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
  onSetDefault: () => void;
  onConfigure: () => void;
  onRemove: () => void;
}

function ProviderRow({
  provider,
  hasKey,
  isDefault,
  onSetDefault,
  onConfigure,
  onRemove,
}: ProviderRowProps) {
  const t = useT();
  const copy = t.settings.ai;

  return (
    <div className={styles.providerRow}>
      <div>
        <div className={styles.providerName}>
          {provider.name}
          {isDefault && <Pill className={styles.defaultPill}>{copy.defaultBadge}</Pill>}
          <Pill>{hasKey ? copy.keyInSession : copy.keyNeeded}</Pill>
        </div>
        <p className={styles.providerMeta}>
          {provider.model} · {copy.formats[provider.compatibility]} · {hostOf(provider.url)}
        </p>
        <p className={styles.providerCaps}>
          {provider.verified ? copy.tested(provider.verified.latencyMs) : copy.notTested}
        </p>
      </div>
      <div className={styles.providerActions}>
        {!isDefault && (
          <Button size="sm" variant="ghost" onClick={onSetDefault}>
            {copy.setDefault}
          </Button>
        )}
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
