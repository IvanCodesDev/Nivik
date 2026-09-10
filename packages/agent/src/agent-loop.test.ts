import { orderPlatformLaidOut } from '@nivik/ir/testing';
import { type RunEvent, RunRequestSchema } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { createLoopAgent } from './agent-loop';
import { createDefaultDeps } from './deps';
import { processMetrics } from './harness/metrics';
import type { Transcript } from './harness/recorder';
import { createReplayModel } from './harness/replay';
import { createMockModel, type MockTurn } from './providers/mock';

const diagram = () => orderPlatformLaidOut();

const request = (over: Partial<Parameters<typeof RunRequestSchema.parse>[0]> = {}) =>
  RunRequestSchema.parse({
    runId: 'run_looptest01',
    diagram: diagram(),
    prompt: 'Add a payments service after the order service',
    hints: { renderer: 'excalidraw' },
    ...over,
  });

function deps(turns: MockTurn[], now = () => 5_000) {
  let ids = 0;
  return createDefaultDeps({
    now,
    newRunId: () => `run_${String(++ids).padStart(8, '0')}`,
    model: () => createMockModel(turns),
  });
}

async function collect(
  events: AsyncIterable<RunEvent>,
  onQuestion?: (q: RunEvent & { type: 'question' }) => void,
) {
  const out: RunEvent[] = [];
  for await (const event of events) {
    out.push(event);
    if (event.type === 'question') onQuestion?.(event);
  }
  return out;
}

const plan = {
  intent: 'edit',
  diagramType: 'architecture',
  scope: { kind: 'all' },
  summary: 'Add a payments service',
  steps: ['Add the node', 'Connect it'],
  layout: {},
  estimatedNodes: 9,
};

