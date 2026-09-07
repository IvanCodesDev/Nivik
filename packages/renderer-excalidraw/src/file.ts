import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

export interface ExcalidrawScene {
  elements: ExcalidrawElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/** The `.excalidraw` envelope (what `serializeAsJSON` writes) without needing the browser bundle. */
export function serializeScene(
  elements: readonly ExcalidrawElement[],
  appState: Record<string, unknown> = {},
  files: Record<string, unknown> = {},
): string {
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'https://nivik.app',
      elements,
      appState: { gridSize: null, viewBackgroundColor: '#ffffff', ...appState },
      files,
    },
    null,
    2,
  );
}

export function parseScene(text: string): ExcalidrawScene {
  const raw: unknown = JSON.parse(text);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as { type?: unknown }).type !== 'excalidraw' ||
    !Array.isArray((raw as { elements?: unknown }).elements)
  ) {
    throw new Error('not an .excalidraw scene');
  }
  const scene = raw as {
    elements: ExcalidrawElement[];
    appState?: Record<string, unknown>;
    files?: Record<string, unknown>;
  };
  return { elements: scene.elements, appState: scene.appState ?? {}, files: scene.files ?? {} };
}
