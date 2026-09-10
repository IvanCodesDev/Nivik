import type { Affected } from '@nivik/ir';
import type {
  BudgetPhase,
  BudgetUsage,
  DocumentInfo,
  DoneOutcome,
  Plan,
  ReviewIssue,
  RunEvent,
  RunEventOf,
  RunStage,
  SubagentRole,
  Usage,
} from '@nivik/protocol';
import { create } from 'zustand';

export interface RunActionView {
  index: number;
  op: string;
  ok: boolean;
  message?: string;
}

export type ValidationView = RunEventOf<'validation'>['result'];

/** One tool call of the loop, `start` and `end` merged (spec 07 §3.1 drawer trace). */
export interface TraceEntry {
  call: string;
  name: string;
  status: 'start' | 'end';
  summary?: string;
  durationMs: number;
}

export interface QuestionView {
  questionId: string;
  text: string;
  choices?: string[];
  allowFreeText: boolean;
  answer: string | null;
}

export interface BudgetView {
  used: BudgetUsage;
  limit: BudgetUsage;
  phase: BudgetPhase;
}

/** Share of the soft budget spent (tokens or time, whichever is further), 0–1; 0 when unlimited. */
export function budgetRatio(budget: BudgetView): number {
  const tokens = budget.limit.inputTokens + budget.limit.outputTokens;
  const usedTokens = budget.used.inputTokens + budget.used.outputTokens;
  const byTokens = tokens > 0 ? usedTokens / tokens : 0;
  const byTime = budget.limit.elapsedMs > 0 ? budget.used.elapsedMs / budget.limit.elapsedMs : 0;
  return Math.min(1, Math.max(byTokens, byTime));
}

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
  /** D14′: what the model said, asked, called and created, and how the run ended. */
  replies: string[];
  /** Reply text still streaming (not yet `final`). */
  pendingReply: string;
  questions: QuestionView[];
  trace: TraceEntry[];
  subagentIssues: { role: SubagentRole; issues: ReviewIssue[] }[];
  documents: DocumentInfo[];
  budget: BudgetView | null;
  outcome: DoneOutcome | null;
  summary: string | null;
  unresolved: string[];
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
    replies: [],
    pendingReply: '',
    questions: [],
    trace: [],
    subagentIssues: [],
    documents: [],
    budget: null,
    outcome: null,
    summary: null,
    unresolved: [],
  };
}

/** Pure projection of the event stream onto what the pill and drawer display. */
export function reduceRunEvent(view: RunView, event: RunEvent): RunView {
  switch (event.type) {
    case 'status':
      return { ...view, stage: event.stage };
    case 'plan':
      return { ...view, plan: event.plan };
    case 'reply': {
      const text = view.pendingReply + event.text;
      if (!event.final) return { ...view, pendingReply: text };
      const trimmed = text.trim();
      return {
        ...view,
        pendingReply: '',
        replies: trimmed ? [...view.replies, trimmed] : view.replies,
      };
    }
    case 'question':
      return {
        ...view,
        questions: [
          ...view.questions,
          {
            questionId: event.questionId,
            text: event.text,
            ...(event.choices ? { choices: event.choices } : {}),
            allowFreeText: event.allowFreeText,
            answer: null,
          },
        ],
      };
    case 'answer':
      return {
        ...view,
        questions: view.questions.map((q) =>
          q.questionId === event.questionId ? { ...q, answer: event.text } : q,
        ),
      };
    case 'tool': {
      if (!event.call || !event.status) return view;
      const entry: TraceEntry = {
        call: event.call,
        name: event.name,
        status: event.status,
        ...(event.summary ? { summary: event.summary } : {}),
        durationMs: event.durationMs,
      };
      const index = view.trace.findIndex((t) => t.call === event.call);
      if (index === -1) return { ...view, trace: [...view.trace, entry] };
      const trace = view.trace.slice();
      trace[index] = entry;
      return { ...view, trace };
    }
    case 'subagent':
      if (event.status !== 'end') return view;
      return {
        ...view,
        subagentIssues: [...view.subagentIssues, { role: event.role, issues: event.issues ?? [] }],
      };
    case 'document':
      if (event.op !== 'create') return view;
      return { ...view, documents: [...view.documents, event.document] };
    case 'budget':
      return { ...view, budget: { used: event.used, limit: event.limit, phase: event.phase } };
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
    case 'done':
      return {
        ...view,
        outcome: event.outcome ?? 'finished',
        summary: event.summary ?? null,
        unresolved: event.unresolved ?? [],
      };
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
