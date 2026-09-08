'use client';

import '@excalidraw/excalidraw/index.css';
import type { Diagram } from '@nivik/ir';
import type { LiveHooks, LiveSession } from '@nivik/renderer-core';
import { excalidrawAdapter } from '@nivik/renderer-excalidraw';
import { useEffect, useRef } from 'react';
import styles from './canvas.module.css';

declare global {
  interface Window {
    /** Where Excalidraw loads its fonts from; unset means its default CDN. */
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

export interface RendererHostProps {
  /** Diagram at mount time; later versions reach the canvas through `LiveSession.apply`. */
  initial: Diagram;
  theme: 'light' | 'dark';
  locale: string;
  hooks: LiveHooks;
  onSession(session: LiveSession | null): void;
}

/**
 * Spec 07 §3 `<RendererHost/>`: owns the adapter's DOM host. Mounting is async, so a cleanup that
 * runs before the mount resolves (StrictMode, fast navigation) destroys the session on arrival.
 * Only theme and locale remount; everything else is read through refs so the canvas is never torn
 * down because the parent re-rendered. Switching diagrams is the parent's job (`key={diagram.id}`).
 */
export function RendererHost({ initial, theme, locale, hooks, onSession }: RendererHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef(initial);
  const hooksRef = useRef(hooks);
  const onSessionRef = useRef(onSession);
  initialRef.current = initial;
  hooksRef.current = hooks;
  onSessionRef.current = onSession;

  useEffect(() => {
    const host = hostRef.current;
    const mount = excalidrawAdapter.mount;
    if (!host || !mount) return;
    const assetPath = process.env.NEXT_PUBLIC_EXCALIDRAW_ASSET_PATH;
    if (assetPath) window.EXCALIDRAW_ASSET_PATH = assetPath;

    let cancelled = false;
    let session: LiveSession | null = null;
    const forward: LiveHooks = {
      onChange: (cs) => hooksRef.current.onChange(cs),
      onSelectionChange: (ids) => hooksRef.current.onSelectionChange?.(ids),
      onViewportChange: (viewport) => hooksRef.current.onViewportChange?.(viewport),
      onRendererStateChange: (state) => hooksRef.current.onRendererStateChange?.(state),
      onWarning: (warning) => hooksRef.current.onWarning?.(warning),
      onReady: () => hooksRef.current.onReady?.(),
      onError: (error) => hooksRef.current.onError?.(error),
    };
    mount(host, initialRef.current, forward, { theme, locale }).then(
      (mounted) => {
        if (cancelled) {
          mounted.destroy();
          return;
        }
        session = mounted;
        onSessionRef.current(mounted);
      },
      (error: unknown) => {
        if (cancelled) return;
        hooksRef.current.onError?.(error instanceof Error ? error : new Error(String(error)));
      },
    );
    return () => {
      cancelled = true;
      session?.destroy();
      session = null;
      onSessionRef.current(null);
    };
  }, [theme, locale]);

  return (
    <div
      ref={hostRef}
      className={styles.renderer}
      data-testid="renderer-host"
      data-diagram-id={initial.id}
    />
  );
}
