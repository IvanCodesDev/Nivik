import { isTerminalEvent, type RunEvent, RunEventSchema, RunRequestSchema } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { createDefaultDeps } from '../deps';
import { createMockAgent } from './mock-agent';
import { splitSteps } from './steps';

const deps = createDefaultDeps({ sleep: async () => {}, newRunId: () => 'run_mock_00001' });

function request(prompt: string, extra: Record<string, unknown> = {}) {
  return RunRequestSchema.parse({
    diagram: {},
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
    expect(actions.map((e) => e.type === 'action' && e.action.type)).toEqual([
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

    const changeSet = events.find((e) => e.type === 'changeSet');
    expect(changeSet?.type === 'changeSet' && changeSet.changeSet).toMatchObject({
      runId: 'run_mock_00001',
      origin: 'ai',
      baseVersion: 0,
    });

    const usage = events.find((e) => e.type === 'usage');
    expect(usage?.type === 'usage' && usage.usage.calls).toBe(2);

    expect(events.filter(isTerminalEvent)).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'done', runId: 'run_mock_00001' });
  });

  it('honours a client-supplied runId and detects edits of an existing diagram', async () => {
    const agent = createMockAgent(deps);
    const events = await collect(
      agent.run(
        request('Add a retry step', {
          runId: 'run_client_007',
          diagram: { version: 4, nodes: [{ id: 'n1' }] },
          hints: { renderer: 'drawio', diagramType: 'sequence' },
        }),
      ),
    );
    const plan = events.find((e) => e.type === 'plan');
    expect(plan?.type === 'plan' && plan.plan).toMatchObject({
      intent: 'edit',
      diagramType: 'sequence',
    });
    const changeSet = events.find((e) => e.type === 'changeSet');
    expect(changeSet?.type === 'changeSet' && changeSet.changeSet.baseVersion).toBe(4);
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
