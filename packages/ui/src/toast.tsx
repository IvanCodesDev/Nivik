'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cn } from './cn';

export interface ToastOptions {
  /** `dark` ink bubble (default) or `light` white card. */
  tone?: 'dark' | 'light';
  /** Milliseconds before auto-dismiss. */
  duration?: number;
  /** Distance from the bottom edge in px (e.g. to float above a composer). */
  bottom?: number;
}

export type ToastFn = (message: string, options?: ToastOptions) => void;

interface ToastState {
  id: number;
  message: string;
  tone: 'dark' | 'light';
  bottom: number;
}

const ToastContext = createContext<ToastFn | null>(null);

export interface ToastProviderProps {
  children: ReactNode;
  defaultTone?: 'dark' | 'light';
  defaultDuration?: number;
}

export function ToastProvider({
  children,
  defaultTone = 'dark',
  defaultDuration = 2600,
}: ToastProviderProps) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ToastFn>(
    (message, options) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({
        id: Date.now(),
        message,
        tone: options?.tone ?? defaultTone,
        bottom: options?.bottom ?? 26,
      });
      timer.current = setTimeout(() => setToast(null), options?.duration ?? defaultDuration);
    },
    [defaultTone, defaultDuration],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="nv-toast-region" aria-live="polite" aria-atomic="true">
        {toast && (
          <div
            key={toast.id}
            role="status"
            className={cn('nv-toast', `nv-toast--${toast.tone}`)}
            style={{ bottom: toast.bottom }}
          >
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>.');
  return ctx;
}
