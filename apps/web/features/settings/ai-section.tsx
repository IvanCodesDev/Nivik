'use client';

import { Button, Input, Pill, Select, type SelectOption, Switch, useToast } from '@nivik/ui';
import {
  ArrowSquareOut,
  ArrowsLeftRight,
  CloudCheck,
  LockSimple,
  PlugsConnected,
  Plus,
} from '@phosphor-icons/react';
import Image from 'next/image';
import { useMemo, useState } from 'react';
import {
  AgentRuntimeError,
  AgentRuntimeUnavailableError,
  DEFAULT_AGENT_RUNTIME_URL,
  HttpAgentClient,
} from '@/lib/agent-client';
import {
  BUILT_IN_MODELS,
  type ProviderConfig,
  type Settings,
  useProviderKeys,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import { CardHeading, DetailsCard, RowsCard, SettingRow } from './primitives';
import styles from './settings.module.css';

const RETRY_OPTIONS: readonly { value: Settings['retryCount']; label: string }[] = [
  { value: '0', label: 'No retries' },
  { value: '1', label: '1 retry' },
  { value: '2', label: '2 retries' },
  { value: '3', label: '3 retries' },
];

const ROUTING_TASKS = ['Diagram Planning', 'Diagram Generation', 'Vision', 'Review / Validation'];

const CAPABILITY_LABELS = {
  text: 'Text',
  vision: 'Vision',
  tools: 'Tools',
  json: 'JSON',
  thinking: 'Thinking',
} as const;

interface AiSectionProps {
  onAddProvider: () => void;
  onEditProvider: (id: string) => void;
}

export function AiSection({ onAddProvider, onEditProvider }: AiSectionProps) {
  const toast = useToast();
  const draft = useSettingsStore((s) => s.draft);
  const update = useSettingsStore((s) => s.update);
  const removeProvider = useSettingsStore((s) => s.removeProvider);
  const keys = useProviderKeys((s) => s.keys);
  const [temporaryModel, setTemporaryModel] = useState('default');

  const modelOptions = useMemo<SelectOption[]>(
    () => [
      ...BUILT_IN_MODELS,
      ...draft.providers.map((p) => ({ value: p.id, label: `${p.name} · ${p.model}` })),
    ],
    [draft.providers],
  );

  const defaultProvider = draft.providers.find((p) => p.id === draft.defaultModel);
  const thinkingAvailable = Boolean(defaultProvider?.capabilities.thinking);

  const compatibilityNote = !defaultProvider
    ? 'Nivik built-in models support the full agent workflow.'
    : defaultProvider.capabilities.tools && defaultProvider.capabilities.json
      ? 'This provider declares tool calling and structured output — ready for the Nivik Agent.'
      : 'This provider lacks tool calling or structured output, so planning and validation may be limited.';

  const thinkingHint = !defaultProvider
    ? 'Available when your provider supports thinking.'
    : thinkingAvailable
      ? "Supported according to this provider's configuration."
      : 'Enable for a provider that supports thinking.';

  return (
    <>
      <RowsCard>
        <CardHeading
          title={
            <>
              Built-in Models <Pill>Preview</Pill>
            </>
          }
          description="Nivik-hosted models, plus any provider you connect below."
        />
        <SettingRow
          htmlFor="default-model"
          label="Nivik Default Model"
          description="Used for every generation unless a temporary model is chosen."
          width="wide"
          leading={
            <span className={styles.modelMark}>
              <Image src="/brand/nivik-logo.png" alt="" width={24} height={24} />
            </span>
          }
          control={
            <Select
              id="default-model"
              value={draft.defaultModel}
              options={modelOptions}
              onValueChange={(defaultModel) => update({ defaultModel })}
            />
          }
        />
        <SettingRow
          htmlFor="temporary-model"
          label="Temporary Model"
          description="Applies to the next generation only; not saved."
          width="wide"
          leading={
            <span className={`${styles.modelMark} ${styles.neutral}`}>
              <ArrowsLeftRight size={18} aria-hidden="true" />
            </span>
          }
          control={
            <Select
              id="temporary-model"
              value={temporaryModel}
              options={[{ value: 'default', label: 'Use default model' }, ...modelOptions]}
              onValueChange={(value) => {
                setTemporaryModel(value);
                toast(
                  value === 'default'
                    ? 'Temporary model cleared.'
                    : 'Temporary model applies to the next generation only.',
                );
              }}
            />
          }
        />
        <p className={styles.quietNote}>
          Built-in model availability requires a Nivik connection. {compatibilityNote}
        </p>
      </RowsCard>

      <RowsCard>
        <CardHeading
          title={
            <>
              Connected Providers <span className={styles.count}>{draft.providers.length}</span>
            </>
          }
          description="Bring your own API keys. Keys stay in this tab's memory."
          action={
            <Button variant="primary" size="sm" onClick={onAddProvider}>
              <Plus size={15} weight="bold" aria-hidden="true" /> Add Provider
            </Button>
          }
        />
        {draft.providers.length === 0 ? (
          <div className={styles.emptyProviders}>
            <span className={styles.emptyIcon}>
              <PlugsConnected size={20} aria-hidden="true" />
            </span>
            <h4>Bring your own model</h4>
            <p>Connect OpenAI, DeepSeek, Qwen, or a custom endpoint.</p>
            <Button variant="secondary" size="sm" onClick={onAddProvider}>
              Connect a provider <ArrowSquareOut size={14} aria-hidden="true" />
            </Button>
          </div>
        ) : (
          draft.providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              hasKey={Boolean(keys[provider.id])}
              onConfigure={() => onEditProvider(provider.id)}
              onRemove={() => {
                removeProvider(provider.id);
                toast('Provider removed from the draft. Save changes to keep this change.');
              }}
            />
          ))
        )}
      </RowsCard>

      <RowsCard>
        <CardHeading
          title="Agent Runtime"
          description="The Node service that runs the Nivik Agent, streams progress, and proxies providers that block browser requests."
        />
        <SettingRow
          htmlFor="agent-runtime-url"
          label="Runtime URL"
          description={`Leave empty to use ${DEFAULT_AGENT_RUNTIME_URL}.`}
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

      <DetailsCard title="Model Parameters" description="Fine-tune generation behavior.">
        <SettingRow
          htmlFor="temperature"
          label="Temperature"
          description="Lower is more deterministic; higher is more creative."
          compact
          control={
            <div className={styles.range}>
              <input
                id="temperature"
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={draft.temperature}
                onChange={(event) => update({ temperature: Number(event.target.value) })}
              />
              <output htmlFor="temperature">{draft.temperature.toFixed(1)}</output>
            </div>
          }
        />
        <SettingRow
          htmlFor="max-tokens"
          label="Max Tokens"
          description="Upper bound for a single response."
          compact
          width="narrow"
          control={
            <Input
              id="max-tokens"
              type="number"
              min={1}
              max={1_000_000}
              value={draft.maxTokens}
              onChange={(event) =>
                update({
                  maxTokens: Math.min(1_000_000, Math.max(1, Number(event.target.value) || 1)),
                })
              }
            />
          }
        />
        <SettingRow
          htmlFor="thinking"
          label="Reasoning / Thinking"
          description={thinkingHint}
          compact
          width="auto"
          control={
            <Switch
              id="thinking"
              checked={draft.thinking && thinkingAvailable}
              disabled={!thinkingAvailable}
              onCheckedChange={(thinking) => update({ thinking })}
            />
          }
        />
        <SettingRow
          htmlFor="timeout"
          label="Timeout"
          description="Seconds to wait for a provider response (5–300)."
          compact
          width="narrow"
          control={
            <Input
              id="timeout"
              type="number"
              min={5}
              max={300}
              value={draft.timeout}
              onChange={(event) =>
                update({ timeout: Math.min(300, Math.max(5, Number(event.target.value) || 5)) })
              }
            />
          }
        />
        <SettingRow
          htmlFor="retry-count"
          label="Retry Count"
          description="Automatic retries after a failed request."
          compact
          width="narrow"
          control={
            <Select
              id="retry-count"
              value={draft.retryCount}
              options={RETRY_OPTIONS}
              onValueChange={(retryCount) => update({ retryCount })}
            />
          }
        />
      </DetailsCard>

      <DetailsCard
        title={
          <>
            Model Routing <Pill>Coming later</Pill>
          </>
        }
        description="Assign a specialized model to each task."
      >
        <div className={styles.routingGrid}>
          {ROUTING_TASKS.map((task) => {
            const id = `routing-${task.toLowerCase().replace(/[^a-z]+/g, '-')}`;
            return (
              <div key={task} className={styles.routingItem}>
                <label htmlFor={id}>{task}</label>
                <Select
                  id={id}
                  value="default"
                  disabled
                  options={[{ value: 'default', label: 'Use default model' }]}
                  onValueChange={() => undefined}
                />
              </div>
            );
          })}
        </div>
      </DetailsCard>

      <p className={styles.note}>
        <LockSimple size={14} aria-hidden="true" />
        Local-only keys · Masked, kept in tab memory, and excluded from exports. Reloading clears
        them.
      </p>
    </>
  );
}

