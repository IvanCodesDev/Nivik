'use client';

/**
 * SPIKE — mind map editor demo (/mindmap-demo).
 *
 * A dedicated tree editor rather than a drawing canvas: layout is always automatic, the only
 * inputs are structure edits (Tab / Enter / drag to re-parent / collapse), and the "AI" is a
 * scripted mock that streams topics in and leaves them highlighted for review. Nothing is saved.
 * Strings are hard-coded (zh-CN) on purpose; this page is not part of the product surface.
 */

import {
  Button,
  cn,
  IconButton,
  Kbd,
  type PaletteName,
  Pill,
  paletteVar,
  useToast,
} from '@nivik/ui';
import {
  ArrowUUpLeft,
  ArrowUUpRight,
  Check,
  CheckCircle,
  CornersOut,
  Flag,
  LinkSimple,
  Minus,
  Note,
  PaperPlaneRight,
  Plus,
  Question,
  Sparkle,
  Star,
  Stop,
  Tag,
  Trash,
  X,
} from '@phosphor-icons/react';
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { TopBar } from '@/components/top-bar';
import {
  BOUNDARY_PAD,
  type Box,
  hitTest,
  ICON_GAP,
  ICON_SIZE,
  isUnderlined,
  type Layout,
  layoutMindMap,
  measureTopic,
  metricsFor,
  type PlacedTopic,
  rangeBox,
} from './layout';
import styles from './mind-map-demo.module.css';
import {
  findParent,
  findTopic,
  insertChild,
  isDescendant,
  MARKERS,
  type Marker,
  type MindMap,
  mockExpand,
  mockGenerate,
  moveTopic,
  normalize,
  removeTopic,
  STRUCTURES,
  type Structure,
  sampleMindMap,
  type Topic,
  topic,
  updateTopic,
} from './model';

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;
const DRAG_THRESHOLD = 6;
const NEW_TOPIC_TITLE = '新主题';

const STRUCTURE_LABEL: Record<Structure, string> = {
  map: '左右平衡',
  logic: '逻辑图',
  org: '组织结构',
};

const BRANCH_PALETTES: readonly PaletteName[] = [
  'lavender',
  'sky',
  'mint',
  'coral',
  'sand',
  'rose',
  'sage',
  'neutral',
];

function paletteOf(branch: number): PaletteName {
  if (branch < 0) return 'lavender';
  return BRANCH_PALETTES[branch % BRANCH_PALETTES.length] ?? 'lavender';
}

function branchStyle(pal: PaletteName): CSSProperties {
  return {
    '--branch-fill': paletteVar(pal, 'fill'),
    '--branch-stroke': paletteVar(pal, 'stroke'),
    '--branch-text': paletteVar(pal, 'text'),
  } as CSSProperties;
}

interface View {
  x: number;
  y: number;
  scale: number;
}

interface History {
  past: MindMap[];
  future: MindMap[];
}

interface DragState {
  id: string;
  title: string;
  x: number;
  y: number;
  over: string | null;
}

interface Gesture {
  id: string;
  startX: number;
  startY: number;
  active: boolean;
}

interface PanGesture {
  startX: number;
  startY: number;
  viewX: number;
  viewY: number;
  moved: boolean;
}

interface AiRun {
  stage: 'planning' | 'building';
  count: number;
}

