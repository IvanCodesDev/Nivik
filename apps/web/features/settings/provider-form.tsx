'use client';

import { inferProviderKind, type ProbeReport, type ProviderCapabilities } from '@nivik/protocol';
import { Button, cn, Input, Pill, Select, type SelectOption, useToast } from '@nivik/ui';
import { ArrowLeft, ArrowsClockwise } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { forgetKey, persistKey } from '@/lib/provider-keys';
import {
  CUSTOM_PRESET,
  capabilitiesFromReport,
  fetchModels,
  PRESETS,
  type ProbeFailure,
  type ProbeTarget,
  presetFor,
  probeCapabilities,
  probeStepsFromReport,
  suggestName,
  validateBaseUrl,
} from '@/lib/provider-probe';
import {
  API_COMPATIBILITIES,
  type ApiCompatibility,
  type ProviderConfig,
  useProviderKeys,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import { CardHeading, RowsCard, SettingRow } from './primitives';
import styles from './settings.module.css';

type StepState = 'idle' | 'running' | 'ok' | 'error';
type TestMessage =
  | { kind: 'idle' }
  | { kind: 'contacting' }
  | { kind: 'connected' }
  | { kind: 'key-required' }
  | { kind: 'model-required' }
  | { kind: 'failure'; failure: Pick<ProbeFailure, 'code' | 'detail'> };

interface TestState {
  status: StepState;
  steps: Record<'url' | 'key' | 'model', StepState>;
  elapsedMs: number | null;
  message: TestMessage;
  /** Spec 05 §9.3 report of the last successful probe; what Save stores as capabilities. */
  report: ProbeReport | null;
}

const IDLE_TEST: TestState = {
  status: 'idle',
  steps: { url: 'idle', key: 'idle', model: 'idle' },
  elapsedMs: null,
  message: { kind: 'idle' },
  report: null,
};

/** Human-readable context window: 131072 → "128K", 1048576 → "1M". */
export function formatContextLength(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_048_576) || 1}M`;
  return `${Math.round(tokens / 1024)}K`;
}

const STEP_GLYPH: Record<StepState, string> = { idle: '○', running: '…', ok: '✓', error: '!' };

interface FormState {
  presetId: string;
  url: string;
  compatibility: ApiCompatibility;
  apiKey: string;
  model: string;
  name: string;
  /** Once the user edits the display name we stop suggesting one from the preset / host. */
  nameTouched: boolean;
}

function initialForm(existing: ProviderConfig | undefined, existingKey: string): FormState {
  if (existing) {
    const preset = PRESETS.find(
      (p) => p.url === existing.url && p.compatibility === existing.compatibility,
    );
    return {
      presetId: preset?.id ?? CUSTOM_PRESET.id,
      url: existing.url,
      compatibility: existing.compatibility,
      apiKey: existingKey,
      model: existing.model,
      name: existing.name,
      nameTouched: true,
    };
  }
  return {
    presetId: CUSTOM_PRESET.id,
    url: CUSTOM_PRESET.url,
    compatibility: CUSTOM_PRESET.compatibility,
    apiKey: '',
    model: '',
    name: '',
    nameTouched: false,
  };
}

interface ProviderFormProps {
  providerId: string | null;
  onDone: () => void;
}

/** Inline sub-page of AI & Models for adding or editing a model endpoint. */
export function ProviderForm({ providerId, onDone }: ProviderFormProps) {
  const t = useT();
  const copy = t.settings.providerForm;
  const toast = useToast();
  const existing = useSettingsStore((s) =>
    providerId ? s.draft.providers.find((p) => p.id === providerId) : undefined,
  );
  const upsertProvider = useSettingsStore((s) => s.upsertProvider);
  // Keys follow the *saved* storage mode: a draft switch only takes effect on Save changes.
  const keyStorage = useSettingsStore((s) => s.saved.keyStorage);
  const runtimeUrl = useSettingsStore((s) => s.saved.agentRuntimeUrl.trim() || null);
  const existingKey = useProviderKeys((s) => (providerId ? s.keys[providerId] : undefined));

  const [form, setForm] = useState<FormState>(() => initialForm(existing, existingKey ?? ''));
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>(IDLE_TEST);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const presetOptions = useMemo<SelectOption[]>(
    () =>
      PRESETS.map((preset) => ({
        value: preset.id,
        label: preset.id === CUSTOM_PRESET.id ? copy.presetCustom : preset.name,
      })),
    [copy],
  );

  const formatOptions = useMemo<SelectOption<ApiCompatibility>[]>(
    () => API_COMPATIBILITIES.map((value) => ({ value, label: copy.formatOptions[value] })),
    [copy],
  );

  const failureText = (failure: Pick<ProbeFailure, 'code' | 'detail'>) =>
    failure.detail ? `${copy.errors[failure.code]} ${failure.detail}` : copy.errors[failure.code];

  const messageText = (message: TestMessage): string => {
    switch (message.kind) {
      case 'idle':
        return copy.notTested;
      case 'contacting':
        return copy.contacting;
      case 'connected':
        return copy.connected;
      case 'key-required':
        return copy.keyRequired;
      case 'model-required':
        return copy.modelRequired;
      case 'failure':
        return failureText(message.failure);
    }
  };

  const patch = (changes: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...changes }));
    setTest(IDLE_TEST);
  };

  const onPresetChange = (presetId: string) => {
    const preset = presetFor(presetId) ?? CUSTOM_PRESET;
    const url = preset.url || form.url;
    patch({
      presetId,
      url,
      compatibility: preset.compatibility,
      name: form.nameTouched ? form.name : suggestName(preset, url),
    });
  };

  const onUrlChange = (url: string) => {
    patch({
      url,
      name: form.nameTouched ? form.name : suggestName(presetFor(form.presetId), url),
    });
  };

  const probeTarget = ():
    | { ok: false; failure: Pick<ProbeFailure, 'code'> }
    | { ok: true; target: ProbeTarget } => {
    const url = validateBaseUrl(form.url);
    if (!url.ok) return { ok: false, failure: { code: url.code } };
    return {
      ok: true,
      target: { url: url.url, apiKey: form.apiKey.trim(), compatibility: form.compatibility },
    };
  };

  const loadModels = async () => {
    const probe = probeTarget();
    if (!probe.ok) {
      toast(failureText(probe.failure));
      return;
    }
    setFetchingModels(true);
    const result = await fetchModels(probe.target);
    setFetchingModels(false);
    if (!result.ok) {
      toast(failureText(result));
      return;
    }
    setSuggestions(result.data.slice(0, 12));
    toast(result.data.length ? copy.modelsAvailable(result.data.length) : copy.noModels);
  };

  const runTest = async () => {
    const probe = probeTarget();
    if (!probe.ok) {
      setTest({
        status: 'error',
        steps: { url: 'error', key: 'idle', model: 'idle' },
        elapsedMs: null,
        message: { kind: 'failure', failure: probe.failure },
        report: null,
      });
      return;
    }
    if (!form.apiKey.trim()) {
      setTest({
        status: 'error',
        steps: { url: 'ok', key: 'error', model: 'idle' },
        elapsedMs: null,
        message: { kind: 'key-required' },
        report: null,
      });
      return;
    }
    if (!form.model.trim()) {
      setTest({
        status: 'error',
        steps: { url: 'ok', key: 'ok', model: 'error' },
        elapsedMs: null,
        message: { kind: 'model-required' },
        report: null,
      });
      return;
    }
    setTest({
      status: 'running',
      steps: { url: 'ok', key: 'running', model: 'running' },
      elapsedMs: null,
      message: { kind: 'contacting' },
      report: null,
    });
    // Spec 05 §9.3: one Test Connection = the whole probe set (models, text, json, tools).
    const report = await probeCapabilities(probe.target, form.model.trim(), { runtimeUrl });
    const view = probeStepsFromReport(report);
    if (view.failure === null) {
      setTest({
        status: 'ok',
        steps: view.steps,
        elapsedMs: view.elapsedMs,
        message: { kind: 'connected' },
        report,
      });
      return;
    }
    setTest({
      status: 'error',
      steps: view.steps,
      elapsedMs: view.elapsedMs,
      message: { kind: 'failure', failure: view.failure },
      report: null,
    });
  };

  const save = () => {
    const url = validateBaseUrl(form.url);
    const model = form.model.trim();
    const name = form.name.trim() || suggestName(presetFor(form.presetId), form.url);
    if (!url.ok) return toast(copy.errors[url.code]);
    if (!model) return toast(copy.modelNameRequired);
    if (!name) return toast(copy.nameRequired);

    const id = existing?.id ?? crypto.randomUUID();
    const probed: ProviderCapabilities | null = test.report
      ? capabilitiesFromReport(test.report)
      : null;
    const verifiedNow =
      test.status === 'ok' && test.elapsedMs !== null
        ? { at: Date.now(), latencyMs: test.elapsedMs, detected: probed !== null }
        : null;
    upsertProvider({
      id,
      name,
      url: url.url,
      compatibility: form.compatibility,
      kind: inferProviderKind(url.url, form.compatibility),
      model,
      transport: existing?.transport ?? 'auto',
      capabilities: probed ?? existing?.capabilities ?? null,
      verified: verifiedNow ?? existing?.verified ?? null,
    });
    if (form.apiKey.trim()) void persistKey(id, form.apiKey.trim(), keyStorage);
    toast(copy.saved);
    onDone();
  };

  const footerHint =
    test.status === 'ok'
      ? copy.hintVerified
      : test.status === 'error'
        ? copy.hintFailed
        : copy.hintTest;

  const steps = [
    ['url', copy.stepUrl],
    ['key', copy.stepKey],
    ['model', copy.stepModel],
  ] as const;

  return (
    <>
      <p className={styles.breadcrumb}>
        {copy.root} › <span>{existing ? existing.name : copy.addTitle}</span>
      </p>
      <div className={styles.formHead}>
        <div className={styles.sectionHead} style={{ marginBottom: 0 }}>
          <h2>{existing ? copy.configureTitle : copy.addTitle}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDone}>
          <ArrowLeft size={15} aria-hidden="true" /> {copy.back}
        </Button>
      </div>

      <RowsCard>
        <CardHeading title={copy.configuration} description={copy.configurationDescription} />
        <SettingRow
          htmlFor="provider-preset"
          label={copy.preset}
          description={copy.presetDescription}
          width="form"
          compact
          control={
            <Select
              id="provider-preset"
              value={form.presetId}
              options={presetOptions}
              onValueChange={onPresetChange}
            />
          }
        />
        <SettingRow
          htmlFor="provider-format"
          label={copy.format}
          width="form"
          compact
          control={
            <Select
              id="provider-format"
              value={form.compatibility}
              options={formatOptions}
              onValueChange={(compatibility) => patch({ compatibility })}
            />
          }
        />
        <SettingRow
          htmlFor="provider-url"
          label={copy.baseUrl}
          description={copy.baseUrlDescription}
          width="form"
          compact
          control={
            <Input
              id="provider-url"
              type="url"
              inputMode="url"
              spellCheck={false}
              placeholder="https://api.openai.com/v1"
              value={form.url}
              onChange={(event) => onUrlChange(event.target.value)}
            />
          }
        />
        <SettingRow
          htmlFor="provider-key"
          label={copy.apiKey}
          description={copy.apiKeyDescription}
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
                  {showKey ? copy.hide : copy.show}
                </button>
              </div>
              {(form.apiKey || existingKey) && (
                <div className={styles.keyActions}>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => patch({ apiKey: '' })}
                  >
                    {copy.replaceKey}
                  </button>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => {
                      if (providerId) void forgetKey(providerId);
                      patch({ apiKey: '' });
                      toast(copy.keyRemoved);
                    }}
                  >
                    {copy.deleteKey}
                  </button>
                </div>
              )}
            </div>
          }
        />
        <SettingRow
          htmlFor="provider-model"
          label={copy.model}
          description={copy.modelDescription}
          width="form"
          compact
          control={
            <div className={styles.controlStack}>
              <div className={styles.inline}>
                <Input
                  id="provider-model"
                  spellCheck={false}
                  placeholder="gpt-4o-mini"
                  value={form.model}
                  onChange={(event) => patch({ model: event.target.value })}
                />
                <Button size="md" onClick={loadModels} disabled={fetchingModels}>
                  <ArrowsClockwise size={15} aria-hidden="true" /> {copy.models}
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
          htmlFor="provider-name"
          label={copy.name}
          description={copy.nameDescription}
          width="form"
          compact
          control={
            <Input
              id="provider-name"
              placeholder={copy.namePlaceholder}
              value={form.name}
              onChange={(event) => patch({ name: event.target.value, nameTouched: true })}
            />
          }
        />

        <div className={styles.testBox}>
          <Button variant="primary" onClick={runTest} disabled={test.status === 'running'}>
            {copy.test}
          </Button>
          <div className={styles.testSteps}>
            {steps.map(([key, label]) => (
              <span key={key}>
                <i data-state={test.steps[key]} aria-hidden="true">
                  {STEP_GLYPH[test.steps[key]]}
                </i>
                {label}
              </span>
            ))}
            <span className={styles.testTiming}>
              {test.elapsedMs === null
                ? copy.responseTimeNone
                : test.status === 'ok'
                  ? copy.responseTime(test.elapsedMs)
                  : copy.elapsed(test.elapsedMs)}
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
            {messageText(test.message)}
          </p>
          {test.report && (
            <ul className={styles.capabilities} aria-label={copy.capabilities}>
              {(
                [
                  ['text', test.report.text],
                  ['json', test.report.json],
                  ['tools', test.report.tools],
                  ...(test.report.vision === null ? [] : [['vision', test.report.vision] as const]),
                ] as const
              ).map(([name, supported]) => (
                <li key={name}>
                  <Pill className={cn(styles.capability, supported ? styles.ok : styles.missing)}>
                    {supported ? '✓' : '✗'} {copy.capabilityNames[name]}
                  </Pill>
                </li>
              ))}
              {test.report.contextLength && (
                <li>
                  <Pill className={styles.capability}>
                    {copy.contextLength(
                      formatContextLength(test.report.contextLength.value),
                      test.report.contextLength.estimated,
                    )}
                  </Pill>
                </li>
              )}
              {test.report.models && (
                <li>
                  <Pill className={styles.capability}>
                    {copy.modelsListed(test.report.models.length)}
                  </Pill>
                </li>
              )}
            </ul>
          )}
        </div>
      </RowsCard>

      <div className={styles.formFooter}>
        <p className={styles.formHint}>{footerHint}</p>
        <div className={styles.footerActions}>
          <Button onClick={onDone}>{t.common.cancel}</Button>
          <Button variant="primary" onClick={save}>
            {copy.save}
          </Button>
        </div>
      </div>
      <p className={styles.note}>{copy.note}</p>
    </>
  );
}
