import 'fake-indexeddb/auto';
import { createDefaultDeps, createMockAgent } from '@nivik/agent';
import { type ChangeSet, createDiagram } from '@nivik/ir';
import { DefaultMeasurer } from '@nivik/layout';
import type { RunEvent, RunRequestInput } from '@nivik/protocol';
import type { LiveSession, RendererPatch } from '@nivik/renderer-core';
import { DiagramRepository, NivikDB } from '@nivik/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AgentClient, AgentRuntimeUnavailableError, LocalAgentClient } from './agent-client';
import { createRunOrchestrator, type RunNotice } from './run-orchestrator';
import { createDiagramStore } from './stores/diagram-store';
import { useRunStore } from './stores/run-store';

const settings = { defaultModel: '', providers: [] };

const local = (paceMs = 0) =>
  new LocalAgentClient(createMockAgent(createDefaultDeps(), { paceMs }));

function fakeSession() {
  const applied: RendererPatch[] = [];
  const session = {
    apply: async (patch: RendererPatch) => {
      applied.push(patch);
    },
    replace: async () => {},
    getSelection: async () => [],
    setSelection: async () => {},
    highlight: () => {},
    clearHighlight: () => {},
    fit: async () => {},
    exportImage: async () => new Blob(),
    measurer: DefaultMeasurer,
    setReadOnly: () => {},
    destroy: () => {},
  } as unknown as LiveSession;
  return { session, applied };
}

