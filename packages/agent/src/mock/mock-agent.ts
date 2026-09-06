import {
  type AgentAction,
  applyChangeSet,
  type ChangeSet,
  type Diagram,
  type Id,
  type ValidationResult,
  validateDiagram,
} from '@nivik/ir';
import type { Plan, RunEvent, RunRequest } from '@nivik/protocol';
import type { Agent, RunOptions } from '../agent';
import { type AgentDeps, createDefaultDeps } from '../deps';
import { createRunContext } from '../harness/context';
import { runPipeline, runStage } from '../harness/pipeline';
import type { Stage } from '../harness/stage';
import { splitSteps } from './steps';

export interface MockAgentOptions {
  /** Delay between scripted events so the UI's stage transitions are visible; 0 in tests. */
  paceMs?: number;
}

const NO_RETRY = { attempts: 0, on: [] } as const;

/**
 * Scripted agent: no model calls, deterministic output derived from the prompt. It exercises the
 * real harness (stages, budget, cancellation, terminal events) and emits a genuine Change Set so
 * hosts and the UI can be built and tested before the provider-backed stages land (tasks 1.5–1.7).
 */
export function createMockAgent(
  deps: AgentDeps = createDefaultDeps(),
  options: MockAgentOptions = {},
): Agent {
  const paceMs = options.paceMs ?? 0;

  const planStage: Stage<RunRequest, Plan> = {
    name: 'plan',
    budget: { maxTokens: 4_000, maxCalls: 1, timeoutMs: 20_000 },
    retry: NO_RETRY,
    async *run(ctx, request) {
      yield { type: 'status', stage: 'understanding' };
      await ctx.sleep(paceMs);
      ctx.budget.addCall();
      ctx.budget.addTokens({ inputTokens: estimateTokens(request.prompt), outputTokens: 60 });

      const steps = splitSteps(request.prompt);
      const plan: Plan = {
        intent: request.diagram.nodes.length > 0 ? 'edit' : 'generate',
        diagramType: request.hints.diagramType ?? request.diagram.type,
        scope: request.selection.length > 0 ? { kind: 'selection' } : { kind: 'all' },
        summary: `Sketch ${steps.length} step${steps.length === 1 ? '' : 's'} from your prompt`,
        steps: steps.map((step) => `Add "${step}"`),
        layout: { algorithm: 'layered', direction: 'RIGHT' },
        estimatedNodes: steps.length,
      };
      yield { type: 'plan', plan };
      yield { type: 'status', stage: 'planning' };
      return plan;
    },
  };

  const buildStage: Stage<{ request: RunRequest; plan: Plan }, ChangeSet> = {
    name: 'build',
    budget: { maxTokens: 16_000, maxCalls: 1, timeoutMs: 60_000 },
    retry: NO_RETRY,
    async *run(ctx, { request, plan }) {
      yield { type: 'status', stage: 'building' };
      ctx.budget.addCall();
      const steps = splitSteps(request.prompt);
      const ids = freshIds(request.diagram);
      const actions: AgentAction[] = [];
      let index = 0;
      // Editing an existing diagram continues from its last node.
      let previous: Id | null = request.diagram.nodes.at(-1)?.id ?? null;

      for (const label of steps) {
        await ctx.sleep(paceMs);
        const id = ids.next('n');
        const addNode: AgentAction = {
          op: 'addNode',
          node: { id, type: 'rounded', label, parent: null },
        };
        actions.push(addNode);
        ctx.budget.addTokens({ inputTokens: 0, outputTokens: estimateTokens(label) + 8 });
        yield { type: 'action', index: index++, action: addNode, ok: true };
        if (previous) {
          const addEdge: AgentAction = {
            op: 'addEdge',
            edge: {
              id: ids.next('e'),
              source: previous,
              target: id,
              type: 'flow',
              direction: 'forward',
              sourceSide: 'auto',
              targetSide: 'auto',
            },
          };
          actions.push(addEdge);
          yield { type: 'action', index: index++, action: addEdge, ok: true };
        }
        previous = id;
      }

      const changeSet: ChangeSet = {
        id: `cs_${ctx.runId}`,
        diagramId: request.diagram.id,
        baseVersion: request.diagram.version,
        origin: 'ai',
        runId: ctx.runId,
        actions,
        summary: plan.summary,
        createdAt: deps.now(),
      };
      yield { type: 'changeSet', changeSet };
      return changeSet;
    },
  };

  return {
    run(request: RunRequest, runOptions: RunOptions = {}): AsyncGenerator<RunEvent> {
      const ctx = createRunContext({
        runId: request.runId ?? deps.newRunId(),
        deps,
        limits: {
          maxTokens: request.settings.maxTokens,
          maxCalls: 4,
          timeoutMs: request.settings.timeoutMs,
        },
        signal: runOptions.signal,
      });

      return runPipeline(ctx, async function* program() {
        const plan = yield* runStage(ctx, planStage, request);
        const changeSet = yield* runStage(ctx, buildStage, { request, plan });
        // Connecting (layout + render) belongs to the orchestrator; the core only announces it.
        yield { type: 'status', stage: 'connecting' };
        await deps.sleep(paceMs, ctx.signal);
        yield { type: 'status', stage: 'validating' };
        yield { type: 'validation', result: validate(request.diagram, changeSet) };
        yield { type: 'status', stage: 'done' };
      });
    },
  };
}

/** The validation the orchestrator will run: apply the change set, then check the result. */
function validate(diagram: Diagram, changeSet: ChangeSet): ValidationResult {
  const result = applyChangeSet(diagram, changeSet);
  if (result.ok) return validateDiagram(result.diagram);
  return {
    ok: false,
    errors: [
      { code: result.error.code, severity: 'error', ids: [], message: result.error.message },
    ],
    warnings: [],
  };
}

/** Sequential `n1, n2, …` / `e1, e2, …` ids that skip anything already in the diagram. */
function freshIds(diagram: Diagram) {
  const used = new Set<Id>(
    [...diagram.nodes, ...diagram.edges, ...diagram.groups].map((x) => x.id),
  );
  const counters: Record<string, number> = {};
  return {
    next(prefix: string): Id {
      let n = counters[prefix] ?? 0;
      let id: Id;
      do {
        n += 1;
        id = `${prefix}${n}`;
      } while (used.has(id));
      counters[prefix] = n;
      used.add(id);
      return id;
    },
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
