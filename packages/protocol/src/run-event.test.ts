import { createDiagram } from '@nivik/ir';
import { describe, expect, it } from 'vitest';
import { isTerminalEvent, RunEventSchema } from './run-event';
import { RENDERER_IDS, RunRequestSchema } from './run-request';

const diagram = () =>
  createDiagram({ name: 'Login', type: 'flow', id: 'd_test0001', now: 1_700_000_000_000 });

describe('RunRequestSchema', () => {
  it('applies defaults for optional collections and settings', () => {
    const parsed = RunRequestSchema.parse({
      diagram: diagram(),
      prompt: '  Draw a login flow  ',
      hints: { renderer: 'excalidraw' },
    });
    expect(parsed.prompt).toBe('Draw a login flow');
    expect(parsed.diagram).toEqual(diagram());
    expect(parsed.selection).toEqual([]);
    expect(parsed.sources).toEqual([]);
    expect(parsed.model).toBe('auto');
    expect(parsed.settings).toEqual({
      temperature: 0.3,
      maxTokens: 8_192,
      timeoutMs: 120_000,
      retries: 1,
      thinking: false,
    });
    // D14′: memory, host capabilities and the soft budget all have wire defaults.
    expect(parsed.session).toEqual({ recentTurns: [], summary: null });
    expect(parsed.capabilities).toEqual({ runtimeTools: false, ask: true });
    expect(parsed.budget).toEqual({ maxTokens: 400_000, maxMs: 600_000 });
  });

  it('carries session turns, capabilities and an unlimited budget when given', () => {
    const parsed = RunRequestSchema.parse({
      diagram: diagram(),
      prompt: 'Continue',
      hints: { renderer: 'excalidraw' },
      session: {
        summary: 'We drew a login flow.',
        recentTurns: [
          {
            runId: 'run_1',
            at: 1,
            user: 'Draw a login flow',
            agent: {
              replies: ['Done.'],
              questions: [{ text: 'Include SSO?', answer: 'Yes' }],
              changes: [
                { documentId: 'd_test0001', summary: 'Added 5 nodes', counts: { added: 5 } },
              ],
              outcome: 'finished',
            },
          },
        ],
      },
      capabilities: { runtimeTools: true },
      budget: { maxTokens: 0, maxMs: 0 },
    });
    expect(parsed.session.recentTurns).toHaveLength(1);
    expect(parsed.session.recentTurns[0]?.agent.questions[0]?.answer).toBe('Yes');
    expect(parsed.capabilities.runtimeTools).toBe(true);
    expect(parsed.budget).toEqual({ maxTokens: 0, maxMs: 0 });
    expect(
      RunRequestSchema.safeParse({
        diagram: diagram(),
        prompt: 'x',
        hints: { renderer: 'excalidraw' },
        budget: { maxTokens: -1 },
      }).success,
    ).toBe(false);
  });

  it('requires a real Diagram IR', () => {
    const base = { prompt: 'x', hints: { renderer: 'excalidraw' } };
    expect(RunRequestSchema.safeParse({ ...base, diagram: {} }).success).toBe(false);
    expect(
      RunRequestSchema.safeParse({ ...base, diagram: { ...diagram(), nodes: [{ id: 'n1' }] } })
        .success,
    ).toBe(false);
    expect(
      RunRequestSchema.safeParse({ ...base, diagram: diagram(), selection: ['bad id!'] }).success,
    ).toBe(false);
  });

  it('refuses a client-side diagram type: classifying the diagram is the plan stage job', () => {
    const base = { prompt: 'x', diagram: diagram() };
    expect(RunRequestSchema.safeParse({ ...base, hints: { renderer: 'excalidraw' } }).success).toBe(
      true,
    );
    expect(
      RunRequestSchema.safeParse({
        ...base,
        hints: { renderer: 'excalidraw', diagramType: 'flow' },
      }).success,
    ).toBe(false);
  });

  it('rejects blank prompts, unknown renderers and malformed run ids', () => {
    const base = { diagram: diagram(), hints: { renderer: 'excalidraw' } };
    expect(RunRequestSchema.safeParse({ ...base, prompt: '   ' }).success).toBe(false);
    expect(
      RunRequestSchema.safeParse({ ...base, prompt: 'x', hints: { renderer: 'visio' } }).success,
    ).toBe(false);
    expect(RunRequestSchema.safeParse({ ...base, prompt: 'x', runId: 'short' }).success).toBe(
      false,
    );
    expect(
      RunRequestSchema.safeParse({ ...base, prompt: 'x', runId: 'run_0123456789' }).success,
    ).toBe(true);
  });

  it('shares the renderer vocabulary with the IR (including plantuml)', () => {
    expect(RENDERER_IDS).toEqual(['excalidraw', 'drawio', 'nivik', 'mermaid', 'plantuml']);
    const base = { diagram: diagram(), prompt: 'x' };
    expect(RunRequestSchema.safeParse({ ...base, hints: { renderer: 'plantuml' } }).success).toBe(
      true,
    );
  });
});

