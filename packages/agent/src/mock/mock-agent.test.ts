import { applyChangeSet, createDiagram, type Diagram } from '@nivik/ir';
import { isTerminalEvent, type RunEvent, RunEventSchema, RunRequestSchema } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { createDefaultDeps } from '../deps';
import { createMockAgent } from './mock-agent';
import { splitSteps } from './steps';

const NOW = 1_700_000_000_000;
const deps = createDefaultDeps({
  sleep: async () => {},
  newRunId: () => 'run_mock_00001',
  now: () => NOW,
});

/** A fresh canvas document: `generic` until the agent's plan classifies it. */
const emptyDiagram = () =>
  createDiagram({ name: 'Mock', type: 'generic', id: 'd_mock0001', now: NOW });

function request(prompt: string, extra: Record<string, unknown> = {}) {
  return RunRequestSchema.parse({
    diagram: emptyDiagram(),
    prompt,
    hints: { renderer: 'excalidraw' },
    ...extra,
  });
}

async function collect(iterable: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

const changeSetOf = (events: RunEvent[]) => {
  const event = events.find((e) => e.type === 'changeSet');
  if (event?.type !== 'changeSet') throw new Error('no changeSet event');
  return event.changeSet;
};

const applyTo = (diagram: Diagram, events: RunEvent[]) => {
  const result = applyChangeSet(diagram, changeSetOf(events));
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.diagram;
};

describe('splitSteps', () => {
  it('splits on arrows, newlines, semicolons and "then"', () => {
    expect(splitSteps('Sign up → Verify email -> Onboard')).toEqual([
      'Sign up',
      'Verify email',
      'Onboard',
    ]);
    expect(splitSteps('A\nB; C then D.')).toEqual(['A', 'B', 'C', 'D']);
  });

  it('keeps a plain sentence as one step and caps at eight', () => {
    expect(splitSteps('Draw a login flow')).toEqual(['Draw a login flow']);
    expect(splitSteps(Array.from({ length: 12 }, (_, i) => `S${i}`).join(' -> '))).toHaveLength(8);
  });
});

describe('createMockAgent', () => {
  it('emits a well-formed run: stages in order, one action per step, one terminal event', async () => {
    const agent = createMockAgent(deps);
    const events = await collect(agent.run(request('Sign up → Verify email → Onboard')));

    for (const event of events) expect(RunEventSchema.safeParse(event).success).toBe(true);

    const stages = events
      .filter((e) => e.type === 'status')
      .map((e) => e.type === 'status' && e.stage);
    expect(stages).toEqual([
      'understanding',
      'planning',
      'building',
      'connecting',
      'validating',
      'done',
    ]);

    const actions = events.filter((e) => e.type === 'action');
    expect(actions.map((e) => e.type === 'action' && e.action.op)).toEqual([
      'setDiagram',
      'addNode',
      'addNode',
      'addEdge',
      'addNode',
      'addEdge',
    ]);

    const plan = events.find((e) => e.type === 'plan');
    expect(plan?.type === 'plan' && plan.plan).toMatchObject({
      intent: 'generate',
      diagramType: 'flow',
      estimatedNodes: 3,
    });

    expect(changeSetOf(events)).toMatchObject({
      id: 'cs_run_mock_00001',
      diagramId: 'd_mock0001',
      runId: 'run_mock_00001',
      origin: 'ai',
      baseVersion: 1,
      createdAt: NOW,
    });

    const usage = events.find((e) => e.type === 'usage');
    expect(usage?.type === 'usage' && usage.usage.calls).toBe(2);

    expect(events.filter(isTerminalEvent)).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'done', runId: 'run_mock_00001' });
  });

  it('produces a change set that applies cleanly and validates as a linear flow', async () => {
    const agent = createMockAgent(deps);
    const events = await collect(agent.run(request('Sign up → Verify email → Onboard')));
    const next = applyTo(emptyDiagram(), events);

    // The plan's classification is carried into the document by the same change set.
    expect(next.type).toBe('flow');
    expect(next.nodes.map((n) => [n.id, n.label, n.type])).toEqual([
      ['n1', 'Sign up', 'rounded'],
      ['n2', 'Verify email', 'rounded'],
      ['n3', 'Onboard', 'rounded'],
    ]);
    expect(next.edges.map((e) => [e.id, e.source, e.target])).toEqual([
      ['e1', 'n1', 'n2'],
      ['e2', 'n2', 'n3'],
    ]);

    const validation = events.find((e) => e.type === 'validation');
    expect(validation?.type === 'validation' && validation.result).toEqual({
      ok: true,
      errors: [],
      warnings: [],
    });
  });

  it('honours a client-supplied runId and extends an existing diagram without id collisions', async () => {
    const existing: Diagram = {
      ...emptyDiagram(),
      type: 'architecture',
      version: 4,
      nodes: [
        {
          id: 'n1',
          type: 'rounded',
          label: 'Existing',
          parent: null,
          pinned: false,
          meta: { createdBy: 'user', createdAt: NOW, updatedAt: NOW, rev: 0 },
        },
      ],
    };
    const agent = createMockAgent(deps);
    const events = await collect(
      agent.run(
        request('Add a retry step', {
          runId: 'run_client_007',
          diagram: existing,
          hints: { renderer: 'drawio' },
        }),
      ),
    );
    // An edit keeps the diagram's classification, so no `setDiagram` is emitted.
    const plan = events.find((e) => e.type === 'plan');
    expect(plan?.type === 'plan' && plan.plan).toMatchObject({
      intent: 'edit',
      diagramType: 'architecture',
    });
    expect(changeSetOf(events).actions.map((a) => a.op)).toEqual(['addNode', 'addEdge']);
    expect(changeSetOf(events).baseVersion).toBe(4);

    const next = applyTo(existing, events);
    expect(next.type).toBe('architecture');
    expect(next.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(next.edges.map((e) => [e.source, e.target])).toEqual([['n1', 'n2']]);
    expect(events.at(-1)).toEqual({ type: 'done', runId: 'run_client_007' });
  });

  it('stops with E_ABORTED when cancelled while building', async () => {
    const controller = new AbortController();
    const agent = createMockAgent(createDefaultDeps(), { paceMs: 50 });
    const events: RunEvent[] = [];
    for await (const event of agent.run(request('A → B → C → D'), { signal: controller.signal })) {
      events.push(event);
      if (event.type === 'status' && event.stage === 'building') controller.abort();
    }
    expect(events.some((e) => e.type === 'changeSet')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'E_ABORTED', recoverable: false });
  });

  it('reports E_BUDGET_EXCEEDED when the request budget is too small for the prompt', async () => {
    const agent = createMockAgent(deps);
    const events = await collect(
      agent.run(request('x'.repeat(4_000), { settings: { maxTokens: 256 } })),
    );
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'E_BUDGET_EXCEEDED' });
  });
});
