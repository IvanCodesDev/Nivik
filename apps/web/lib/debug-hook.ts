import type { Diagram } from '@nivik/ir';
import type { Viewport } from '@nivik/renderer-core';
import { diagramStore, type HistoryEntry } from '@/lib/stores/diagram-store';
import { useRendererStore } from '@/lib/stores/renderer-store';

export interface NivikDebugHook {
  diagram(): Diagram | null;
  history(): { undo: HistoryEntry[]; redo: HistoryEntry[] };
  viewport(): Viewport;
}

declare global {
  interface Window {
    __nivik?: NivikDebugHook;
  }
}

/**
 * Read-only window into the stores for DevTools and the Playwright suite. Installed in development
 * and when the app is built with `NEXT_PUBLIC_NIVIK_E2E=1`; production builds leave it out.
 */
export function installDebugHook(): () => void {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_NIVIK_E2E !== '1') {
    return () => {};
  }
  window.__nivik = {
    diagram: () => diagramStore.getState().diagram,
    history: () => diagramStore.getState().history,
    viewport: () => useRendererStore.getState().viewport,
  };
  return () => {
    delete window.__nivik;
  };
}
