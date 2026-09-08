import { createDefaultDeps, createMockAgent } from '@nivik/agent';
import { createDiagram } from '@nivik/ir';
import type { RunEvent } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { LocalAgentClient } from './agent-client';
import { buildRunRequest } from './run-request';

const request = (prompt: string) =>
  buildRunRequest({
    diagram: createDiagram({ id: 'd_local', name: 'x', type: 'generic' }),
    prompt,
    renderer: 'excalidraw',
    settings: { defaultModel: '', providers: [] },
  });

const collect = async (events: AsyncIterable<RunEvent>) => {
  const out: RunEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};

describe('LocalAgentClient', () => {
  it('streams the mock agent in-process: plan, actions, one change set, validation, done', async () => {
    const client = new LocalAgentClient(createMockAgent(createDefaultDeps(), { paceMs: 0 }));
    const events = await collect(client.start(request('Login -> Verify -> Done')));
    expect(events[0]).toEqual({ type: 'status', stage: 'understanding' });
    expect(events.filter((e) => e.type === 'changeSet')).toHaveLength(1);
    const changeSet = events.find((e) => e.type === 'changeSet');
    if (changeSet?.type !== 'changeSet') throw new Error('expected a change set');
    expect(changeSet.changeSet.diagramId).toBe('d_local');
    expect(changeSet.changeSet.baseVersion).toBe(1);
    expect(changeSet.changeSet.actions.filter((a) => a.op === 'addNode')).toHaveLength(3);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('keeps a caller-supplied runId and ends with E_ABORTED when the signal fires', async () => {
    const client = new LocalAgentClient(createMockAgent(createDefaultDeps(), { paceMs: 30 }));
    const controller = new AbortController();
    const events: RunEvent[] = [];
    for await (const event of client.start(
      { ...request('A -> B -> C'), runId: 'run_fixed' },
      {
        signal: controller.signal,
      },
    )) {
      events.push(event);
      if (event.type === 'status' && event.stage === 'building') controller.abort();
    }
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'E_ABORTED', recoverable: false });
    expect(events.some((e) => e.type === 'changeSet')).toBe(false);
    expect(events.some((e) => e.type === 'done' && e.runId === 'run_fixed')).toBe(false);
  });
});
