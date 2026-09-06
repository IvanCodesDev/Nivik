'use client';

import { splitSteps } from '@nivik/agent';
import type { RunStage } from '@nivik/protocol';
import { Button, cn, IconButton, useToast } from '@nivik/ui';
import {
  ArrowDown,
  ArrowRight,
  CornersOut,
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
import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import { TopBar } from '@/components/top-bar';
import { AgentRuntimeUnavailableError, HttpAgentClient } from '@/lib/agent-client';
import { RENDERERS, type RendererId } from '@/lib/data/integrations';
import { findTemplate } from '@/lib/data/templates';
import { useSettingsStore } from '@/lib/stores/settings-store';
import styles from './canvas.module.css';

const ZOOM_MIN = 25;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

type Direction = 'horizontal' | 'vertical';

const STAGE_LABELS: Record<RunStage, string> = {
  understanding: 'Understanding',
  planning: 'Planning',
  building: 'Building',
  connecting: 'Connecting',
  validating: 'Validating',
  done: 'Done',
};

interface RunState {
  stage: RunStage;
  actions: number;
}

function resolveRenderer(param: string | null, fallback: 'Excalidraw' | 'draw.io'): RendererId {
  const match = RENDERERS.find((r) => r.id === param?.toLowerCase());
  if (match) return match.id;
  return fallback === 'draw.io' ? 'drawio' : 'excalidraw';
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
  const toast = useToast();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const saved = useSettingsStore((s) => s.saved);
  const template = findTemplate(params.get('template'));
  const renderer = RENDERERS.find(
    (r) => r.id === resolveRenderer(params.get('renderer'), saved.renderer),
  );

  const [prompt, setPrompt] = useState(() => params.get('prompt') ?? '');
  const [steps, setSteps] = useState<string[]>([]);
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
      toast(`Template loaded: ${template.title}. Press Enter to lay it out.`, { tone: 'light' });
    }
  }, [template, toast]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) {
      toast('Describe a diagram to get started.');
      return;
    }
    if (abortRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setRun({ stage: 'understanding', actions: 0 });
    setSteps([]);

    const client = new HttpAgentClient(saved.agentRuntimeUrl);
    const labels: string[] = [];
    try {
      const events = client.start(
        {
          diagram: {},
          prompt: text,
          hints: { renderer: renderer?.id ?? 'excalidraw' },
          settings: {
            temperature: saved.temperature,
            maxTokens: Math.max(256, saved.maxTokens),
            timeoutMs: saved.timeout * 1_000,
            retries: Number(saved.retryCount),
            thinking: saved.thinking,
          },
        },
        { signal: controller.signal },
      );
      for await (const event of events) {
        if (event.type === 'status') {
          setRun((current) => current && { ...current, stage: event.stage });
        } else if (event.type === 'action' && event.ok && event.action.type === 'addNode') {
          if (typeof event.action.label === 'string') labels.push(event.action.label);
          setSteps([...labels]);
          setRun((current) => current && { ...current, actions: current.actions + 1 });
        } else if (event.type === 'error' && !event.recoverable) {
          toast(`Agent stopped: ${event.message}`, { tone: 'light' });
        } else if (event.type === 'done') {
          toast('Diagram created. Click any step to edit it.');
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        toast('Generation stopped.');
      } else if (error instanceof AgentRuntimeUnavailableError) {
        setSteps(splitSteps(text));
        toast('Agent Runtime is offline — sketched locally instead.', { tone: 'light' });
      } else {
        toast(error instanceof Error ? error.message : 'Generation failed.', { tone: 'light' });
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

  const ArrowIcon = direction === 'vertical' ? ArrowDown : ArrowRight;
  const scale = zoom / 100;

  return (
    <div
      className={styles.workspace}
      style={{ '--grid-scale': scale, '--diagram-scale': scale } as CSSProperties}
      data-diagram-id={diagramId}
    >
      <div className={styles.paper} aria-hidden="true" />
      <TopBar />

      {run && (
        <div className={styles.runPill} role="status" aria-live="polite">
          <span className={styles.runDot} aria-hidden="true" />
          <span className={styles.runLabel}>
            {STAGE_LABELS[run.stage]}
            {run.stage === 'building' && run.actions > 0 ? ` · ${run.actions}` : ''}
          </span>
          <button type="button" className={styles.runStop} onClick={stopRun}>
            <Stop size={12} weight="fill" aria-hidden="true" />
            Stop
          </button>
        </div>
      )}

      {steps.length === 0 && !run ? (
        <p className={styles.hint}>
          <strong>What do you want to diagram?</strong>
          Describe it below — separate steps with → to sketch a quick flow.
        </p>
      ) : (
        <section
          className={cn(styles.stage, direction === 'vertical' && styles.vertical)}
          aria-label="Diagram"
        >
          {steps.map((step, index) => (
            <StepNode
              key={`${index}-${step}`}
              text={step}
              withArrow={index > 0}
              ArrowIcon={ArrowIcon}
              onCommit={(text) => updateStep(index, text)}
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
            placeholder="What do you want to diagram?"
            aria-label="Describe your diagram"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <Popover.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
            <Popover.Trigger asChild>
              <IconButton className={styles.settingsButton} aria-label="Diagram settings">
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
                <h3>Diagram settings</h3>
                <div className={styles.settingsRow}>
                  <span>Direction</span>
                  <div className={styles.segment} role="group" aria-label="Direction">
                    <button
                      type="button"
                      aria-pressed={direction === 'horizontal'}
                      onClick={() => setDirection('horizontal')}
                    >
                      Horizontal
                    </button>
                    <button
                      type="button"
                      aria-pressed={direction === 'vertical'}
                      onClick={() => setDirection('vertical')}
                    >
                      Vertical
                    </button>
                  </div>
                </div>
                <div className={styles.settingsRow}>
                  <span>Renderer</span>
                  <span>{renderer?.name ?? saved.renderer}</span>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <button type="submit" className={styles.submit} aria-label="Create diagram">
            <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
          </button>
        </form>
      </div>

      <Button variant="surface" className={styles.help} onClick={() => setHelpOpen(true)}>
        <Question size={20} aria-hidden="true" />
        <span>Help</span>
      </Button>

      <div className={styles.controls}>
        <div className={styles.zoom} role="group" aria-label="Zoom">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= ZOOM_MIN}
            onClick={() => setZoomClamped(zoom - ZOOM_STEP)}
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <output aria-live="polite">{zoom}%</output>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= ZOOM_MAX}
            onClick={() => setZoomClamped(zoom + ZOOM_STEP)}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
        <IconButton
          variant="surface"
          className={styles.fit}
          aria-label="Fit to screen"
          onClick={() => setZoom(100)}
        >
          <CornersOut size={18} aria-hidden="true" />
        </IconButton>
      </div>

      <ChoiceDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="How can we help?"
        description="Type a few steps separated by → or -> to create a simple diagram. You can also choose a template, adjust the direction, and use the controls to zoom. AI generation and the real renderers arrive with the next milestones."
      />
    </div>
  );
}

interface StepNodeProps {
  text: string;
  withArrow: boolean;
  ArrowIcon: typeof ArrowRight;
  onCommit: (text: string) => void;
}

function StepNode({ text, withArrow, ArrowIcon, onCommit }: StepNodeProps) {
  return (
    <>
      {withArrow && (
        <span className={styles.arrow} aria-hidden="true">
          <ArrowIcon size={22} />
        </span>
      )}
      <div
        className={styles.node}
        role="textbox"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        aria-label="Diagram step"
        onBlur={(event) => onCommit(event.currentTarget.textContent?.trim() ?? '')}
      >
        {text}
      </div>
    </>
  );
}
