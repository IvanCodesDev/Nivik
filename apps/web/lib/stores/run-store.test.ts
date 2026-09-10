import type { Plan, RunEvent } from '@nivik/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { type BudgetView, budgetRatio, newRunView, reduceRunEvent, useRunStore } from './run-store';

const plan: Plan = {
  intent: 'generate',
  diagramType: 'flow',
  scope: { kind: 'all' },
  summary: 'Sketch 2 steps',
  steps: ['Add "A"', 'Add "B"'],
  layout: { algorithm: 'layered', direction: 'RIGHT' },
  estimatedNodes: 2,
};

const events: RunEvent[] = [
  { type: 'status', stage: 'understanding' },
  { type: 'plan', plan },
  { type: 'status', stage: 'building' },
  {
    type: 'action',
    index: 0,
    action: { op: 'addNode', node: { id: 'a', type: 'rounded', label: 'A', parent: null } },
    ok: true,
  },
  {
    type: 'action',
    index: 1,
    action: { op: 'deleteNode', id: 'zzz' },
    ok: false,
    error: 'unknown node zzz',
  },
  { type: 'validation', result: { ok: true, errors: [], warnings: [] } },
  { type: 'error', code: 'E_PROVIDER_RATE_LIMIT', message: 'rate limited', recoverable: true },
  { type: 'usage', usage: { inputTokens: 10, outputTokens: 20, calls: 1 } },
  { type: 'done', runId: 'run_1' },
];

describe('reduceRunEvent', () => {
  it('projects the stream onto the view the pill and drawer show', () => {
    const view = events.reduce(reduceRunEvent, newRunView('run_1', 5));
    expect(view.stage).toBe('building');
    expect(view.plan?.summary).toBe('Sketch 2 steps');
    expect(view.actions).toEqual([
      { index: 0, op: 'addNode', ok: true },
      { index: 1, op: 'deleteNode', ok: false, message: 'unknown node zzz' },
    ]);
    expect(view.validation?.ok).toBe(true);
    expect(view.errors).toEqual([
      { code: 'E_PROVIDER_RATE_LIMIT', message: 'rate limited', recoverable: true },
    ]);
    expect(view.usage?.calls).toBe(1);
    expect(view.status).toBe('running');
    expect(view.applied).toBe(0);
    expect(view.outcome).toBe('finished');
  });

  it('projects the loop events: replies, questions, trace, sub-agents, documents, budget, outcome', () => {
    const loop: RunEvent[] = [
      { type: 'status', stage: 'thinking' },
      { type: 'reply', text: 'Looking at ', final: false },
      { type: 'reply', text: 'the diagram.', final: true },
      { type: 'tool', name: 'setPlan', durationMs: 0, call: 'c1', status: 'start' },
      {
        type: 'tool',
        name: 'setPlan',
        durationMs: 12,
        call: 'c1',
        status: 'end',
        summary: 'flow · layered',
      },
      { type: 'tool', name: 'ask', durationMs: 0, call: 'c2', status: 'start' },
      {
        type: 'question',
        questionId: 'q1',
        text: 'Retry?',
        choices: ['Yes', 'No'],
        allowFreeText: true,
      },
      { type: 'answer', questionId: 'q1', text: 'Yes' },
      {
        type: 'tool',
        name: 'ask',
        durationMs: 3000,
        call: 'c2',
        status: 'end',
        summary: 'answer: Yes',
      },
      { type: 'subagent', role: 'review', status: 'start' },
      {
        type: 'subagent',
        role: 'review',
        status: 'end',
        issues: [{ severity: 'warning', message: 'Orphan node', ids: ['x'] }],
        usage: { inputTokens: 5, outputTokens: 1, calls: 1 },
      },
      { type: 'document', op: 'create', document: { id: 'd_side', name: 'Board', type: 'kanban' } },
      { type: 'document', op: 'switch', document: { id: 'd_side', name: 'Board', type: 'kanban' } },
      {
        type: 'budget',
        used: { inputTokens: 900, outputTokens: 100, calls: 3, elapsedMs: 4_000 },
        limit: { inputTokens: 2_000, outputTokens: 0, calls: 0, elapsedMs: 0 },
        phase: 'normal',
      },
      { type: 'reply', text: 'Half way', final: false },
      {
        type: 'done',
        runId: 'run_1',
        outcome: 'budget-exhausted',
        summary: 'Ran out',
        unresolved: ['Board'],
      },
    ];
    const view = loop.reduce(reduceRunEvent, newRunView('run_1', 5));
    expect(view.replies).toEqual(['Looking at the diagram.']);
    expect(view.pendingReply).toBe('Half way');
    expect(view.questions).toEqual([
      {
        questionId: 'q1',
        text: 'Retry?',
        choices: ['Yes', 'No'],
        allowFreeText: true,
        answer: 'Yes',
      },
    ]);
    expect(view.trace).toEqual([
      { call: 'c1', name: 'setPlan', status: 'end', summary: 'flow · layered', durationMs: 12 },
      { call: 'c2', name: 'ask', status: 'end', summary: 'answer: Yes', durationMs: 3000 },
    ]);
    expect(view.subagentIssues).toEqual([
      { role: 'review', issues: [{ severity: 'warning', message: 'Orphan node', ids: ['x'] }] },
    ]);
    expect(view.documents).toEqual([{ id: 'd_side', name: 'Board', type: 'kanban' }]);
    expect(view.budget?.phase).toBe('normal');
    expect(budgetRatio(view.budget as BudgetView)).toBe(0.5);
    expect(view).toMatchObject({
      outcome: 'budget-exhausted',
      summary: 'Ran out',
      unresolved: ['Board'],
    });
  });

  it('measures the budget by whichever of tokens and time is further along', () => {
    const limit = { inputTokens: 1_000, outputTokens: 0, calls: 0, elapsedMs: 10_000 };
    const at = (tokens: number, ms: number): BudgetView => ({
      used: { inputTokens: tokens, outputTokens: 0, calls: 1, elapsedMs: ms },
      limit,
      phase: 'normal',
    });
    expect(budgetRatio(at(100, 9_000))).toBe(0.9);
    expect(budgetRatio(at(1_500, 0))).toBe(1);
    expect(
      budgetRatio({ ...at(500, 500), limit: { ...limit, inputTokens: 0, elapsedMs: 0 } }),
    ).toBe(0);
  });
});

describe('useRunStore', () => {
  beforeEach(() => {
    useRunStore.setState({ current: null, recent: [], review: null, drawerOpen: false });
  });

  it('tracks the current run and archives it on finish', () => {
    const store = useRunStore.getState();
    store.begin('run_1', 1);
    for (const event of events) useRunStore.getState().event(event);
    expect(useRunStore.getState().current?.actions).toHaveLength(2);

    useRunStore.getState().finish('done', 9);
    const state = useRunStore.getState();
    expect(state.current).toBeNull();
    expect(state.recent).toHaveLength(1);
    expect(state.recent[0]).toMatchObject({ runId: 'run_1', status: 'done', finishedAt: 9 });
  });

  it('ignores events without a current run and clears the review when a new run begins', () => {
    useRunStore.getState().event({ type: 'status', stage: 'building' });
    expect(useRunStore.getState().current).toBeNull();
    useRunStore.getState().setReview({
      runId: 'run_0',
      summary: 'x',
      affected: { added: [], modified: [], deleted: [] },
      at: 1,
    });
    useRunStore.getState().begin('run_1', 2);
    expect(useRunStore.getState().review).toBeNull();
  });
});
