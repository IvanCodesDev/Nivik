'use client';

import { isId, newChangeSetId } from '@nivik/ir';
import type { LiveHooks } from '@nivik/renderer-core';
import { Button, cn, IconButton, Select, type SelectOption, useToast } from '@nivik/ui';
import {
  CornersOut,
  ListMagnifyingGlass,
  PaperPlaneRight,
  Question,
  SlidersHorizontal,
  Sparkle,
} from '@phosphor-icons/react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Popover } from 'radix-ui';
import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import { TopBar } from '@/components/top-bar';
import { LocalAgentClient, resolveAgentClient } from '@/lib/agent-client';
import { RENDERERS, type RendererId } from '@/lib/data/integrations';
import { findTemplate } from '@/lib/data/templates';
import { installDebugHook } from '@/lib/debug-hook';
import { useLocale, useT } from '@/lib/i18n/provider';
import { templateCopy } from '@/lib/i18n/template-copy';
import { createRunOrchestrator, type RunNotice } from '@/lib/run-orchestrator';
import { diagramStore, useDiagramStore } from '@/lib/stores/diagram-store';
import { useRendererStore } from '@/lib/stores/renderer-store';
import { useRunOverrides } from '@/lib/stores/run-overrides-store';
import { useRunStore } from '@/lib/stores/run-store';
import {
  canvasBackgroundVar,
  type SettingsRenderer,
  useProviderKeys,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import { useResolvedTheme } from '@/lib/theme/use-resolved-theme';
import styles from './canvas.module.css';
import { ChangeReviewBar } from './change-review-bar';
import { RunDrawer } from './run-drawer';
import { RunStatusPill } from './run-status-pill';
import { SketchHint } from './sketch-hint';

// Excalidraw touches `window` at import time, so the host only ever renders on the client.
const RendererHost = dynamic(() => import('./renderer-host').then((m) => m.RendererHost), {
  ssr: false,
});

/** Picker value meaning "no override, use the saved default model". */
const DEFAULT_MODEL_CHOICE = 'default';

type Direction = 'horizontal' | 'vertical';

function resolveRenderer(param: string | null, fallback: SettingsRenderer): RendererId {
  const match = RENDERERS.find((r) => r.id === param?.toLowerCase());
  return match ? match.id : fallback;
}

interface CanvasWorkspaceProps {
  diagramId: string;
}

/**
 * Canvas Workspace (PRD 5.2, spec 07 §3). Opens the stored diagram, mounts the renderer and wires
 * the composer to the RunOrchestrator: prompt → change set → layout → persisted IR → live canvas.
 * User edits on the canvas come back through the renderer hooks into the same diagram store.
 */
export function CanvasWorkspace({ diagramId }: CanvasWorkspaceProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const saved = useSettingsStore((s) => s.saved);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const temporaryModel = useRunOverrides((s) => s.temporaryModel);
  const setTemporaryModel = useRunOverrides((s) => s.setTemporaryModel);
  const consumeTemporaryModel = useRunOverrides((s) => s.consumeTemporaryModel);
  const theme = useResolvedTheme(saved.theme);

  const status = useDiagramStore((s) => s.status);
  const loadError = useDiagramStore((s) => s.error);
  const diagram = useDiagramStore((s) => s.diagram);
  const nodeCount = useDiagramStore((s) => s.diagram?.nodes.length ?? 0);
  const layoutDirection = useDiagramStore((s) => s.diagram?.layout.direction ?? 'RIGHT');
  const latestGroup = useDiagramStore((s) => s.history.undo.at(-1)?.group);
  const session = useRendererStore((s) => s.session);
  const setSession = useRendererStore((s) => s.setSession);
  const setSelection = useRendererStore((s) => s.setSelection);
  const setViewport = useRendererStore((s) => s.setViewport);
  const currentRun = useRunStore((s) => s.current);
  const recentRuns = useRunStore((s) => s.recent);
  const review = useRunStore((s) => s.review);
  const drawerOpen = useRunStore((s) => s.drawerOpen);
  const setDrawerOpen = useRunStore((s) => s.setDrawerOpen);
  const setReview = useRunStore((s) => s.setReview);

  const template = findTemplate(params.get('template'));
  const renderer = RENDERERS.find(
    (r) => r.id === resolveRenderer(params.get('renderer'), saved.renderer),
  );
  const validId = isId(diagramId);

  // Third-party renderers ship their own canvas chrome (Excalidraw puts a zoom island bottom-left
  // and a help button bottom-right); ours would stack on top of theirs. Only our own engine leaves
  // that row free, so the floating help / fit controls belong to it alone.
  const nativeCanvas = renderer?.id === 'nivik';

  // Only offered once at least one model is configured; a single model has nothing to switch to.
  const modelOptions = useMemo<SelectOption[]>(() => {
    const configured = saved.providers.map((p) => ({
      value: p.id,
      label: `${p.name} · ${p.model}`,
    }));
    const current = configured.find((o) => o.value === saved.defaultModel);
    if (!current) return [];
    return [
      { value: DEFAULT_MODEL_CHOICE, label: t.canvas.defaultModel(current.label) },
      ...configured.filter((o) => o.value !== saved.defaultModel),
    ];
  }, [saved.providers, saved.defaultModel, t]);

  const [prompt, setPrompt] = useState(() => params.get('prompt') ?? '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Anything the user draws counts, long before it becomes a node — the hint must not sit under it.
  const [canvasEmpty, setCanvasEmpty] = useState(true);

  // The name only seeds a brand-new diagram, so it is read once rather than reloading on change.
  const initialNameRef = useRef(template?.title ?? t.canvas.untitled);
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;

  // Open (or create) the stored diagram for this route; leaving the page resets the store.
  useEffect(() => {
    if (!validId) return;
    diagramStore
      .getState()
      .load(diagramId, { name: initialNameRef.current })
      .catch((error: unknown) => {
        toastRef.current(error instanceof Error ? error.message : tRef.current.canvas.failed, {
          tone: 'light',
        });
      });
    return () => diagramStore.getState().reset();
  }, [diagramId, validId]);

  const notify = (notice: RunNotice) => {
    const copy = tRef.current.canvas;
    const show = toastRef.current;
    switch (notice.kind) {
      case 'offline':
        show(copy.offlineLocal, { tone: 'light' });
        break;
      case 'conflict':
        show(copy.conflict(notice.ids.length), { tone: 'light' });
        break;
      case 'error':
        show(copy.agentStopped(notice.message), { tone: 'light' });
        break;
      case 'aborted':
        show(copy.stopped);
        break;
      case 'done':
        show(copy.applied);
        break;
    }
  };
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const orchestrator = useMemo(
    () =>
      createRunOrchestrator({
        diagram: diagramStore,
        run: useRunStore,
        // Worker locally, HTTP when a runtime is configured (spec 07 §1.1); keys are read per run.
        client: () => resolveAgentClient(savedRef.current, useProviderKeys.getState().keys),
        fallback: () => new LocalAgentClient(),
        onNotice: (notice) => notifyRef.current(notice),
      }),
    [],
  );

  // Leaving the page cancels an in-flight run.
  useEffect(() => () => orchestrator.abort(), [orchestrator]);

  useEffect(() => installDebugHook(), []);

  useEffect(() => {
    if (params.get('focus') === 'composer' || params.get('prompt')) inputRef.current?.focus();
  }, [params]);

  // Announce the starter template once per workspace visit.
  const announcedRef = useRef<string | null>(null);
  useEffect(() => {
    if (template && announcedRef.current !== template.id) {
      announcedRef.current = template.id;
      toast(t.canvas.templateLoaded(templateCopy(t, template).title), { tone: 'light' });
    }
  }, [template, toast, t]);

  const hooks: LiveHooks = {
    onChange: (cs) => {
      void diagramStore
        .getState()
        .apply(cs)
        .then((outcome) => {
          if (!outcome.ok) toast(t.canvas.applyFailed(outcome.error.message), { tone: 'light' });
        });
    },
    onEmptyChange: setCanvasEmpty,
    onSelectionChange: setSelection,
    onViewportChange: setViewport,
    onWarning: (warning) => toast(warning.message, { tone: 'light' }),
    onError: (error) => toast(t.canvas.rendererError(error.message), { tone: 'light' }),
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) {
      toast(t.canvas.emptyPrompt);
      return;
    }
    if (orchestrator.running || status !== 'ready') return;
    const outcome = await orchestrator.start({
      prompt: text,
      renderer: renderer?.id ?? 'excalidraw',
      settings: saved,
      temporaryModel: consumeTemporaryModel(),
    });
    if (outcome.status === 'done') setPrompt('');
  };

  const stopRun = () => orchestrator.abort();

  const acceptReview = () => {
    session?.clearHighlight();
    setReview(null);
  };

  const undoRun = async () => {
    if (!review) return;
    const outcome = await diagramStore.getState().undoGroup(review.runId);
    if (!outcome) toast(t.canvas.undoUnavailable, { tone: 'light' });
    else if (!outcome.ok) toast(t.canvas.applyFailed(outcome.error.message), { tone: 'light' });
    session?.clearHighlight();
    setReview(null);
  };

  // Direction is a diagram property: changing it is a relayout of everything that is not pinned.
  const direction: Direction =
    layoutDirection === 'DOWN' || layoutDirection === 'UP' ? 'vertical' : 'horizontal';
  const changeDirection = (next: Direction) => {
    const d = diagramStore.getState().diagram;
    const target = next === 'vertical' ? 'DOWN' : 'RIGHT';
    if (!d || d.layout.direction === target || d.nodes.length === 0) return;
    void diagramStore
      .getState()
      .apply({
        id: newChangeSetId(),
        diagramId: d.id,
        baseVersion: d.version,
        origin: 'user',
        createdAt: Date.now(),
        summary: `Direction ${target}`,
        actions: [{ op: 'relayout', scope: 'all', layout: { direction: target } }],
      })
      .then((outcome) => {
        if (!outcome.ok) toast(t.canvas.applyFailed(outcome.error.message), { tone: 'light' });
      });
  };

  // The paper stays light in every theme (the user picked its tint), but a light sheet behind a
  // dark canvas would flash white on load, so a dark canvas uses the page colour instead.
  const canvasStyle = {
    '--canvas-bg':
      theme === 'dark' ? 'var(--nv-page)' : canvasBackgroundVar(saved.canvasBackground),
  } as CSSProperties;

  const drawerRun = currentRun ?? recentRuns[0] ?? null;
  const running = currentRun !== null;

  return (
    <div className={styles.workspace} style={canvasStyle} data-diagram-id={diagramId}>
      <div className={styles.paper} aria-hidden="true" />

      {validId && diagram && status === 'ready' ? (
        <RendererHost
          key={diagram.id}
          initial={diagram}
          theme={theme}
          locale={locale}
          hooks={hooks}
          onSession={setSession}
        />
      ) : (
        <p className={styles.notice} role="status">
          {!validId
            ? t.canvas.invalidId
            : status === 'error'
              ? t.canvas.applyFailed(loadError ?? t.canvas.failed)
              : t.canvas.loading}
        </p>
      )}

      <TopBar />

      {currentRun && (
        <RunStatusPill run={currentRun} onStop={stopRun} onOpen={() => setDrawerOpen(true)} />
      )}

      {status === 'ready' && canvasEmpty && nodeCount === 0 && !running && <SketchHint />}

      <RunDrawer open={drawerOpen} run={drawerRun} onClose={() => setDrawerOpen(false)} />

      {review && !running && (
        <ChangeReviewBar
          review={review}
          canUndo={latestGroup === review.runId}
          onAccept={acceptReview}
          onUndo={undoRun}
          onDetails={() => setDrawerOpen(true)}
        />
      )}

      <div className={styles.composerWrap}>
        {renderer && (
          <span className={styles.rendererTag}>
            <Image src={renderer.logo} alt="" width={14} height={14} />
            {renderer.name}
          </span>
        )}
        <form className={styles.composer} onSubmit={submit}>
          <span className={styles.mark} aria-hidden="true">
            <Sparkle size={25} weight="fill" />
          </span>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder={t.canvas.placeholder}
            aria-label={t.canvas.inputLabel}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <Popover.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
            <Popover.Trigger asChild>
              <IconButton className={styles.settingsButton} aria-label={t.canvas.settingsButton}>
                <SlidersHorizontal size={20} aria-hidden="true" />
              </IconButton>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className={styles.settingsPanel}
                side="top"
                align="end"
                sideOffset={14}
                collisionPadding={12}
              >
                <h3>{t.canvas.settingsTitle}</h3>
                <div className={styles.settingsRow}>
                  <span>{t.canvas.direction}</span>
                  <div className={styles.segment} role="group" aria-label={t.canvas.direction}>
                    <button
                      type="button"
                      aria-pressed={direction === 'horizontal'}
                      onClick={() => changeDirection('horizontal')}
                    >
                      {t.canvas.horizontal}
                    </button>
                    <button
                      type="button"
                      aria-pressed={direction === 'vertical'}
                      onClick={() => changeDirection('vertical')}
                    >
                      {t.canvas.vertical}
                    </button>
                  </div>
                </div>
                <div className={styles.settingsRow}>
                  <span>{t.canvas.renderer}</span>
                  <span>{renderer?.name ?? saved.renderer}</span>
                </div>
                {modelOptions.length > 1 && (
                  <div className={cn(styles.settingsRow, styles.settingsStack)}>
                    <label htmlFor="composer-model">
                      {t.canvas.model} <small>{t.canvas.nextGenerationOnly}</small>
                    </label>
                    <Select
                      id="composer-model"
                      value={temporaryModel ?? DEFAULT_MODEL_CHOICE}
                      options={modelOptions}
                      onValueChange={(value) => {
                        const next = value === DEFAULT_MODEL_CHOICE ? null : value;
                        setTemporaryModel(next);
                        toast(
                          next === null ? t.canvas.temporaryCleared : t.canvas.temporaryApplies,
                          { tone: 'light' },
                        );
                      }}
                    />
                  </div>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <button
            type="submit"
            className={styles.submit}
            aria-label={t.canvas.submit}
            disabled={running || status !== 'ready'}
          >
            <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
          </button>
        </form>
      </div>

      {nativeCanvas && (
        <Button variant="surface" className={styles.help} onClick={() => setHelpOpen(true)}>
          <Question size={20} aria-hidden="true" />
          <span>{t.common.help}</span>
        </Button>
      )}

      <div className={styles.controls}>
        <IconButton
          variant="surface"
          className={styles.fit}
          aria-label={t.canvas.openDrawer}
          onClick={() => setDrawerOpen(!drawerOpen)}
        >
          <ListMagnifyingGlass size={18} aria-hidden="true" />
        </IconButton>
        {nativeCanvas && (
          <IconButton
            variant="surface"
            className={styles.fit}
            aria-label={t.canvas.fitToScreen}
            disabled={!session}
            onClick={() => void session?.fit()}
          >
            <CornersOut size={18} aria-hidden="true" />
          </IconButton>
        )}
      </div>

      <ChoiceDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title={t.canvas.helpTitle}
        description={t.canvas.helpDescription}
      />
    </div>
  );
}