describe('createLoopAgent (D14′ end to end on a scripted model)', () => {
  it('plans, applies with one bad reference, fixes it, asks, replies and finishes with a change set', async () => {
    const source = diagram();
    const orderNode = source.nodes.find((n) => /order/i.test(n.label)) ?? source.nodes[0];
    if (!orderNode) throw new Error('fixture');
    const turns: MockTurn[] = [
      { toolCalls: [{ name: 'setPlan', input: plan }] },
      {
        toolCalls: [
          {
            name: 'applyActions',
            input: {
              actions: [
                { op: 'addNode', node: { id: 'payments', type: 'rounded', label: 'Payments' } },
                {
                  op: 'addEdge',
                  edge: { id: 'e-pay', type: 'flow', source: orderNode.id, target: 'paymnts' },
                },
              ],
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: 'applyActions',
            input: {
              actions: [
                {
                  op: 'addEdge',
                  edge: { id: 'e-pay', type: 'flow', source: orderNode.id, target: 'payments' },
                },
              ],
            },
          },
        ],
      },
      {
        toolCalls: [
          { name: 'ask', input: { text: 'Should payments retry?', choices: ['Yes', 'No'] } },
        ],
      },
      {
        text: 'Added Payments after Order, with retries.',
        toolCalls: [
          { name: 'finish', input: { summary: 'Added a Payments service connected to Order.' } },
        ],
      },
    ];
    const agent = createLoopAgent(deps(turns));
    const events = await collect(agent.run(request()), (q) => {
      expect(agent.pendingQuestions()).toEqual([
        { questionId: q.questionId, text: 'Should payments retry?' },
      ]);
      expect(agent.answer(q.questionId, 'Yes')).toBe(true);
    });

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('status');
    expect(types).toContain('plan');
    expect(types).toContain('question');
    expect(types).toContain('answer');
    expect(types.at(-1)).toBe('done');

    const actions = events.filter((e) => e.type === 'action');
    expect(actions.map((a) => a.ok)).toEqual([true, false, true]);
    expect(actions[1]).toMatchObject({ error: 'E_UNKNOWN_REF', documentId: source.id });

    const applyEnds = events.flatMap((e) =>
      e.type === 'tool' && e.name === 'applyActions' && e.status === 'end' ? [e.summary] : [],
    );
    expect(applyEnds).toEqual(['1 accepted, 1 rejected', '1 accepted, 0 rejected']);

    const changeSets = events.filter((e) => e.type === 'changeSet');
    expect(changeSets).toHaveLength(1);
    const cs = changeSets[0]?.changeSet;
    expect(cs).toMatchObject({
      diagramId: source.id,
      baseVersion: source.version,
      origin: 'ai',
      runId: 'run_looptest01',
    });
    expect(cs?.actions.map((a) => a.op)).toEqual(['addNode', 'addEdge']);
    expect(cs?.summary).toBe('Added a Payments service connected to Order.');

    expect(events.at(-1)).toEqual({
      type: 'done',
      runId: 'run_looptest01',
      outcome: 'finished',
      summary: 'Added a Payments service connected to Order.',
      unresolved: [],
    });
    const replies = events
      .filter((e) => e.type === 'reply')
      .map((r) => r.text)
      .join('');
    expect(replies).toBe('Added Payments after Order, with retries.');
    const stages = events.filter((e) => e.type === 'status').map((s) => s.stage);
    expect(stages).toEqual(['thinking', 'thinking', 'building', 'building', 'asking', 'done']);
    expect(agent.pendingQuestions()).toEqual([]);
  });

  it('prepends the plan decision when it differs from the document', async () => {
    const turns: MockTurn[] = [
      {
        toolCalls: [
          {
            name: 'setPlan',
            input: { ...plan, intent: 'convert', diagramType: 'c4', layout: { direction: 'DOWN' } },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: 'applyActions',
            input: { actions: [{ op: 'setDiagram', patch: { description: 'C4 view' } }] },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: 'finish',
            input: { summary: 'Converted to C4', unresolved: ['Containers not yet split'] },
          },
        ],
      },
    ];
    const events = await collect(createLoopAgent(deps(turns)).run(request()));
    const cs = events.find((e) => e.type === 'changeSet')?.changeSet;
    expect(cs?.actions[0]).toEqual({
      op: 'setDiagram',
      patch: { type: 'c4', layout: { direction: 'DOWN' } },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'finished',
      unresolved: ['Containers not yet split'],
    });
  });

  it('reports no-changes when the model only explains', async () => {
    const turns: MockTurn[] = [
      {
        text: 'This diagram already has a payments service.',
        toolCalls: [{ name: 'finish', input: { summary: 'Nothing to add' } }],
      },
    ];
    const events = await collect(createLoopAgent(deps(turns)).run(request()));
    expect(events.some((e) => e.type === 'changeSet')).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'no-changes',
      summary: 'Nothing to add',
    });
  });

  it('finishes for the model when the budget runs out, delivering what was built', async () => {
    const turns: MockTurn[] = [
      { toolCalls: [{ name: 'setPlan', input: plan }], usage: { input: 70, output: 20 } },
      {
        toolCalls: [
          {
            name: 'applyActions',
            input: {
              actions: [
                { op: 'addNode', node: { id: 'payments', type: 'box', label: 'Payments' } },
              ],
            },
          },
        ],
        usage: { input: 1, output: 1 },
      },
      {
        toolCalls: [{ name: 'findElements', input: { query: 'order' } }],
        usage: { input: 1, output: 1 },
      },
      {
        toolCalls: [{ name: 'findElements', input: { query: 'order' } }],
        usage: { input: 1, output: 1 },
      },
      {
        toolCalls: [{ name: 'findElements', input: { query: 'order' } }],
        usage: { input: 1, output: 1 },
      },
    ];
    const events = await collect(
      createLoopAgent(deps(turns)).run(request({ budget: { maxTokens: 100, maxMs: 0 } })),
    );
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: 'done',
      outcome: 'budget-exhausted',
      unresolved: ['Add the node', 'Connect it'],
    });
    expect(events.filter((e) => e.type === 'changeSet')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'budget').map((b) => b.phase)).toEqual([
      'wrapping-up',
      'wrapping-up',
      'exhausted',
    ]);
  });

  it('ends with clarify-pending when cancelled while waiting for an answer', async () => {
    const turns: MockTurn[] = [{ toolCalls: [{ name: 'ask', input: { text: 'Which region?' } }] }];
    const controller = new AbortController();
    const agent = createLoopAgent(deps(turns));
    const events: RunEvent[] = [];
    for await (const event of agent.run(request(), { signal: controller.signal })) {
      events.push(event);
      if (event.type === 'question') controller.abort();
    }
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'clarify-pending' });
  });

  it('surfaces a missing model and provider failures as unrecoverable errors', async () => {
    const noModel = createLoopAgent(createDefaultDeps({ now: () => 1 }));
    const events = await collect(noModel.run(request()));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'E_INTERNAL', recoverable: false });

    const failing = createLoopAgent(deps([{ error: new Error('boom') }]));
    const failed = await collect(failing.run(request()));
    expect(failed.at(-1)).toMatchObject({ type: 'error', recoverable: false });
  });

  it('replays a recorded run into the same events', async () => {
    const turns: MockTurn[] = [
      { toolCalls: [{ name: 'setPlan', input: plan }] },
      {
        toolCalls: [
          {
            name: 'applyActions',
            input: {
              actions: [
                { op: 'addNode', node: { id: 'payments', type: 'box', label: 'Payments' } },
              ],
            },
          },
        ],
      },
      { text: 'Done.', toolCalls: [{ name: 'finish', input: { summary: 'Added Payments' } }] },
    ];
    let transcript: Transcript | null = null;
    const first = await collect(
      createLoopAgent(deps(turns), {
        onTranscript: (_id, t) => {
          transcript = t;
        },
      }).run(request()),
    );
    if (!transcript) throw new Error('no transcript');
    const replayDeps = createDefaultDeps({
      now: () => 5_000,
      newRunId: () => 'run_00000001',
      model: () => createReplayModel(transcript as Transcript),
    });
    const second = await collect(createLoopAgent(replayDeps).run(request()));
    const strip = (events: RunEvent[]) =>
      events.map((e) => {
        if (e.type === 'tool') return { ...e, durationMs: 0 };
        if (e.type === 'changeSet') return { ...e, changeSet: { ...e.changeSet, id: 'cs' } };
        return e;
      });
    expect(strip(second)).toEqual(strip(first));
    const metrics = processMetrics(transcript, first);
    expect(metrics).toMatchObject({
      modelCalls: 3,
      applyRounds: 1,
      questions: 0,
      outcome: 'finished',
    });
  });
});
