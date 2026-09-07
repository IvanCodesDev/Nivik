'use client';

import { splitSteps } from '@nivik/agent';
import { createDiagram, isId } from '@nivik/ir';
import type { RunStage } from '@nivik/protocol';
import { Button, cn, IconButton, Select, type SelectOption, useToast } from '@nivik/ui';
import {
  ArrowDown,
  ArrowRight,
  CornersOut,
  DotsSixVertical,
  Minus,
  PaperPlaneRight,
  Plus,
  Question,
  SlidersHorizontal,
  Sparkle,
  Stop,
} from '@phosphor-icons/react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Popover } from 'radix-ui';
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import { TopBar } from '@/components/top-bar';
import { AgentRuntimeUnavailableError, HttpAgentClient } from '@/lib/agent-client';
import { RENDERERS, type RendererId } from '@/lib/data/integrations';
import { findTemplate } from '@/lib/data/templates';
import { useT } from '@/lib/i18n/provider';
import { templateCopy } from '@/lib/i18n/template-copy';
import { buildRunRequest } from '@/lib/run-request';
import { useRunOverrides } from '@/lib/stores/run-overrides-store';
import {
  canvasBackgroundVar,
  NODE_RADIUS,
  type SettingsRenderer,
  useSettingsStore,
} from '@/lib/stores/settings-store';
import styles from './canvas.module.css';
import { SketchHint } from './sketch-hint';
import { type DragInput, dragTranslation, nudgeStep, type Point, type SnapFrame } from './snap';

const ZOOM_MIN = 25;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

/** Picker value meaning "no override, use the saved default model". */
const DEFAULT_MODEL_CHOICE = 'default';

type Direction = 'horizontal' | 'vertical';

/** Where a node has been dragged to, relative to its slot in the flow (diagram px). */
interface Offset {
  dx: number;
  dy: number;
}

const NO_OFFSET: Offset = { dx: 0, dy: 0 };

const ARROW_KEYS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

interface RunState {
  stage: RunStage;
  actions: number;
}

function resolveRenderer(param: string | null, fallback: SettingsRenderer): RendererId {
  const match = RENDERERS.find((r) => r.id === param?.toLowerCase());
  return match ? match.id : fallback;
}

interface CanvasWorkspaceProps {
  diagramId: string;
}

/**
 * Canvas Workspace (PRD 5.2). Until the IR renderer lands the stage is a sketch: the composer
 * sends a RunRequest to the Agent Runtime and each accepted `addNode` becomes an editable node.
 * If the runtime is unreachable the prompt is split locally so the page stays usable.
 */