interface AiReview {
  before: MindMap;
  count: number;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function MindMapDemo() {
  const toast = useToast();
  const viewportRef = useRef<HTMLDivElement>(null);

  const [doc, setDoc] = useState<MindMap>(sampleMindMap);
  const docRef = useRef(doc);
  docRef.current = doc;
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const [selectedId, setSelectedId] = useState<string | null>('root');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [view, setView] = useState<View>({ x: 0, y: -30, scale: 1 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const panRef = useRef<PanGesture | null>(null);
  const [prompt, setPrompt] = useState('');
  const [run, setRun] = useState<AiRun | null>(null);
  const [review, setReview] = useState<AiReview | null>(null);
  const [aiTouched, setAiTouched] = useState<ReadonlySet<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const pendingFitRef = useRef(true);

  const layout = useMemo(() => layoutMindMap(doc), [doc]);
  const selected = selectedId ? layout.placed.get(selectedId) : undefined;
  const selectedTopic = selectedId ? findTopic(doc.root, selectedId) : undefined;

  /* ------------------------------------------------------------------------------------ */
  /* Document edits (every user edit is one undo step)                                    */
  /* ------------------------------------------------------------------------------------ */

  const commit = (next: MindMap) => {
    const current = docRef.current;
    setHistory((h) => ({ past: [...h.past.slice(-99), current], future: [] }));
    setDoc(normalize(next));
  };

  const commitRoot = (root: Topic) => commit({ ...docRef.current, root });

  const undo = () => {
    const prev = history.past.at(-1);
    if (!prev) return;
    setHistory({ past: history.past.slice(0, -1), future: [doc, ...history.future] });
    setDoc(prev);
    setEditingId(null);
  };

  const redo = () => {
    const [next, ...rest] = history.future;
    if (!next) return;
    setHistory({ past: [...history.past, doc], future: rest });
    setDoc(next);
    setEditingId(null);
  };

  const select = (id: string | null) => {
    setSelectedId(id);
    if (editingId && editingId !== id) setEditingId(null);
  };

  const startEditing = (id: string) => {
    setSelectedId(id);
    setEditingId(id);
  };

  const addChild = (parentId: string) => {
    const child = topic(NEW_TOPIC_TITLE);
    commitRoot(insertChild(docRef.current.root, parentId, child));
    startEditing(child.id);
  };

  const addSibling = (id: string) => {
    const hit = findParent(docRef.current.root, id);
    if (!hit) {
      addChild(id);
      return;
    }
    const sibling = topic(NEW_TOPIC_TITLE);
    commitRoot(insertChild(docRef.current.root, hit.parent.id, sibling, hit.index + 1));
    startEditing(sibling.id);
  };

  const remove = (id: string) => {
    if (id === docRef.current.root.id) return;
    const hit = findParent(docRef.current.root, id);
    commitRoot(removeTopic(docRef.current.root, id));
    select(hit?.parent.id ?? docRef.current.root.id);
  };

  const toggleCollapse = (id: string) => {
    const t = findTopic(docRef.current.root, id);
    if (!t || t.children.length === 0) return;
    commitRoot(updateTopic(docRef.current.root, id, (x) => ({ ...x, collapsed: !x.collapsed })));
  };

  const commitTitle = (id: string, title: string) => {
    const clean = title.trim();
    const current = findTopic(docRef.current.root, id);
    if (current && clean && clean !== current.title) {
      commitRoot(updateTopic(docRef.current.root, id, (x) => ({ ...x, title: clean })));
    }
    setEditingId(null);
    viewportRef.current?.focus({ preventScroll: true });
  };

  const setNote = (id: string, note: string) => {
    const clean = note.trim();
    commitRoot(
      updateTopic(docRef.current.root, id, (x) => ({ ...x, note: clean ? clean : undefined })),
    );
  };

  const cycleMarker = (id: string) => {
    commitRoot(
      updateTopic(docRef.current.root, id, (x) => {
        const current = x.markers?.[0];
        const index = current ? MARKERS.indexOf(current) : -1;
        const next: Marker | undefined = MARKERS[index + 1];
        return { ...x, markers: next ? [next] : undefined };
      }),
    );
  };

  const setStructure = (structure: Structure) => {
    if (structure === doc.structure) return;
    pendingFitRef.current = true;
    commit({ ...doc, structure });
  };

  /* ------------------------------------------------------------------------------------ */
  /* Viewport: pan / zoom / fit                                                           */
  /* ------------------------------------------------------------------------------------ */

  const toCanvas = (clientX: number, clientY: number, v: View = view) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - rect.width / 2 - v.x) / v.scale,
      y: (clientY - rect.top - rect.height / 2 - v.y) / v.scale,
    };
  };

