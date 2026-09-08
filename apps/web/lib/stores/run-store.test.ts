import type { Plan, RunEvent } from '@nivik/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { newRunView, reduceRunEvent, useRunStore } from './run-store';

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
