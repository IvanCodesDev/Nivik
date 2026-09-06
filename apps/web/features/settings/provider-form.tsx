'use client';

import { Button, cn, Input, Select, useToast } from '@nivik/ui';
import { ArrowLeft, ArrowsClockwise } from '@phosphor-icons/react';
import { useState } from 'react';
import {
  COMPATIBILITY_OPTIONS,
  fetchModels,
  type ProbeTarget,
  providerTypeDefaults,
  testConnection,
  validateBaseUrl,
} from '@/lib/provider-probe';
import {
  type ApiCompatibility,
  CAPABILITY_KEYS,
  type CapabilityKey,
  PROVIDER_TYPES,
  type ProviderCapabilities,
  type ProviderConfig,
  type ProviderType,
  useProviderKeys,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import { CardHeading, DetailsCard, RowsCard, SettingRow } from './primitives';
import styles from './settings.module.css';

const CUSTOM_TYPE: ProviderType = 'OpenAI-compatible Custom Provider';

const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  text: 'Text',
  vision: 'Vision',
  tools: 'Tool Calling',
  json: 'Structured Output / JSON',
  thinking: 'Thinking',
};

const TYPE_OPTIONS = PROVIDER_TYPES.map((type) => ({ value: type, label: type }));

type StepState = 'idle' | 'running' | 'ok' | 'error';
interface TestState {
  status: StepState;
  steps: Record<'url' | 'key' | 'model', StepState>;
  elapsedMs: number | null;
  message: string;
}

const IDLE_TEST: TestState = {
  status: 'idle',
  steps: { url: 'idle', key: 'idle', model: 'idle' },
  elapsedMs: null,
  message: 'Not tested · Sends one short request to your provider. Usage charges may apply.',
};

const STEP_GLYPH: Record<StepState, string> = { idle: '○', running: '…', ok: '✓', error: '!' };

interface FormState {
  name: string;
  type: ProviderType;
  url: string;
  apiKey: string;
  model: string;
  compatibility: ApiCompatibility;
  capabilities: ProviderCapabilities;
  context: string;
}

function initialForm(existing: ProviderConfig | undefined, existingKey: string): FormState {
  if (existing) {
    return {
      name: existing.name,
      type: existing.type,
      url: existing.url,
      apiKey: existingKey,
      model: existing.model,
      compatibility: existing.compatibility,
      capabilities: { ...existing.capabilities },
      context: existing.context ? String(existing.context) : '',
    };
  }
  const defaults = providerTypeDefaults('OpenAI');
  return {
    name: 'OpenAI',
    type: 'OpenAI',
    url: defaults.url,
    apiKey: '',
    model: '',
    compatibility: defaults.compatibility,
    capabilities: { text: true, vision: false, tools: false, json: false, thinking: false },
    context: '',
  };
}

interface ProviderFormProps {
  providerId: string | null;
  onDone: () => void;
}