describe('RunEventSchema', () => {
  const addNode = {
    op: 'addNode',
    node: { id: 'n1', type: 'rounded', label: 'Start', parent: null },
  };
  const changeSet = {
    id: 'cs_0001',
    diagramId: 'd_test0001',
    baseVersion: 1,
    origin: 'ai',
    runId: 'run_0123456789',
    actions: [addNode],
    createdAt: 1_700_000_000_000,
  };

  it('round-trips every event kind through JSON', () => {
    const events = [
      { type: 'status', stage: 'planning' },
      {
        type: 'plan',
        plan: {
          intent: 'generate',
          diagramType: 'flow',
          scope: { kind: 'all' },
          summary: 'Login flow',
          steps: ['Add nodes', 'Connect'],
          layout: { direction: 'RIGHT' },
          estimatedNodes: 6,
        },
      },
      { type: 'action', index: 0, action: addNode, ok: true },
      { type: 'repair', attempted: 2, fixed: 1 },
      { type: 'changeSet', changeSet },
      { type: 'validation', result: { ok: true, errors: [], warnings: [] } },
      {
        type: 'validation',
        result: {
          ok: false,
          errors: [{ code: 'E_UNKNOWN_REF', severity: 'error', ids: ['e1'], message: 'dangling' }],
          warnings: [],
        },
      },
      { type: 'review', issues: [{ severity: 'warning', message: 'Orphan node', ids: ['n1'] }] },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, calls: 1 } },
      { type: 'tool', name: 'findNodes', durationMs: 3 },
      { type: 'error', code: 'E_PROVIDER_TIMEOUT', message: 'timed out', recoverable: true },
      { type: 'done', runId: 'run_0123456789' },
    ];
    for (const event of events) {
      const parsed = RunEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(parsed).toEqual(event);
    }
  });

  it('round-trips the D14′ tool-loop events and fields', () => {
    const events = [
      { type: 'status', stage: 'thinking' },
      { type: 'status', stage: 'asking' },
      { type: 'reply', text: 'I will add the payment step.', final: false },
      {
        type: 'action',
        documentId: 'd_test0001',
        index: 3,
        action: addNode,
        ok: false,
        error: 'E_UNKNOWN_REF',
      },
      {
        type: 'document',
        op: 'create',
        document: { id: 'd_test0002', name: 'Payments', type: 'sequence' },
      },
      {
        type: 'question',
        questionId: 'q_1',
        text: 'Include SSO?',
        choices: ['Yes', 'No'],
        allowFreeText: true,
      },
      { type: 'answer', questionId: 'q_1', text: 'Yes' },
      { type: 'subagent', role: 'review', status: 'start' },
      {
        type: 'subagent',
        role: 'review',
        status: 'end',
        issues: [{ severity: 'info', message: 'Fine', ids: [] }],
        usage: { inputTokens: 100, outputTokens: 20, calls: 1 },
      },
      {
        type: 'changeSet',
        documentId: 'd_test0002',
        changeSet: { ...changeSet, diagramId: 'd_test0002' },
      },
      {
        type: 'budget',
        used: { inputTokens: 1000, outputTokens: 200, calls: 3, elapsedMs: 4500 },
        limit: { inputTokens: 0, outputTokens: 0, calls: 0, elapsedMs: 600000 },
        phase: 'wrapping-up',
      },
      {
        type: 'tool',
        name: 'findElements',
        durationMs: 2,
        call: 'c1',
        input: { query: 'login' },
        status: 'end',
        summary: '3 matches',
      },
      {
        type: 'done',
        runId: 'run_0123456789',
        outcome: 'budget-exhausted',
        summary: 'Delivered what was built',
        unresolved: ['Payment retries'],
      },
    ];
    for (const event of events) {
      const parsed = RunEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(parsed).toEqual(event);
    }
    const ok = (event: unknown) => RunEventSchema.safeParse(event).success;
    expect(ok({ type: 'done', runId: 'run_0123456789', outcome: 'gave-up' })).toBe(false);
    expect(ok({ type: 'question', questionId: 'q', text: '', allowFreeText: true })).toBe(false);
    expect(ok({ type: 'budget', used: {}, limit: {}, phase: 'normal' })).toBe(false);
  });

  it('validates action, change-set and plan payloads with the IR schemas', () => {
    const ok = (event: unknown) => RunEventSchema.safeParse(event).success;
    expect(
      ok({ type: 'action', index: 0, action: { type: 'addNode', label: 'Start' }, ok: true }),
    ).toBe(false);
    expect(
      ok({
        type: 'action',
        index: 0,
        action: { op: 'moveNode', id: 'n1', position: { x: 0, y: 0 } },
        ok: true,
      }),
    ).toBe(false);
    expect(ok({ type: 'changeSet', changeSet: { actions: [] } })).toBe(false);
    expect(ok({ type: 'changeSet', changeSet: { ...changeSet, runId: undefined } })).toBe(false);
    expect(ok({ type: 'validation', result: { errors: [], warnings: [] } })).toBe(false);
    const plan = {
      intent: 'generate',
      diagramType: 'flow',
      scope: { kind: 'all' },
      summary: 's',
      steps: [],
      layout: {},
      estimatedNodes: 1,
    };
    expect(ok({ type: 'plan', plan: { ...plan, diagramType: 'treemap' } })).toBe(true);
    expect(ok({ type: 'plan', plan: { ...plan, diagramType: 'Tree Map' } })).toBe(false);
    expect(ok({ type: 'plan', plan: { ...plan, layout: { direction: 'SIDEWAYS' } } })).toBe(false);
    expect(
      ok({ type: 'plan', plan: { ...plan, layout: { algorithm: 'radial', direction: 'DOWN' } } }),
    ).toBe(true);
  });

  it('lets the plan classify a diagram with a type outside the well-known vocabulary', () => {
    const plan = {
      intent: 'generate',
      diagramType: 'customer-journey',
      scope: { kind: 'all' },
      summary: 'Customer journey for onboarding',
      steps: [],
      layout: { algorithm: 'grid' },
      estimatedNodes: 12,
    };
    expect(RunEventSchema.safeParse({ type: 'plan', plan }).success).toBe(true);
  });

  it('rejects unknown event types and stages', () => {
    expect(RunEventSchema.safeParse({ type: 'progress', value: 1 }).success).toBe(false);
    expect(RunEventSchema.safeParse({ type: 'status', stage: 'daydreaming' }).success).toBe(false);
    expect(
      RunEventSchema.safeParse({ type: 'error', code: 'E_NOPE', message: '', recoverable: false })
        .success,
    ).toBe(false);
  });

  it('treats done and unrecoverable errors as terminal', () => {
    expect(isTerminalEvent({ type: 'done', runId: 'run_0123456789' })).toBe(true);
    expect(
      isTerminalEvent({ type: 'error', code: 'E_ABORTED', message: '', recoverable: false }),
    ).toBe(true);
    expect(
      isTerminalEvent({
        type: 'error',
        code: 'E_PROVIDER_RATE_LIMIT',
        message: '',
        recoverable: true,
      }),
    ).toBe(false);
    expect(isTerminalEvent({ type: 'status', stage: 'done' })).toBe(false);
  });
});
