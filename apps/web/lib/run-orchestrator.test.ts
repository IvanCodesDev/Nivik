import 'fake-indexeddb/auto';
import { createDefaultDeps, createLoopAgent, createMockAgent } from '@nivik/agent';
import { createMockModel, type MockTurn } from '@nivik/agent/providers';
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
  let repo: DiagramRepository;
  const current = () => {
    const d = diagram.getState().diagram;
    if (!d) throw new Error('no diagram');
    return d;
  };
  const labels = () => current().nodes.map((n) => n.label);

  beforeEach(async () => {
    repo = new DiagramRepository(new NivikDB(`orch-${Math.random().toString(36).slice(2)}`), {
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
        documents: [],
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

  describe('with the tool loop (D14′)', () => {
    const plan = {
      intent: 'generate',
      diagramType: 'flow',
      scope: { kind: 'all' },
      summary: 'Sketch the flow and a side board',
      steps: ['Flow', 'Board'],
      layout: { algorithm: 'layered', direction: 'RIGHT' },
      estimatedNodes: 4,
    };
    const loopClient = (turns: MockTurn[], requests: RunRequestInput[] = []): AgentClient => {
      const inner = new LocalAgentClient(
        createLoopAgent(
          createDefaultDeps({
            now: () => 100,
            newRunId: () => 'run_00000001',
            model: () => createMockModel(turns),
          }),
        ),
      );
      return {
        start(request, options) {
          requests.push(request);
          return inner.start(request, options);
        },
      };
    };

    it('persists side documents, lists them, and remembers the turn for the next request', async () => {
      const requests: RunRequestInput[] = [];
      const client = loopClient(
        [
          { toolCalls: [{ name: 'setPlan', input: plan }] },
          {
            toolCalls: [
              {
                name: 'applyActions',
                input: {
                  actions: [
                    { op: 'addNode', node: { id: 'login', type: 'box', label: 'Login' } },
                    { op: 'addNode', node: { id: 'home', type: 'box', label: 'Home' } },
                    {
                      op: 'addEdge',
                      edge: { id: 'e1', type: 'flow', source: 'login', target: 'home' },
                    },
                  ],
                },
              },
            ],
          },
          {
            toolCalls: [
              {
                name: 'createDiagram',
                input: { name: 'Release board', type: 'kanban', layout: { algorithm: 'grid' } },
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
                      op: 'addGroup',
                      group: { id: 'todo', label: 'To do', role: 'lane', cell: { col: 0, row: 0 } },
                    },
                    {
                      op: 'addNode',
                      node: {
                        id: 'card-1',
                        type: 'rounded',
                        label: 'Ship login',
                        cell: { col: 0, row: 0 },
                      },
                    },
                    { op: 'setParent', ids: ['card-1'], parent: 'todo' },
                  ],
                },
              },
            ],
          },
          {
            text: 'Sketched the login flow and started a release board.',
            toolCalls: [{ name: 'finish', input: { summary: 'Login flow plus a release board.' } }],
          },
        ],
        requests,
      );
      const orchestrator = createRunOrchestrator({
        diagram,
        run: useRunStore,
        client: () => client,
        repo: () => repo,
        onNotice: (n) => notices.push(n),
        now: () => 100,
      });

      const outcome = await orchestrator.start({
        prompt: 'Login flow',
        renderer: 'excalidraw',
        settings,
      });
      expect(outcome.status).toBe('done');
      expect(labels()).toEqual(['Login', 'Home']);
      expect(current().type).toBe('flow');
      expect(outcome.documents).toHaveLength(1);
      const boardId = outcome.documents[0]?.id ?? '';
      const board = await repo.require(boardId);
      expect(board.name).toBe('Release board');
      expect(board.ir.type).toBe('kanban');
      expect(board.ir.layout.algorithm).toBe('grid');
      expect(board.ir.nodes.map((n) => n.label)).toEqual(['Ship login']);
      expect(board.ir.nodes[0]?.parent).toBe('todo');
      expect(board.ir.nodes.every((n) => n.position && n.size)).toBe(true);
      expect((await repo.listVersions(boardId)).map((v) => v.reason)).toEqual(['import', 'ai-run']);
      expect(
        outcome.changeSets.filter((cs) => cs.diagramId === boardId).map((cs) => cs.origin),
      ).toEqual(['ai', 'system']);
      expect(notices.map((n) => n.kind)).toEqual(['done', 'documents']);
      // Undo covers the canvas only: the board stays in the library.
      expect(diagram.getState().history.undo.every((e) => e.forward.diagramId === 'd1')).toBe(true);

      const archived = useRunStore.getState().recent[0];
      expect(archived?.documents.map((d) => d.name)).toEqual(['Release board']);
      expect(archived?.replies).toEqual(['Sketched the login flow and started a release board.']);
      expect(archived?.outcome).toBe('finished');
      expect(archived?.trace.map((t) => t.name)).toEqual([
        'setPlan',
        'applyActions',
        'createDiagram',
        'applyActions',
        'finish',
      ]);
      expect(archived?.trace.every((t) => t.status === 'end')).toBe(true);

      expect(requests[0]?.session).toEqual({ recentTurns: [], summary: null });
      expect(requests[0]?.capabilities).toEqual({ runtimeTools: false, ask: false });
      const session = await repo.getSession('d1');
      expect(session?.turns).toHaveLength(1);
      expect(session?.turns[0]).toMatchObject({
        runId: outcome.runId,
        user: 'Login flow',
        agent: {
          replies: [
            'Sketched the login flow and started a release board.',
            'Login flow plus a release board.',
          ],
          outcome: 'finished',
        },
      });
      expect(session?.turns[0]?.agent.changes.map((c) => c.documentId)).toEqual(['d1', boardId]);
      expect(session?.turns[0]?.agent.changes[0]?.counts).toEqual({
        setDiagram: 1,
        addNode: 2,
        addEdge: 1,
      });

      await orchestrator.start({ prompt: 'Add logout', renderer: 'excalidraw', settings });
      expect(requests[1]?.session?.recentTurns?.map((turn) => turn.user)).toEqual(['Login flow']);
      expect((await repo.getSession('d1'))?.turns).toHaveLength(2);
    });

    it('reports a budget-exhausted run as done-with-notice and remembers the outcome', async () => {
      const client = loopClient([
        { toolCalls: [{ name: 'setPlan', input: plan }], usage: { input: 900, output: 100 } },
        {
          toolCalls: [
            {
              name: 'applyActions',
              input: { actions: [{ op: 'addNode', node: { id: 'a', type: 'box', label: 'A' } }] },
            },
          ],
          usage: { input: 900, output: 100 },
        },
        { text: 'still going', usage: { input: 900, output: 100 } },
      ]);
      const orchestrator = createRunOrchestrator({
        diagram,
        run: useRunStore,
        client: () => client,
        repo: () => repo,
        budget: () => ({ maxTokens: 2_000, maxMs: 0 }),
        onNotice: (n) => notices.push(n),
        now: () => 100,
      });
      const outcome = await orchestrator.start({ prompt: 'A', renderer: 'excalidraw', settings });
      expect(outcome.status).toBe('done');
      expect(labels()).toEqual(['A']);
      expect(notices[0]).toMatchObject({ kind: 'budget-exhausted', unresolved: ['Flow', 'Board'] });
      expect((await repo.getSession('d1'))?.turns[0]?.agent.outcome).toBe('budget-exhausted');
    });
  });
});