/** Inline sub-page of AI & Models for adding or editing a custom provider. */
export function ProviderForm({ providerId, onDone }: ProviderFormProps) {
  const toast = useToast();
  const existing = useSettingsStore((s) =>
    providerId ? s.draft.providers.find((p) => p.id === providerId) : undefined,
  );
  const timeout = useSettingsStore((s) => s.draft.timeout);
  const upsertProvider = useSettingsStore((s) => s.upsertProvider);
  const existingKey = useProviderKeys((s) => (providerId ? s.keys[providerId] : undefined));
  const setKey = useProviderKeys((s) => s.setKey);
  const deleteKey = useProviderKeys((s) => s.deleteKey);

  const [form, setForm] = useState<FormState>(() => initialForm(existing, existingKey ?? ''));
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>(IDLE_TEST);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const patch = (changes: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...changes }));
    setTest(IDLE_TEST);
  };

  const onTypeChange = (type: ProviderType) => {
    const defaults = providerTypeDefaults(type);
    patch({
      type,
      url: defaults.url || form.url,
      compatibility: defaults.compatibility,
      name: type === CUSTOM_TYPE ? form.name : type,
    });
  };

  const probeTarget = (): { ok: false; error: string } | { ok: true; target: ProbeTarget } => {
    const url = validateBaseUrl(form.url);
    if (!url.ok) return { ok: false, error: url.reason };
    return {
      ok: true,
      target: {
        url: url.url,
        apiKey: form.apiKey.trim(),
        compatibility: form.compatibility,
        timeout,
      },
    };
  };

  const loadModels = async () => {
    const probe = probeTarget();
    if (!probe.ok) {
      toast(probe.error);
      return;
    }
    setFetchingModels(true);
    const result = await fetchModels(probe.target);
    setFetchingModels(false);
    if (!result.ok) {
      toast(result.message);
      return;
    }
    setSuggestions(result.data.slice(0, 12));
    toast(result.data.length ? `${result.data.length} models available.` : 'No models returned.');
  };

  const runTest = async () => {
    const probe = probeTarget();
    if (!probe.ok) {
      setTest({
        status: 'error',
        steps: { url: 'error', key: 'idle', model: 'idle' },
        elapsedMs: null,
        message: probe.error,
      });
      return;
    }
    if (!form.apiKey.trim()) {
      setTest({
        status: 'error',
        steps: { url: 'ok', key: 'error', model: 'idle' },
        elapsedMs: null,
        message: 'API key is required to test the connection.',
      });
      return;
    }
    if (!form.model.trim()) {
      setTest({
        status: 'error',
        steps: { url: 'ok', key: 'ok', model: 'error' },
        elapsedMs: null,
        message: 'Enter a model name before testing.',
      });
      return;
    }
    setTest({
      status: 'running',
      steps: { url: 'ok', key: 'running', model: 'running' },
      elapsedMs: null,
      message: 'Contacting provider…',
    });
    const result = await testConnection(probe.target, form.model.trim());
    if (result.ok) {
      setTest({
        status: 'ok',
        steps: { url: 'ok', key: 'ok', model: 'ok' },
        elapsedMs: result.elapsedMs,
        message:
          'Connected. API key accepted and model response received. Advanced capabilities have not been tested.',
      });
      return;
    }
    const keyProblem = /API key rejected|Access denied/.test(result.message);
    setTest({
      status: 'error',
      steps: { url: 'ok', key: keyProblem ? 'error' : 'ok', model: keyProblem ? 'idle' : 'error' },
      elapsedMs: result.elapsedMs,
      message: result.message,
    });
  };

  const save = () => {
    const name = form.name.trim();
    const model = form.model.trim();
    const url = validateBaseUrl(form.url);
    if (!name) return toast('Provider name is required.');
    if (!url.ok) return toast(url.reason);
    if (!model) return toast('Model name is required.');

    const id = existing?.id ?? crypto.randomUUID();
    const context = Number.parseInt(form.context, 10);
    upsertProvider({
      id,
      name,
      type: form.type,
      url: url.url,
      compatibility: form.compatibility,
      model,
      context: Number.isFinite(context) && context > 0 ? context : null,
      capabilities: { ...form.capabilities },
      tested: test.status === 'ok',
      latency: test.status === 'ok' ? test.elapsedMs : null,
    });
    if (form.apiKey.trim()) setKey(id, form.apiKey.trim());
    toast('Provider configured. Save changes to keep its settings on this device.');
    onDone();
  };

  const agentReady = form.capabilities.tools && form.capabilities.json;
  const footerHint =
    test.status === 'ok'
      ? 'Connection verified. Ready to save.'
      : test.status === 'error'
        ? 'Test failed. You may save the configuration as unverified.'
        : 'Test your configuration before saving.';

  return (
    <>
      <p className={styles.breadcrumb}>
        AI &amp; Models › <span>{existing ? existing.name : 'Custom Provider'}</span>
      </p>
      <div className={styles.formHead}>
        <div className={styles.sectionHead} style={{ marginBottom: 0 }}>
          <h2>{existing ? 'Configure Provider' : 'Custom Provider'}</h2>
          <p>Configure a custom AI provider to use with Nivik.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDone}>
          <ArrowLeft size={15} aria-hidden="true" /> Back to AI &amp; Models
        </Button>
      </div>

      <RowsCard>
        <CardHeading
          title="Provider Configuration"
          description="Basic information about your provider."
        />
        <SettingRow
          htmlFor="provider-name"
          label="Provider Name"
          width="form"
          compact
          control={
            <Input
              id="provider-name"
              placeholder="e.g. My OpenAI"
              value={form.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          }
        />
        <SettingRow
          htmlFor="provider-type"
          label="Provider Type"
          width="form"
          compact
          control={
            <Select
              id="provider-type"
              value={form.type}
              options={TYPE_OPTIONS}
              onValueChange={onTypeChange}
            />
          }
        />
        <SettingRow
          htmlFor="provider-url"
          label="Base URL"
          description="https only, except localhost."
          width="form"
          compact
          control={
            <Input
              id="provider-url"
              placeholder="https://api.openai.com/v1"
              value={form.url}
              onChange={(event) => patch({ url: event.target.value })}
            />
          }
        />
        <SettingRow
          htmlFor="provider-key"
          label="API Key"
          description="Masked and kept in memory for this tab only."
          width="form"
          compact
          control={
            <div className={styles.controlStack}>
              <div className={styles.keyField}>
                <Input
                  id="provider-key"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={form.apiKey}
                  onChange={(event) => patch({ apiKey: event.target.value })}
                />
                <button
                  type="button"
                  className={styles.keyToggle}
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              {(form.apiKey || existingKey) && (
                <div className={styles.keyActions}>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => patch({ apiKey: '' })}
                  >
                    Replace key
                  </button>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => {
                      if (providerId) deleteKey(providerId);
                      patch({ apiKey: '' });
                      toast('API key removed from this tab.');
                    }}
                  >
                    Delete key
                  </button>
                </div>
              )}
            </div>
          }
        />
        <SettingRow
          htmlFor="provider-model"
          label="Model Name"
          description="Fetch available models, or enter a model ID manually."
          width="form"
          compact
          control={
            <div className={styles.controlStack}>
              <div className={styles.inline}>
                <Input
                  id="provider-model"
                  placeholder="gpt-4o-mini"
                  value={form.model}
                  onChange={(event) => patch({ model: event.target.value })}
                />
                <Button size="md" onClick={loadModels} disabled={fetchingModels}>
                  <ArrowsClockwise size={15} aria-hidden="true" /> Models
                </Button>
              </div>
              {suggestions.length > 0 && (
                <div className={styles.suggestions}>
                  {suggestions.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={styles.suggestion}
                      onClick={() => patch({ model: id })}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              )}
            </div>
          }
        />
        <SettingRow
          htmlFor="provider-compat"
          label="API Compatibility"
          width="form"
          compact
          control={
            <Select
              id="provider-compat"
              value={form.compatibility}
              options={COMPATIBILITY_OPTIONS}
              onValueChange={(compatibility) => patch({ compatibility })}
            />
          }
        />

        <div className={styles.testBox}>
          <Button variant="primary" onClick={runTest} disabled={test.status === 'running'}>
            Test Connection
          </Button>
          <div className={styles.testSteps}>
            {(
              [
                ['url', 'Base URL'],
                ['key', 'API Key'],
                ['model', 'Model'],
              ] as const
            ).map(([key, label]) => (
              <span key={key}>
                <i data-state={test.steps[key]} aria-hidden="true">
                  {STEP_GLYPH[test.steps[key]]}
                </i>
                {label}
              </span>
            ))}
            <span className={styles.testTiming}>
              {test.elapsedMs === null
                ? 'Response time —'
                : test.status === 'ok'
                  ? `Response time ${test.elapsedMs} ms`
                  : `Elapsed ${test.elapsedMs} ms`}
            </span>
          </div>
          <p
            className={cn(
              styles.testResult,
              test.status === 'ok' && styles.ok,
              test.status === 'error' && styles.error,
            )}
            role="status"
          >
            {test.message}
          </p>
        </div>
      </RowsCard>

      <DetailsCard
        title="Model Capabilities"
        description="Declare the features supported by this model."
        defaultOpen
      >
        <div className={styles.capabilities}>
          {CAPABILITY_KEYS.map((key) => (
            <label key={key} className={styles.capability}>
              <input
                type="checkbox"
                checked={form.capabilities[key]}
                onChange={(event) =>
                  patch({ capabilities: { ...form.capabilities, [key]: event.target.checked } })
                }
              />
              {CAPABILITY_LABELS[key]}
            </label>
          ))}
        </div>
        <SettingRow
          htmlFor="provider-context"
          label="Context Length"
          description="Tokens the model can read at once."
          width="narrow"
          compact
          control={
            <Input
              id="provider-context"
              type="number"
              min={1}
              placeholder="Unknown"
              value={form.context}
              onChange={(event) => patch({ context: event.target.value })}
            />
          }
        />
        {!agentReady && (
          <p className={styles.warning}>
            Nivik Agent needs tool calling and structured output. Without them, planning and
            validation may be limited.
          </p>
        )}
        <p className={styles.quietNote}>
          Capabilities are declared by you, not automatically verified.
        </p>
      </DetailsCard>

      <div className={styles.formFooter}>
        <p className={styles.formHint}>{footerHint}</p>
        <div className={styles.footerActions}>
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save provider
          </Button>
        </div>
      </div>
      <p className={styles.note}>
        Direct connections require browser access (CORS). API keys are sent only to your Base URL
        and cleared on reload.
      </p>
    </>
  );
}
