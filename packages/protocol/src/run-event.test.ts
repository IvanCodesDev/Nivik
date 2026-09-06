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
    expect(RunEventSchema.safeParse({ type: 'status', stage: 'thinking' }).success).toBe(false);
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
