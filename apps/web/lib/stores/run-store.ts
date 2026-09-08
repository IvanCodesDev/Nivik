import type { Affected } from '@nivik/ir';
import type { Plan, RunEvent, RunEventOf, RunStage, Usage } from '@nivik/protocol';
import { create } from 'zustand';

export interface RunActionView {
  index: number;
  op: string;
  ok: boolean;
  message?: string;
}

export type ValidationView = RunEventOf<'validation'>['result'];

export interface RunView {
  runId: string;
  stage: RunStage;
  status: 'running' | 'done' | 'failed' | 'aborted';
  startedAt: number;
  finishedAt?: number;
  plan: Plan | null;
  actions: RunActionView[];
  validation: ValidationView | null;
  errors: { code: string; message: string; recoverable: boolean }[];
  usage: Usage | null;
  /** Change sets the diagram store accepted from this run. */
  applied: number;
}

/** What the ChangeReviewBar shows after a run applied something (spec 07 §3.1). */
export interface ReviewState {
  runId: string;
  summary: string;
  affected: Affected;
  at: number;
}

export function newRunView(runId: string, startedAt: number): RunView {
  return {
    runId,
    stage: 'understanding',
    status: 'running',
    startedAt,
    plan: null,
    actions: [],
    validation: null,
    errors: [],
    usage: null,
    applied: 0,
  };
}

/** Pure projection of the event stream onto what the pill and drawer display. */
export function reduceRunEvent(view: RunView, event: RunEvent): RunView {
  switch (event.type) {
    case 'status':
      return { ...view, stage: event.stage };
    case 'plan':
      return { ...view, plan: event.plan };
    case 'action':
      return {
        ...view,
        actions: [
          ...view.actions,
          {
            index: event.index,
            op: event.action.op,
            ok: event.ok,
            ...(event.error ? { message: event.error } : {}),
          },
        ],
      };
    case 'changeSet':
      return { ...view, applied: view.applied + 1 };
    case 'validation':
      return { ...view, validation: event.result };
    case 'error':
      return {
        ...view,
        errors: [
          ...view.errors,
          { code: event.code, message: event.message, recoverable: event.recoverable },
        ],
      };
    case 'usage':
      return { ...view, usage: event.usage };
    default:
      return view;
  }
}

export interface RunStoreState {
  current: RunView | null;
  /** Finished runs, newest first, for the drawer. */
  recent: RunView[];
  review: ReviewState | null;
  drawerOpen: boolean;
  begin(runId: string, at: number): void;
  event(event: RunEvent): void;
  finish(status: Exclude<RunView['status'], 'running'>, at: number): void;
  setReview(review: ReviewState | null): void;
  setDrawerOpen(open: boolean): void;
}

const RECENT_LIMIT = 10;

/** Spec 07 §2 `runStore` (minimal). */
export const useRunStore = create<RunStoreState>()((set) => ({
  current: null,
  recent: [],
  review: null,
  drawerOpen: false,
  begin: (runId, at) => set({ current: newRunView(runId, at), review: null }),
  event: (event) => set((s) => (s.current ? { current: reduceRunEvent(s.current, event) } : {})),
  finish: (status, at) =>
    set((s) => {
      if (!s.current) return {};
      const finished: RunView = { ...s.current, status, finishedAt: at };
      return { current: null, recent: [finished, ...s.recent].slice(0, RECENT_LIMIT) };
    }),
  setReview: (review) => set({ review }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
}));