describe('RunOrchestrator', () => {
  let diagram: ReturnType<typeof createDiagramStore>;
  let fake: ReturnType<typeof fakeSession>;
  let notices: RunNotice[];
  const current = () => {
    const d = diagram.getState().diagram;
    if (!d) throw new Error('no diagram');
    return d;
  };
  const labels = () => current().nodes.map((n) => n.label);

  beforeEach(async () => {
    const repo = new DiagramRepository(new NivikDB(`orch-${Math.random().toString(36).slice(2)}`), {
      now: () => 100,
    });
    fake = fakeSession();
    notices = [];
    diagram = createDiagramStore({ repo: () => repo, session: () => fake.session, now: () => 100 });
    await repo.create(createDiagram({ id: 'd1', name: 'x', type: 'generic' }));
    await diagram.getState().load('d1', { name: 'x' });
    useRunStore.setState({ current: null, recent: [], review: null, drawerOpen: false });
  });

  it('generate → user drag → AI edit → undo run, all in Node with the mock agent', async () => {
    const orchestrator = createRunOrchestrator({
      diagram,
      run: useRunStore,
      client: () => local(),
      onNotice: (n) => notices.push(n),
      now: () => 100,
    });

    const first = await orchestrator.start({
      prompt: 'Login -> Verify -> Done',
      renderer: 'excalidraw',
      settings,
    });
    expect(first.status).toBe('done');
    expect(first.changeSets.map((cs) => cs.origin)).toEqual(['ai', 'system']);
    expect(first.changeSets[0]?.runId).toBe(first.runId);
    expect(current().type).toBe('flow');
    expect(labels()).toEqual(['Login', 'Verify', 'Done']);
    expect(current().nodes.every((n) => n.position && n.size)).toBe(true);
    expect(current().edges).toHaveLength(2);
    expect(useRunStore.getState().current).toBeNull();
    expect(useRunStore.getState().review?.runId).toBe(first.runId);
    expect(useRunStore.getState().review?.affected.added).toHaveLength(5);
    const archived = useRunStore.getState().recent[0];
    expect(archived).toMatchObject({ runId: first.runId, status: 'done', applied: 1 });
    expect(archived?.validation?.ok).toBe(true);
    expect(archived?.plan?.diagramType).toBe('flow');
    expect(fake.applied).toHaveLength(1);
    expect(orchestrator.running).toBe(false);

    const login = current().nodes[0];
    if (!login) throw new Error('missing node');
    const drag: ChangeSet = {
      id: 'cs_drag',
      diagramId: 'd1',
      baseVersion: current().version,
      origin: 'user',
      createdAt: 101,
      actions: [{ op: 'moveNode', id: login.id, position: { x: 900, y: 40 } }],
    };
    expect((await diagram.getState().apply(drag)).ok).toBe(true);

    const second = await orchestrator.start({ prompt: 'Ship', renderer: 'excalidraw', settings });
    expect(second.status).toBe('done');
    expect(labels()).toEqual(['Login', 'Verify', 'Done', 'Ship']);
    expect(current().nodes[0]?.position).toEqual({ x: 900, y: 40 });
    expect(current().nodes[3]?.position).toBeDefined();
    expect(current().edges).toHaveLength(3);
    const ship = current().nodes[3];
    expect(fake.applied.at(-1)?.affected.added).toContain(ship?.id);
    expect(diagram.getState().history.undo.at(-1)?.group).toBe(second.runId);

    const undone = await diagram.getState().undoGroup(second.runId);
    expect(undone?.ok).toBe(true);
    expect(labels()).toEqual(['Login', 'Verify', 'Done']);
    expect(current().nodes[0]?.position).toEqual({ x: 900, y: 40 });
    expect(current().edges).toHaveLength(2);
    expect(notices.filter((n) => n.kind === 'done')).toHaveLength(2);
    expect(notices.some((n) => n.kind === 'error' || n.kind === 'conflict')).toBe(false);
  });

  it('falls back to the local agent when the runtime is unreachable before any event', async () => {
    const unreachable: AgentClient = {
      async *start(): AsyncGenerator<RunEvent> {
        if (Date.now() > 0) throw new AgentRuntimeUnavailableError('http://localhost:1');
        yield { type: 'status', stage: 'understanding' };
      },
    };
    const orchestrator = createRunOrchestrator({
      diagram,
      run: useRunStore,
      client: () => unreachable,
      fallback: () => local(),
      onNotice: (n) => notices.push(n),
    });
    const outcome = await orchestrator.start({
      prompt: 'A -> B',
      renderer: 'excalidraw',
      settings,
    });
    expect(outcome.status).toBe('done');
    expect(notices[0]).toEqual({ kind: 'offline' });
    expect(labels()).toEqual(['A', 'B']);
  });

  it('reports a failure (no fallback) when the runtime dies mid-stream', async () => {
    const flaky: AgentClient = {
      async *start(request: RunRequestInput): AsyncGenerator<RunEvent> {
        yield { type: 'status', stage: 'understanding' };
        throw new Error(`stream closed for ${request.runId}`);
      },
    };
    const orchestrator = createRunOrchestrator({
      diagram,
      run: useRunStore,
      client: () => flaky,
      fallback: () => local(),
      onNotice: (n) => notices.push(n),
    });
    const outcome = await orchestrator.start({
      prompt: 'A -> B',
      renderer: 'excalidraw',
      settings,
    });
    expect(outcome.status).toBe('failed');
    expect(notices).toEqual([{ kind: 'error', message: `stream closed for ${outcome.runId}` }]);
    expect(useRunStore.getState().recent[0]?.status).toBe('failed');
    expect(current().nodes).toHaveLength(0);
  });

  it('abort ends the run as aborted and applies nothing', async () => {
    const orchestrator = createRunOrchestrator({
      diagram,
      run: useRunStore,
      client: () => local(40),
      onNotice: (n) => notices.push(n),
    });
    const pending = orchestrator.start({ prompt: 'A -> B -> C', renderer: 'excalidraw', settings });
    expect(orchestrator.running).toBe(true);
    expect(await orchestrator.start({ prompt: 'again', renderer: 'excalidraw', settings })).toEqual(
      {
        runId: '',
        status: 'noop',
        changeSets: [],
      },
    );
    orchestrator.abort();
    const outcome = await pending;
    expect(outcome.status).toBe('aborted');
    expect(notices).toEqual([{ kind: 'aborted' }]);
    expect(current().nodes).toHaveLength(0);
    expect(useRunStore.getState().recent[0]?.status).toBe('aborted');
    expect(useRunStore.getState().review).toBeNull();
  });

  it('a stale AI change set that overlaps a user edit is reported as a conflict', async () => {
    const orchestrator = createRunOrchestrator({
      diagram,
      run: useRunStore,
      client: () => local(),
      onNotice: (n) => notices.push(n),
    });
    await orchestrator.start({ prompt: 'A -> B', renderer: 'excalidraw', settings });
    const b = current().nodes[1];
    if (!b) throw new Error('missing node');

    // A client that edits "B" but was built against the version before the user's drag lands.
    const stale: AgentClient = {
      async *start(request: RunRequestInput): AsyncGenerator<RunEvent> {
        yield { type: 'status', stage: 'building' };
        const drag: ChangeSet = {
          id: 'cs_drag',
          diagramId: 'd1',
          baseVersion: request.diagram.version,
          origin: 'user',
          createdAt: 102,
          actions: [{ op: 'moveNode', id: b.id, position: { x: 5, y: 5 } }],
        };
        await diagram.getState().apply(drag);
        yield {
          type: 'changeSet',
          changeSet: {
            id: 'cs_stale',
            diagramId: 'd1',
            baseVersion: request.diagram.version,
            origin: 'ai',
            runId: request.runId ?? 'run_x',
            createdAt: 103,
            actions: [{ op: 'updateNode', id: b.id, patch: { label: 'B2' } }],
          },
        };
        yield { type: 'done', runId: request.runId ?? 'run_x' };
      },
    };
    const conflicted = createRunOrchestrator({
      diagram,
      run: useRunStore,
      client: () => stale,
      onNotice: (n) => notices.push(n),
    });
    notices = [];
    const outcome = await conflicted.start({ prompt: 'rename', renderer: 'excalidraw', settings });
    expect(outcome.status).toBe('failed');
    expect(notices).toEqual([{ kind: 'conflict', ids: [b.id] }]);
    expect(current().nodes[1]?.label).toBe('B');
    expect(current().nodes[1]?.position).toEqual({ x: 5, y: 5 });
    expect(useRunStore.getState().review).toBeNull();
  });
});