  const fitToScreen = useCallback((bounds: Box) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 90;
    const usableW = Math.max(200, rect.width - margin * 2);
    const usableH = Math.max(200, rect.height - margin * 2 - 140);
    const scale = clamp(
      Math.min(usableW / (bounds.w + 80), usableH / (bounds.h + 80)),
      ZOOM_MIN,
      1.15,
    );
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    setView({ scale, x: -cx * scale, y: -cy * scale - 30 });
  }, []);

  useEffect(() => {
    if (!pendingFitRef.current) return;
    pendingFitRef.current = false;
    fitToScreen(layout.bounds);
  }, [layout.bounds, fitToScreen]);

  const zoomBy = useCallback((factor: number, clientX?: number, clientY?: number) => {
    setView((v) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      const scale = clamp(v.scale * factor, ZOOM_MIN, ZOOM_MAX);
      if (!rect || clientX === undefined || clientY === undefined) {
        const ratio = scale / v.scale;
        return { scale, x: v.x * ratio, y: v.y * ratio };
      }
      const px = clientX - rect.left - rect.width / 2;
      const py = clientY - rect.top - rect.height / 2;
      const cx = (px - v.x) / v.scale;
      const cy = (py - v.y) / v.scale;
      return { scale, x: px - cx * scale, y: py - cy * scale };
    });
  }, []);

  // Wheel needs a non-passive listener so the page never scrolls behind the map.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        zoomBy(Math.exp(-event.deltaY * 0.0022), event.clientX, event.clientY);
      } else {
        setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const onViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target !== event.currentTarget) return;
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      viewX: view.x,
      viewY: view.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
  };

  const onViewportPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (!pan.moved && Math.hypot(dx, dy) < 3) return;
    pan.moved = true;
    setView((v) => ({ ...v, x: pan.viewX + dx, y: pan.viewY + dy }));
  };

  const onViewportPointerUp = () => {
    const pan = panRef.current;
    panRef.current = null;
    if (pan && !pan.moved) {
      select(null);
      setEditingId(null);
    }
  };

  /* ------------------------------------------------------------------------------------ */
  /* Topic gestures: select, edit, drag to re-parent                                       */
  /* ------------------------------------------------------------------------------------ */

  const onTopicPointerDown = (event: ReactPointerEvent<HTMLDivElement>, p: PlacedTopic) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (editingId === p.id) return;
    select(p.id);
    viewportRef.current?.focus({ preventScroll: true });
    if (p.depth === 0 || run) return;
    gestureRef.current = { id: p.id, startX: event.clientX, startY: event.clientY, active: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onTopicPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    gesture.active = true;
    const point = toCanvas(event.clientX, event.clientY);
    const hit = hitTest(layout, point.x, point.y);
    const moving = findTopic(doc.root, gesture.id);
    const over =
      hit && moving && hit.id !== gesture.id && !isDescendant(moving, hit.id) ? hit.id : null;
    const next: DragState = {
      id: gesture.id,
      title: moving?.title ?? '',
      x: event.clientX,
      y: event.clientY,
      over,
    };
    dragRef.current = next;
    setDrag(next);
  };

  const onTopicPointerUp = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!gesture?.active || !current) return;
    if (current.over) {
      commitRoot(moveTopic(docRef.current.root, gesture.id, current.over));
      toast('已移动到新的父主题', { tone: 'light' });
    }
  };

  /* ------------------------------------------------------------------------------------ */
  /* Keyboard                                                                              */
  /* ------------------------------------------------------------------------------------ */

  const navigate = (key: string) => {
    if (!selected) {
      select(doc.root.id);
      return;
    }
    const t = findTopic(doc.root, selected.id);
    const parentHit = findParent(doc.root, selected.id);
    const horizontal = selected.dir !== 'down';

    if (selected.depth === 0) {
      const side = horizontal
        ? key === 'ArrowRight'
          ? 'right'
          : key === 'ArrowLeft'
            ? 'left'
            : null
        : key === 'ArrowDown'
          ? 'down'
          : null;
      const first = side && layout.order.find((p) => p.depth === 1 && p.dir === side);
      if (first) select(first.id);
      return;
    }

    const towardChildren = horizontal
      ? selected.dir === 'right'
        ? 'ArrowRight'
        : 'ArrowLeft'
      : 'ArrowDown';
    const towardParent = horizontal
      ? selected.dir === 'right'
        ? 'ArrowLeft'
        : 'ArrowRight'
      : 'ArrowUp';
    const prevKey = horizontal ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = horizontal ? 'ArrowDown' : 'ArrowRight';

    if (key === towardChildren) {
      const first = t && !t.collapsed ? t.children[0] : undefined;
      if (first) select(first.id);
    } else if (key === towardParent) {
      if (parentHit) select(parentHit.parent.id);
    } else if ((key === prevKey || key === nextKey) && parentHit) {
      const sibling = parentHit.parent.children[parentHit.index + (key === prevKey ? -1 : 1)];
      if (sibling) select(sibling.id);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editingId) return;
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      navigate(event.key);
      return;
    }
    if (!selectedId) return;
    switch (event.key) {
      case 'Tab':
        event.preventDefault();
        if (!run) addChild(selectedId);
        break;
      case 'Enter':
        event.preventDefault();
        if (!run) addSibling(selectedId);
        break;
      case 'F2':
        event.preventDefault();
        startEditing(selectedId);
        break;
      case ' ':
        event.preventDefault();
        toggleCollapse(selectedId);
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        if (!run) remove(selectedId);
        break;
      case 'Escape':
        select(null);
        setNotesOpen(false);
        break;
      default:
        break;
    }
  };

  /* ------------------------------------------------------------------------------------ */
  /* Mock agent                                                                            */
  /* ------------------------------------------------------------------------------------ */

  const beginAiRun = () => {
    const before = docRef.current;
    setHistory((h) => ({ past: [...h.past.slice(-99), before], future: [] }));
    setReview(null);
    setAiTouched(new Set());
    setEditingId(null);
    const controller = new AbortController();
    abortRef.current = controller;
    return { before, controller };
  };

  const finishAiRun = (before: MindMap, touched: Set<string>) => {
    abortRef.current = null;
    setRun(null);
    setReview({ before, count: touched.size });
  };

  const runGenerate = async (text: string) => {
    if (abortRef.current) return;
    const { before, controller } = beginAiRun();
    const { root, steps } = mockGenerate(text);
    const touched = new Set<string>([root.id]);

    setRun({ stage: 'planning', count: 0 });
    await sleep(750, controller.signal);
    if (controller.signal.aborted) {
      finishAiRun(before, new Set());
      return;
    }

    setDoc({
      title: text,
      structure: docRef.current.structure,
      root,
      relationships: [],
      boundaries: [],
      summaries: [],
    });
    setAiTouched(new Set(touched));
    setSelectedId(root.id);
    pendingFitRef.current = true;
    setRun({ stage: 'building', count: 0 });

    let count = 0;
    for (const step of steps) {
      await sleep(count < 5 ? 160 : 110, controller.signal);
      if (controller.signal.aborted) break;
      count += 1;
      touched.add(step.topic.id);
      setDoc((d) => ({ ...d, root: insertChild(d.root, step.parentId, step.topic) }));
      setAiTouched(new Set(touched));
      setRun({ stage: 'building', count });
      if (count % 4 === 0) pendingFitRef.current = true;
    }
    pendingFitRef.current = true;
    finishAiRun(before, touched);
  };

  const runExpand = async (id: string) => {
    if (abortRef.current) return;
    const { before, controller } = beginAiRun();
    const touched = new Set<string>();
    setRun({ stage: 'planning', count: 0 });
    await sleep(600, controller.signal);
    let count = 0;
    for (const step of mockExpand(id)) {
      if (controller.signal.aborted) break;
      await sleep(140, controller.signal);
      if (controller.signal.aborted) break;
      count += 1;
      touched.add(step.topic.id);
      setDoc((d) => ({ ...d, root: insertChild(d.root, step.parentId, step.topic) }));
      setAiTouched(new Set(touched));
      setRun({ stage: 'building', count });
    }
    finishAiRun(before, touched);
  };

  const stopRun = () => abortRef.current?.abort();

  const acceptAi = () => {
    setReview(null);
    setAiTouched(new Set());
    toast('已接受 AI 修改');
  };

  const undoAi = () => {
    if (!review) return;
    setDoc(review.before);
    setHistory((h) => ({ past: h.past.slice(0, -1), future: [] }));
    setReview(null);
    setAiTouched(new Set());
    setSelectedId(review.before.root.id);
    pendingFitRef.current = true;
    toast('已撤销 AI 修改', { tone: 'light' });
  };

  const submitPrompt = (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) {
      toast('先输入一个主题');
      return;
    }
    setPrompt('');
    void runGenerate(text);
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ------------------------------------------------------------------------------------ */
  /* Render                                                                                */
  /* ------------------------------------------------------------------------------------ */

  const canvasStyle = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
  } as CSSProperties;

  const showToolbar = selected && !editingId && !drag && !run;

  return (
    <div className={styles.workspace}>
      <div className={styles.paper} aria-hidden="true" />
      <TopBar />

      <section className={styles.panel} aria-label="思维导图工具">
        <div className={styles.panelHead}>
          <h1 className={styles.panelTitle}>{doc.title}</h1>
          <Pill>Demo · 模拟 AI</Pill>
        </div>
        <div className={styles.panelRow}>
          <div className={styles.segment} role="group" aria-label="结构">
            {STRUCTURES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={doc.structure === s}
                onClick={() => setStructure(s)}
              >
                {STRUCTURE_LABEL[s]}
              </button>
            ))}
          </div>
          <div className={styles.panelActions}>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="撤销"
              title="撤销 (Ctrl+Z)"
              disabled={history.past.length === 0}
              onClick={undo}
            >
              <ArrowUUpLeft size={17} aria-hidden="true" />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="重做"
              title="重做 (Ctrl+Shift+Z)"
              disabled={history.future.length === 0}
              onClick={redo}
            >
              <ArrowUUpRight size={17} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <ul className={styles.hints}>
          <li>
            <Kbd>Tab</Kbd> 子主题
          </li>
          <li>
            <Kbd>Enter</Kbd> 同级主题
          </li>
          <li>
            <Kbd>Space</Kbd> 折叠
          </li>
          <li>
            <Kbd>双击</Kbd> 编辑
          </li>
          <li>
            <Kbd>拖到主题上</Kbd> 改父
          </li>
          <li>
            <Kbd>Ctrl + 滚轮</Kbd> 缩放
          </li>
        </ul>
      </section>

      {run && (
        <div className={styles.runPill} role="status" aria-live="polite">
          <span className={styles.runDot} aria-hidden="true" />
          <span className={styles.runLabel}>
            {run.stage === 'planning' ? '规划中…' : `构建中 · ${run.count}`}
          </span>
          <button type="button" className={styles.runStop} onClick={stopRun}>
            <Stop size={12} weight="fill" aria-hidden="true" />
            停止
          </button>
        </div>
      )}

      {review && !run && (
        <div className={styles.reviewBar} role="status">
          <Sparkle size={16} weight="fill" aria-hidden="true" />
          <span>
            AI 新增了 <strong>{review.count}</strong> 个主题
          </span>
          <Button variant="primary" size="xs" onClick={acceptAi}>
            <Check size={13} weight="bold" aria-hidden="true" />
            接受
          </Button>
          <Button variant="secondary" size="xs" onClick={undoAi}>
            撤销 AI 修改
          </Button>
        </div>
      )}

      <div
        ref={viewportRef}
        className={cn(styles.viewport, panRef.current && styles.panning)}
        role="tree"
        aria-label="思维导图"
        tabIndex={0}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
        onKeyDown={onKeyDown}
      >
        <div className={styles.canvas} style={canvasStyle}>
          <svg className={styles.lines} aria-hidden="true">
            <defs>
              <marker
                id="mm-rel-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M1 1 L9 5 L1 9" className={styles.relArrow} />
              </marker>
            </defs>
            {doc.boundaries.map((b) => (
              <BoundaryShape key={b.id} boundary={b} doc={doc} layout={layout} />
            ))}
            {layout.connectors.map((c) => (
              <path
                key={c.id}
                className={cn(styles.connector, styles[`connectorDepth${Math.min(c.depth, 3)}`])}
                d={c.d}
                style={
                  {
                    ...branchStyle(paletteOf(c.branch)),
                    d: `path("${c.d}")`,
                  } as CSSProperties
                }
              />
            ))}
            {doc.summaries.map((s) => (
              <SummaryBracket key={s.id} summary={s} doc={doc} layout={layout} />
            ))}
            {doc.relationships.map((r) => (
              <RelationshipLine key={r.id} rel={r} layout={layout} />
            ))}
          </svg>

          {doc.summaries.map((s) => (
            <SummaryLabel key={s.id} summary={s} doc={doc} layout={layout} />
          ))}

          {layout.order.map((p) => {
            const t = findTopic(doc.root, p.id);
            if (!t) return null;
            return (
              <TopicView
                key={p.id}
                topic={t}
                placed={p}
                selected={selectedId === p.id}
                editing={editingId === p.id}
                aiNew={aiTouched.has(p.id)}
                dropTarget={drag?.over === p.id}
                dragging={drag?.id === p.id}
                onPointerDown={(e) => onTopicPointerDown(e, p)}
                onPointerMove={onTopicPointerMove}
                onPointerUp={onTopicPointerUp}
                onDoubleClick={() => startEditing(p.id)}
                onToggle={() => toggleCollapse(p.id)}
                onCommitTitle={(title) => commitTitle(p.id, title)}
                onCancelEdit={() => {
                  setEditingId(null);
                  viewportRef.current?.focus({ preventScroll: true });
                }}
                onOpenNote={() => {
                  select(p.id);
                  setNotesOpen(true);
                }}
              />
            );
          })}

          {showToolbar && selected && selectedTopic && (
            <div
              className={styles.topicToolbar}
              style={
                {
                  left: selected.box.x + selected.box.w / 2,
                  top: selected.box.y - 10,
                  '--inverse-scale': 1 / view.scale,
                } as CSSProperties
              }
              role="toolbar"
              aria-label="主题操作"
            >
              <button
                type="button"
                title="添加子主题 (Tab)"
                aria-label="添加子主题"
                onClick={() => addChild(selected.id)}
              >
                <Plus size={15} weight="bold" aria-hidden="true" />
              </button>
              <button
                type="button"
                title="备注"
                aria-label="备注"
                aria-pressed={notesOpen}
                onClick={() => setNotesOpen((o) => !o)}
              >
                <Note size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                title="切换标记"
                aria-label="切换标记"
                onClick={() => cycleMarker(selected.id)}
              >
                <Tag size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.toolbarAi}
                title="AI 扩展此分支（模拟）"
                aria-label="AI 扩展此分支"
                onClick={() => void runExpand(selected.id)}
              >
                <Sparkle size={15} weight="fill" aria-hidden="true" />
                <span>扩展</span>
              </button>
              {selected.depth > 0 && (
                <button
                  type="button"
                  className={styles.toolbarDanger}
                  title="删除 (Delete)"
                  aria-label="删除主题"
                  onClick={() => remove(selected.id)}
                >
                  <Trash size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {drag && (
        <div className={styles.ghost} style={{ left: drag.x + 14, top: drag.y + 14 }}>
          {drag.title || '未命名'}
          <small>{drag.over ? '放下：成为它的子主题' : '拖到另一个主题上'}</small>
        </div>
      )}

      {notesOpen && selectedTopic && (
        <NotesPanel
          key={selectedTopic.id}
          topic={selectedTopic}
          onClose={() => setNotesOpen(false)}
          onCommit={(note) => setNote(selectedTopic.id, note)}
        />
      )}

      <div className={styles.composerWrap}>
        <form className={styles.composer} onSubmit={submitPrompt}>
          <span className={styles.mark} aria-hidden="true">
            <Sparkle size={22} weight="fill" />
          </span>
          <input
            className={styles.input}
            placeholder="输入一个主题，AI 生成整张思维导图（演示为脚本数据）"
            aria-label="生成思维导图"
            value={prompt}
            disabled={Boolean(run)}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <button type="submit" className={styles.submit} aria-label="生成" disabled={Boolean(run)}>
            <PaperPlaneRight size={18} weight="fill" aria-hidden="true" />
          </button>
        </form>
      </div>

      <div className={styles.controls}>
        <div className={styles.zoom} role="group" aria-label="缩放">
          <button
            type="button"
            aria-label="缩小"
            disabled={view.scale <= ZOOM_MIN}
            onClick={() => zoomBy(1 / 1.2)}
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <output aria-live="polite">{Math.round(view.scale * 100)}%</output>
          <button
            type="button"
            aria-label="放大"
            disabled={view.scale >= ZOOM_MAX}
            onClick={() => zoomBy(1.2)}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
        <IconButton
          variant="surface"
          className={styles.fit}
          aria-label="适应屏幕"
          onClick={() => fitToScreen(layout.bounds)}
        >
          <CornersOut size={18} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- */
/* Topic                                                                                    */
/* ---------------------------------------------------------------------------------------- */

interface TopicViewProps {
  topic: Topic;
  placed: PlacedTopic;
  selected: boolean;
  editing: boolean;
  aiNew: boolean;
  dropTarget: boolean;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onDoubleClick: () => void;
  onToggle: () => void;
  onCommitTitle: (title: string) => void;
  onCancelEdit: () => void;
  onOpenNote: () => void;
}

function TopicView({
  topic: t,
  placed,
  selected,
  editing,
  aiNew,
  dropTarget,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDoubleClick,
  onToggle,
  onCommitTitle,
  onCancelEdit,
  onOpenNote,
}: TopicViewProps) {
  const { box, depth, dir } = placed;
  const metrics = metricsFor(depth);
  const underlined = isUnderlined(depth, dir);
  const pal = paletteOf(placed.branch);

  const slotStyle = {
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    ...branchStyle(pal),
  } as CSSProperties;

  const bodyStyle = {
    fontSize: metrics.fontSize,
    lineHeight: `${metrics.lineHeight}px`,
    padding: `${metrics.padY}px ${metrics.padX}px`,
  } as CSSProperties;

  return (
    <div
      className={cn(
        styles.slot,
        t.collapsed && styles.collapsed,
        underlined && styles.underlined,
        dragging && styles.dragSource,
      )}
      style={slotStyle}
      data-dir={dir}
    >
      <div
        className={cn(
          styles.topic,
          styles[`depth${Math.min(depth, 2)}`],
          selected && styles.selected,
          aiNew && styles.aiNew,
          dropTarget && styles.dropTarget,
        )}
        style={bodyStyle}
        role="treeitem"
        aria-selected={selected}
        aria-level={depth + 1}
        aria-expanded={t.children.length ? !t.collapsed : undefined}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {(t.markers?.length || t.note || t.link) && (
          <span className={styles.icons} style={{ gap: ICON_GAP }}>
            {t.markers?.map((m) => (
              <MarkerIcon key={m} marker={m} />
            ))}
            {t.note && (
              <button
                type="button"
                className={styles.iconButton}
                aria-label="查看备注"
                title={t.note}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={onOpenNote}
              >
                <Note size={ICON_SIZE - 3} weight="duotone" aria-hidden="true" />
              </button>
            )}
            {t.link && (
              <a
                className={styles.iconButton}
                href={t.link}
                target="_blank"
                rel="noreferrer"
                aria-label={`打开链接 ${t.link}`}
                title={t.link}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <LinkSimple size={ICON_SIZE - 3} weight="bold" aria-hidden="true" />
              </a>
            )}
          </span>
        )}
        {editing ? (
          <TitleEditor initial={t.title} onCommit={onCommitTitle} onCancel={onCancelEdit} />
        ) : (
          <span className={cn(styles.title, !t.title && styles.untitled)}>
            {t.title || '未命名'}
          </span>
        )}
      </div>

      {t.children.length > 0 && (
        <button
          type="button"
          className={styles.toggle}
          aria-label={t.collapsed ? `展开 ${placed.hiddenCount} 个主题` : '折叠分支'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onToggle}
        >
          {t.collapsed ? placed.hiddenCount : <Minus size={10} weight="bold" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

function MarkerIcon({ marker }: { marker: Marker }) {
  const size = ICON_SIZE - 3;
  switch (marker) {
    case 'p1':
    case 'p2':
    case 'p3':
      return (
        <span className={cn(styles.priority, styles[marker])} title={`优先级 ${marker[1]}`}>
          {marker[1]}
        </span>
      );
    case 'flag':
      return <Flag size={size} weight="fill" className={styles.flag} aria-label="旗标" />;
    case 'star':
      return <Star size={size} weight="fill" className={styles.star} aria-label="星标" />;
    case 'done':
      return <CheckCircle size={size} weight="fill" className={styles.done} aria-label="完成" />;
    case 'question':
      return <Question size={size} weight="fill" className={styles.question} aria-label="疑问" />;
    default:
      return null;
  }
}

interface TitleEditorProps {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}

function TitleEditor({ initial, onCommit, onCancel }: TitleEditorProps) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  // Committing moves focus away, which fires blur; make sure the edit ends exactly once.
  const doneRef = useRef(false);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);

  const finish = (action: () => void) => {
    if (doneRef.current) return;
    doneRef.current = true;
    action();
  };

  return (
    <input
      ref={ref}
      className={styles.editInput}
      value={value}
      aria-label="主题标题"
      onChange={(event) => setValue(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={() => finish(() => onCommit(value))}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          finish(() => onCommit(value));
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(onCancel);
        }
      }}
    />
  );
}

/* ---------------------------------------------------------------------------------------- */
/* Boundaries / summaries / relationships                                                   */
/* ---------------------------------------------------------------------------------------- */

interface RangeProps {
  doc: MindMap;
  layout: Layout;
}

function rangeGeometry(
  doc: MindMap,
  layout: Layout,
  parentId: string,
  from: number,
  to: number,
): { box: Box; parent: PlacedTopic; first: PlacedTopic } | null {
  const parentTopic = findTopic(doc.root, parentId);
  const parent = layout.placed.get(parentId);
  if (!parentTopic || !parent) return null;
  const box = rangeBox(layout, parentTopic, from, to);
  const firstChild = parentTopic.children[from];
  const first = firstChild ? layout.placed.get(firstChild.id) : undefined;
  if (!box || !first) return null;
  return { box, parent, first };
}

function BoundaryShape({
  boundary,
  doc,
  layout,
}: RangeProps & { boundary: MindMap['boundaries'][number] }) {
  const geo = rangeGeometry(doc, layout, boundary.parent, boundary.from, boundary.to);
  if (!geo) return null;
  const pad = BOUNDARY_PAD;
  const { box } = geo;
  const pal = paletteOf(geo.first.branch);
  return (
    <g className={styles.boundary} style={branchStyle(pal)}>
      <rect
        x={box.x - pad}
        y={box.y - pad}
        width={box.w + pad * 2}
        height={box.h + pad * 2}
        rx={14}
      />
      {boundary.label && (
        <text x={box.x + box.w + pad - 4} y={box.y + box.h + pad + 13} textAnchor="end">
          {boundary.label}
        </text>
      )}
    </g>
  );
}

const SUMMARY_GAP = 8;
const SUMMARY_TICK = 6;

function summaryAnchor(geo: { box: Box; first: PlacedTopic }) {
  const { box, first } = geo;
  if (first.dir === 'down') {
    const y0 = box.y + box.h + SUMMARY_GAP;
    const xm = box.x + box.w / 2;
    return {
      dir: first.dir,
      bracket: `M${box.x} ${y0} v${SUMMARY_TICK} H${box.x + box.w} v${-SUMMARY_TICK} M${xm} ${y0 + SUMMARY_TICK} v${SUMMARY_TICK}`,
      x: xm,
      y: y0 + SUMMARY_TICK * 2 + 4,
    };
  }
  const toRight = first.dir === 'right';
  const x0 = toRight ? box.x + box.w + SUMMARY_GAP : box.x - SUMMARY_GAP;
  const tick = toRight ? SUMMARY_TICK : -SUMMARY_TICK;
  const ym = box.y + box.h / 2;
  return {
    dir: first.dir,
    bracket: `M${x0} ${box.y} h${tick} V${box.y + box.h} h${-tick} M${x0 + tick} ${ym} h${tick}`,
    x: x0 + tick * 2 + (toRight ? 4 : -4),
    y: ym,
  };
}

function SummaryBracket({
  summary,
  doc,
  layout,
}: RangeProps & { summary: MindMap['summaries'][number] }) {
  const geo = rangeGeometry(doc, layout, summary.parent, summary.from, summary.to);
  if (!geo) return null;
  const anchor = summaryAnchor(geo);
  return (
    <path
      className={styles.summaryBracket}
      d={anchor.bracket}
      style={branchStyle(paletteOf(geo.first.branch))}
    />
  );
}

function SummaryLabel({
  summary,
  doc,
  layout,
}: RangeProps & { summary: MindMap['summaries'][number] }) {
  const geo = rangeGeometry(doc, layout, summary.parent, summary.from, summary.to);
  if (!geo) return null;
  const anchor = summaryAnchor(geo);
  const size = measureTopic(topic(summary.text, [], { id: summary.id }), 2);
  const metrics = metricsFor(2);
  const left =
    anchor.dir === 'right'
      ? anchor.x
      : anchor.dir === 'left'
        ? anchor.x - size.w
        : anchor.x - size.w / 2;
  const top = anchor.dir === 'down' ? anchor.y : anchor.y - size.h / 2;
  return (
    <div
      className={styles.summary}
      style={
        {
          left,
          top,
          width: size.w,
          minHeight: size.h,
          fontSize: metrics.fontSize,
          lineHeight: `${metrics.lineHeight}px`,
          padding: `${metrics.padY}px ${metrics.padX}px`,
          ...branchStyle(paletteOf(geo.first.branch)),
        } as CSSProperties
      }
    >
      {summary.text}
    </div>
  );
}

function RelationshipLine({
  rel,
  layout,
}: {
  rel: MindMap['relationships'][number];
  layout: Layout;
}) {
  const a = layout.placed.get(rel.from);
  const b = layout.placed.get(rel.to);
  if (!a || !b) return null;
  const p0 = { x: a.box.x + a.box.w / 2, y: a.box.y };
  const p3 = { x: b.box.x + b.box.w / 2, y: b.box.y };
  const lift = Math.max(70, Math.abs(p3.x - p0.x) * 0.22);
  const top = Math.min(p0.y, p3.y) - lift;
  const p1 = { x: p0.x, y: top };
  const p2 = { x: p3.x, y: top };
  const mid = {
    x: 0.125 * p0.x + 0.375 * p1.x + 0.375 * p2.x + 0.125 * p3.x,
    y: 0.125 * p0.y + 0.375 * p1.y + 0.375 * p2.y + 0.125 * p3.y,
  };
  return (
    <g className={styles.relationship}>
      <path
        d={`M${p0.x} ${p0.y} C${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`}
        markerStart="url(#mm-rel-arrow)"
        markerEnd="url(#mm-rel-arrow)"
      />
      {rel.label && (
        <text x={mid.x} y={mid.y - 6} textAnchor="middle">
          {rel.label}
        </text>
      )}
    </g>
  );
}

/* ---------------------------------------------------------------------------------------- */
/* Notes                                                                                    */
/* ---------------------------------------------------------------------------------------- */

interface NotesPanelProps {
  topic: Topic;
  onClose: () => void;
  onCommit: (note: string) => void;
}

function NotesPanel({ topic: t, onClose, onCommit }: NotesPanelProps) {
  const [value, setValue] = useState(t.note ?? '');
  return (
    <aside className={styles.notes} aria-label="备注">
      <div className={styles.notesHead}>
        <span className={styles.notesTitle}>
          <Note size={16} weight="duotone" aria-hidden="true" />
          备注 · {t.title || '未命名'}
        </span>
        <IconButton variant="ghost" size="xs" aria-label="关闭备注" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </IconButton>
      </div>
      <textarea
        className={styles.notesBody}
        value={value}
        placeholder="给这个主题写一段说明…"
        aria-label={`${t.title || '未命名'} 的备注`}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value.trim() !== (t.note ?? '')) onCommit(value);
        }}
      />
      <p className={styles.notesHint}>失焦即保存 · 备注不参与布局</p>
    </aside>
  );
}