export function CanvasWorkspace({ diagramId }: CanvasWorkspaceProps) {
  const t = useT();
  const toast = useToast();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);

  const saved = useSettingsStore((s) => s.saved);
  const temporaryModel = useRunOverrides((s) => s.temporaryModel);
  const setTemporaryModel = useRunOverrides((s) => s.setTemporaryModel);
  const consumeTemporaryModel = useRunOverrides((s) => s.consumeTemporaryModel);

  const template = findTemplate(params.get('template'));
  const renderer = RENDERERS.find(
    (r) => r.id === resolveRenderer(params.get('renderer'), saved.renderer),
  );

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
  const [steps, setSteps] = useState<string[]>([]);
  // Dragged positions by step index; cleared whenever the flow is laid out afresh.
  const [offsets, setOffsets] = useState<Offset[]>([]);
  const [direction, setDirection] = useState<Direction>('horizontal');
  const [zoom, setZoom] = useState(100);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (params.get('focus') === 'composer' || params.get('prompt')) inputRef.current?.focus();
  }, [params]);

  // Leaving the page cancels an in-flight run.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Announce the starter template once per workspace visit.
  const announcedRef = useRef<string | null>(null);
  useEffect(() => {
    if (template && announcedRef.current !== template.id) {
      announcedRef.current = template.id;
      toast(t.canvas.templateLoaded(templateCopy(t, template).title), { tone: 'light' });
    }
  }, [template, toast, t]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) {
      toast(t.canvas.emptyPrompt);
      return;
    }
    if (abortRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setRun({ stage: 'understanding', actions: 0 });
    setSteps([]);
    setOffsets([]);

    const client = new HttpAgentClient(saved.agentRuntimeUrl);
    const request = buildRunRequest({
      // Until diagrams are persisted (task 0.7) every run starts from an empty IR document. It is
      // `generic` on purpose: the agent's plan classifies it and the build stage writes the type.
      diagram: createDiagram({
        name: template?.title ?? t.canvas.untitled,
        type: 'generic',
        id: isId(diagramId) ? diagramId : undefined,
      }),
      prompt: text,
      renderer: renderer?.id ?? 'excalidraw',
      settings: saved,
      temporaryModel: consumeTemporaryModel(),
    });
    const labels: string[] = [];
    try {
      const events = client.start(request, { signal: controller.signal });
      for await (const event of events) {
        if (event.type === 'status') {
          setRun((current) => current && { ...current, stage: event.stage });
        } else if (event.type === 'action' && event.ok && event.action.op === 'addNode') {
          labels.push(event.action.node.label);
          setSteps([...labels]);
          setRun((current) => current && { ...current, actions: current.actions + 1 });
        } else if (event.type === 'error' && !event.recoverable) {
          toast(t.canvas.agentStopped(event.message), { tone: 'light' });
        } else if (event.type === 'done') {
          toast(t.canvas.created);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        toast(t.canvas.stopped);
      } else if (error instanceof AgentRuntimeUnavailableError) {
        setSteps(splitSteps(text));
        toast(t.canvas.offline, { tone: 'light' });
      } else {
        toast(error instanceof Error ? error.message : t.canvas.failed, { tone: 'light' });
      }
    } finally {
      abortRef.current = null;
      setRun(null);
    }
  };

  const stopRun = () => abortRef.current?.abort();

  const setZoomClamped = (value: number) => setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)));

  const updateStep = (index: number, text: string) =>
    setSteps((current) => current.map((step, i) => (i === index ? text || step : step)));

  const moveStep = (index: number, offset: Offset) =>
    setOffsets((current) => {
      const next = current.slice();
      next[index] = offset;
      return next;
    });

  const changeDirection = (next: Direction) => {
    setDirection(next);
    setOffsets([]);
  };

  const scale = zoom / 100;

  // Read at gesture time so a drag always sees the current zoom and grid settings.
  const snapFrame = (): SnapFrame => {
    const paper = paperRef.current?.getBoundingClientRect();
    return {
      origin: paper
        ? { x: paper.left + paper.width / 2, y: paper.top + paper.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      gridSize: Number(saved.gridSize),
      scale,
      snap: saved.snap,
    };
  };

  const ArrowIcon = direction === 'vertical' ? ArrowDown : ArrowRight;
  const canvasStyle = {
    '--grid-scale': scale,
    '--diagram-scale': scale,
    '--canvas-bg': canvasBackgroundVar(saved.canvasBackground),
    '--grid-size': `${saved.gridSize}px`,
    '--node-radius': `${NODE_RADIUS[saved.nodeStyle]}px`,
    '--edge-style': saved.edgeStyle,
  } as CSSProperties;

  return (
    <div
      className={cn(styles.workspace, saved.selection === 'fill' && styles.selectionFill)}
      style={canvasStyle}
      data-diagram-id={diagramId}
    >
      <div
        ref={paperRef}
        className={styles.paper}
        data-pattern={saved.canvasPattern}
        aria-hidden="true"
      />
      <TopBar />

      {run && (
        <div className={styles.runPill} role="status" aria-live="polite">
          <span className={styles.runDot} aria-hidden="true" />
          <span className={styles.runLabel}>
            {t.canvas.stages[run.stage]}
            {run.stage === 'building' && run.actions > 0 ? ` · ${run.actions}` : ''}
          </span>
          <button type="button" className={styles.runStop} onClick={stopRun}>
            <Stop size={12} weight="fill" aria-hidden="true" />
            {t.canvas.stop}
          </button>
        </div>
      )}

      {steps.length === 0 && !run ? (
        <SketchHint />
      ) : (
        <section
          className={cn(styles.stage, direction === 'vertical' && styles.vertical)}
          aria-label={t.canvas.diagramLabel}
        >
          {steps.map((step, index) => (
            <StepNode
              key={`${index}-${step}`}
              text={step}
              offset={offsets[index] ?? NO_OFFSET}
              withArrow={index > 0}
              ArrowIcon={ArrowIcon}
              label={t.canvas.stepLabel}
              moveLabel={t.canvas.moveNode}
              frame={snapFrame}
              onCommit={(text) => updateStep(index, text)}
              onMove={(offset) => moveStep(index, offset)}
            />
          ))}
        </section>
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
          <button type="submit" className={styles.submit} aria-label={t.canvas.submit}>
            <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
          </button>
        </form>
      </div>

      <Button variant="surface" className={styles.help} onClick={() => setHelpOpen(true)}>
        <Question size={20} aria-hidden="true" />
        <span>{t.common.help}</span>
      </Button>

      <div className={styles.controls}>
        <div className={styles.zoom} role="group" aria-label={t.canvas.zoom}>
          <button
            type="button"
            aria-label={t.canvas.zoomOut}
            disabled={zoom <= ZOOM_MIN}
            onClick={() => setZoomClamped(zoom - ZOOM_STEP)}
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <output aria-live="polite">{zoom}%</output>
          <button
            type="button"
            aria-label={t.canvas.zoomIn}
            disabled={zoom >= ZOOM_MAX}
            onClick={() => setZoomClamped(zoom + ZOOM_STEP)}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
        <IconButton
          variant="surface"
          className={styles.fit}
          aria-label={t.canvas.fitToScreen}
          onClick={() => setZoom(100)}
        >
          <CornersOut size={18} aria-hidden="true" />
        </IconButton>
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

interface StepNodeProps {
  text: string;
  offset: Offset;
  withArrow: boolean;
  ArrowIcon: typeof ArrowRight;
  label: string;
  moveLabel: string;
  frame: () => SnapFrame;
  onCommit: (text: string) => void;
  onMove: (offset: Offset) => void;
}

interface DragGesture {
  pointer: Point;
  start: DragInput['start'];
}

/**
 * An editable sketch node with a drag handle. Clicking the text edits it; the handle moves the
 * node (pointer or arrow keys), snapping its top-left corner to the grid when the setting is on.
 * Connectors stay in the flow — this is the sketch stage, not the renderer.
 */
function StepNode({
  text,
  offset,
  withArrow,
  ArrowIcon,
  label,
  moveLabel,
  frame,
  onCommit,
  onMove,
}: StepNodeProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const [dragging, setDragging] = useState(false);

  const startOf = (): DragInput['start'] | null => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, dx: offset.dx, dy: offset.dy } : null;
  };

  const beginDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const start = startOf();
    if (!start) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = { pointer: { x: event.clientX, y: event.clientY }, start };
    setDragging(true);
  };

  const drag = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    onMove(
      dragTranslation({
        ...frame(),
        start: gesture.start,
        pointer: { x: event.clientX - gesture.pointer.x, y: event.clientY - gesture.pointer.y },
      }),
    );
  };

  const endDrag = () => {
    gestureRef.current = null;
    setDragging(false);
  };

  // Arrow keys move one cell when snapping (landing on the grid), else one pixel.
  const nudge = (event: KeyboardEvent<HTMLButtonElement>) => {
    const vector = ARROW_KEYS[event.key];
    const start = startOf();
    if (!vector || !start) return;
    event.preventDefault();
    const current = frame();
    const step = nudgeStep(current.snap, current.gridSize) * current.scale;
    onMove(
      dragTranslation({
        ...current,
        start,
        pointer: { x: vector.x * step, y: vector.y * step },
      }),
    );
  };

  return (
    <>
      {withArrow && (
        <span className={styles.arrow} aria-hidden="true">
          <ArrowIcon size={22} />
        </span>
      )}
      <div
        ref={wrapRef}
        className={cn(styles.nodeWrap, dragging && styles.dragging)}
        style={{ translate: `${offset.dx}px ${offset.dy}px` }}
      >
        <button
          type="button"
          className={styles.grip}
          aria-label={moveLabel}
          title={moveLabel}
          onPointerDown={beginDrag}
          onPointerMove={drag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={nudge}
        >
          <DotsSixVertical size={14} weight="bold" aria-hidden="true" />
        </button>
        <div
          className={styles.node}
          role="textbox"
          tabIndex={0}
          contentEditable
          suppressContentEditableWarning
          aria-label={label}
          onBlur={(event) => onCommit(event.currentTarget.textContent?.trim() ?? '')}
        >
          {text}
        </div>
      </div>
    </>
  );
}
