import type { Id } from '@nivik/ir';
import type { LiveSession, Viewport } from '@nivik/renderer-core';
import { create } from 'zustand';

export interface RendererState {
  session: LiveSession | null;
  ready: boolean;
  selection: Id[];
  viewport: Viewport;
  setSession(session: LiveSession | null): void;
  setSelection(ids: Id[]): void;
  setViewport(viewport: Viewport): void;
}

/** Spec 07 §2 `rendererStore` (minimal): the mounted session plus what it pushes back. */
export const useRendererStore = create<RendererState>()((set) => ({
  session: null,
  ready: false,
  selection: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  setSession: (session) => set({ session, ready: session !== null, selection: [] }),
  setSelection: (selection) => set({ selection }),
  setViewport: (viewport) => set({ viewport }),
}));
