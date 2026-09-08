import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { type Diagram, type Id, newEdgeId, newGroupId, newNodeId, rectOf } from '@nivik/ir';
import {
  createReconcileQueue,
  type HighlightInput,
  highlightShapes,
  isNivik,
  type LiveHooks,
  type LiveSession,
  type MountOptions,
  mainOf,
  mountHighlightOverlay,
  type RendererPatch,
  reconcile,
  type Viewport,
} from '@nivik/renderer-core';
import { FONT_CSS } from './constants';
import { fromExcalidraw } from './from-excalidraw';
import { canvasTextWidth, createExcalidrawMeasurer } from './measurer';
import { mergeById } from './merge';
import { toExcalidraw } from './to-excalidraw';

const selectedMainIds = (appState: AppState): Id[] => [
  ...new Set(
    Object.keys(appState.selectedElementIds).flatMap((id) => {
      const main = mainOf(id);
      return main ? [main] : [];
    }),
  ),
];

/**
 * Spec 04 §6.1 / §6.3 / §6.5. Browser only: the Excalidraw bundle, React and react-dom are loaded
 * here so the pure mapping layer stays importable in Node.
 */
export async function mountExcalidraw(
  host: HTMLElement,
  initial: Diagram,
  hooks: LiveHooks,
  opts: MountOptions = { theme: 'light' },
): Promise<LiveSession> {
  const [excalidraw, React, { createRoot }] = await Promise.all([
    import('@excalidraw/excalidraw'),
    import('react'),
    import('react-dom/client'),
  ]);
  const {
    Excalidraw,
    convertToExcalidrawElements,
    CaptureUpdateAction,
    exportToBlob,
    exportToSvg,
  } = excalidraw;
  const doc = host.ownerDocument;
  const container = doc.createElement('div');
  Object.assign(container.style, { position: 'absolute', inset: '0' });
  host.appendChild(container);

  let diagram = initial;
  let viewport: Viewport = { x: 0, y: 0, zoom: 1 };
  let selectionKey = '';
  let highlight: { input: HighlightInput; timer: ReturnType<typeof setTimeout> } | null = null;
  const overlay = mountHighlightOverlay(host);
  const measurer = createExcalidrawMeasurer(
    canvasTextWidth(doc, FONT_CSS[initial.theme.strokeStyle]) ?? undefined,
  );
  const project = (d: Diagram, ids?: Id[]) =>
    convertToExcalidrawElements(toExcalidraw(d, ids ? { ids } : {}).elements, {
      regenerateIds: false,
    });
  const redrawHighlight = () => {
    if (highlight) overlay.render(highlightShapes(diagram, highlight.input, viewport));
  };
  const queue = createReconcileQueue<readonly ExcalidrawElement[]>({
    onFlush: (elements) => {
      const cs = reconcile(diagram, fromExcalidraw(elements, diagram), {
        newNodeId,
        newEdgeId,
        newGroupId,
      });
      if (cs) hooks.onChange(cs);
    },
  });

  const root = createRoot(container);
  const api = await new Promise<ExcalidrawImperativeAPI>((resolve) => {
    root.render(
      React.createElement(Excalidraw, {
        excalidrawAPI: resolve,
        initialData: {
          elements: project(initial),
          appState: { viewBackgroundColor: '#ffffff' },
          scrollToContent: true,
        },
        theme: opts.theme,
        langCode: opts.locale,
        viewModeEnabled: opts.readOnly ?? false,
        UIOptions: {
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            clearCanvas: false,
            changeViewBackgroundColor: false,
          },
        },
        onChange: (elements: readonly ExcalidrawElement[], appState: AppState) => {
          viewport = { x: appState.scrollX, y: appState.scrollY, zoom: appState.zoom.value };
          hooks.onViewportChange?.(viewport);
          redrawHighlight();
          const ids = selectedMainIds(appState);
          const key = ids.join(',');
          if (key !== selectionKey) {
            selectionKey = key;
            hooks.onSelectionChange?.(ids);
          }
          queue.push(elements);
        },
      }),
    );
  });
  api.onPointerUp(() => queue.flush());

  const allVisible = (ids: readonly Id[]): boolean => {
    const s = api.getAppState();
    const left = -s.scrollX;
    const top = -s.scrollY;
    const right = left + s.width / s.zoom.value;
    const bottom = top + s.height / s.zoom.value;
    return ids.every((id) => {
      const element = [...diagram.nodes, ...diagram.groups].find((e) => e.id === id);
      const r = element ? rectOf(element) : null;
      return !r || (r.x >= left && r.y >= top && r.x + r.w <= right && r.y + r.h <= bottom);
    });
  };
  const sceneFor = (ids?: readonly Id[]) =>
    ids
      ? api.getSceneElements().filter((el) => ids.includes(mainOf(el.id) ?? ''))
      : api.getSceneElements();

  const session: LiveSession = {
    async apply(patch: RendererPatch) {
      diagram = patch.diagram;
      const scene = api.getSceneElementsIncludingDeleted();
      const sceneWasEmpty = scene.every((el) => el.isDeleted);
      const touched = [...patch.affected.added, ...patch.affected.modified];
      const touchedSet = new Set(touched);
      const deleted = new Set(patch.affected.deleted);
      const softDelete = scene
        .filter((el) => {
          const irId = isNivik(el.customData) ? el.customData.nivik.id : null;
          if (irId !== null && deleted.has(irId)) return true;
          // Bound labels are regenerated with fresh ids on every projection; retire the old ones.
          return (
            el.type === 'text' &&
            el.containerId !== null &&
            touchedSet.has(mainOf(el.containerId) ?? '')
          );
        })
        .map((el) => el.id);
      const upsert = touched.length > 0 ? project(patch.diagram, touched) : [];
      api.updateScene({
        elements: mergeById(scene, { upsert, softDelete }),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      // First content is centred even when it would technically fit: at scroll (0, 0) it would sit
      // in the corner under whatever chrome the host draws over the canvas.
      if (patch.affected.added.length > 0 && (sceneWasEmpty || !allVisible(patch.affected.added))) {
        await session.fit(patch.affected.added, { animate: !sceneWasEmpty });
      }
    },
    async replace(d) {
      diagram = d;
      api.updateScene({ elements: project(d), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    },
    async getSelection() {
      return selectedMainIds(api.getAppState());
    },
    async setSelection(ids) {
      api.updateScene({
        appState: { selectedElementIds: Object.fromEntries(ids.map((id) => [id, true as const])) },
      });
    },
    highlight(h, { ttlMs }) {
      if (highlight) clearTimeout(highlight.timer);
      highlight = { input: h, timer: setTimeout(() => session.clearHighlight(), ttlMs) };
      redrawHighlight();
    },
    clearHighlight() {
      if (highlight) clearTimeout(highlight.timer);
      highlight = null;
      overlay.clear();
    },
    async fit(ids, fitOpts) {
      api.scrollToContent(sceneFor(ids), {
        fitToContent: true,
        animate: fitOpts?.animate ?? true,
        duration: 300,
      });
    },
    async exportImage(imgOpts) {
      const elements = sceneFor(imgOpts.ids);
      const appState = { ...api.getAppState(), exportBackground: imgOpts.background ?? true };
      const files = api.getFiles();
      if (imgOpts.format === 'png') {
        const scale = imgOpts.scale ?? 1;
        return exportToBlob({
          elements,
          appState,
          files,
          mimeType: 'image/png',
          getDimensions: (w: number, h: number) => ({ width: w * scale, height: h * scale, scale }),
        });
      }
      const svg = await exportToSvg({ elements, appState, files });
      return new Blob([svg.outerHTML], { type: 'image/svg+xml' });
    },
    measurer,
    setReadOnly(v) {
      api.updateScene({ appState: { viewModeEnabled: v } });
    },
    destroy() {
      queue.dispose();
      session.clearHighlight();
      overlay.destroy();
      // The host usually destroys from an effect cleanup, i.e. while React is committing its own
      // tree; unmounting another root synchronously there is a React warning, so defer it.
      setTimeout(() => {
        root.unmount();
        container.remove();
      }, 0);
    },
  };
  hooks.onReady?.();
  return session;
}