function RuntimeCheckButton({ url }: { url: string }) {
  const toast = useToast();
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    const client = new HttpAgentClient(url);
    try {
      const health = await client.health(AbortSignal.timeout(5_000));
      toast(
        `Runtime online · v${health.version} · ${health.runs.running} running run${
          health.runs.running === 1 ? '' : 's'
        }`,
      );
    } catch (error) {
      if (error instanceof AgentRuntimeUnavailableError) {
        toast(`Could not reach ${client.baseUrl}. Is the Agent Runtime started?`, {
          tone: 'light',
        });
      } else if (error instanceof AgentRuntimeError) {
        toast(`Runtime error: ${error.message}`, { tone: 'light' });
      } else {
        toast('Connection check timed out.', { tone: 'light' });
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <Button size="sm" variant="secondary" disabled={checking} onClick={check}>
      <CloudCheck size={15} aria-hidden="true" /> {checking ? 'Checking…' : 'Check'}
    </Button>
  );
}

interface ProviderRowProps {
  provider: ProviderConfig;
  hasKey: boolean;
  onConfigure: () => void;
  onRemove: () => void;
}

function ProviderRow({ provider, hasKey, onConfigure, onRemove }: ProviderRowProps) {
  const capabilities = (Object.keys(CAPABILITY_LABELS) as (keyof typeof CAPABILITY_LABELS)[])
    .filter((key) => provider.capabilities[key])
    .map((key) => CAPABILITY_LABELS[key]);

  return (
    <div className={styles.providerRow}>
      <div>
        <div className={styles.providerName}>
          {provider.name}
          <Pill>{hasKey ? 'Key in session' : 'Key needed'}</Pill>
        </div>
        <p className={styles.providerMeta}>
          {provider.type} · {provider.model}
        </p>
        <p className={styles.providerCaps}>
          {capabilities.length ? capabilities.join(' · ') : 'No capabilities declared'} ·{' '}
          {provider.context ? `${provider.context.toLocaleString()} tokens` : 'Context unknown'} ·{' '}
          {provider.tested && provider.latency !== null
            ? `Tested · ${provider.latency} ms`
            : 'Not tested'}
        </p>
      </div>
      <div className={styles.providerActions}>
        <Button size="sm" onClick={onConfigure}>
          Configure
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}
