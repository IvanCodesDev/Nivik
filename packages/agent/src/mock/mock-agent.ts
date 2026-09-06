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

// A type alias (not an interface) so it is assignable to the protocol's open action payload.
type MockAction = {
  type: 'addNode' | 'addEdge';
  id: string;
  label?: string;
  from?: string;
  to?: string;
};

const NO_RETRY = { attempts: 0, on: [] } as const;

/**
 * Scripted agent: no model calls, deterministic output derived from the prompt. It exercises the
 * real harness (stages, budget, cancellation, terminal events) so hosts and the UI can be built
 * and tested before the provider-backed stages land (tasks 1.5–1.7).
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
      const existingNodes = Array.isArray(request.diagram.nodes) ? request.diagram.nodes.length : 0;
      const plan: Plan = {
        intent: existingNodes > 0 ? 'edit' : 'generate',
        diagramType: request.hints.diagramType ?? 'flow',
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

  const buildStage: Stage<{ request: RunRequest; plan: Plan }, MockAction[]> = {
    name: 'build',
    budget: { maxTokens: 16_000, maxCalls: 1, timeoutMs: 60_000 },
    retry: NO_RETRY,
    async *run(ctx, { request }) {
      yield { type: 'status', stage: 'building' };
      ctx.budget.addCall();
      const steps = splitSteps(request.prompt);
      const actions: MockAction[] = [];
      let index = 0;
      for (const [i, label] of steps.entries()) {
        await ctx.sleep(paceMs);
        const node: MockAction = { type: 'addNode', id: `n${i + 1}`, label };
        actions.push(node);
        ctx.budget.addTokens({ inputTokens: 0, outputTokens: estimateTokens(label) + 8 });
        yield { type: 'action', index: index++, action: node, ok: true };
        if (i > 0) {
          const edge: MockAction = { type: 'addEdge', id: `e${i}`, from: `n${i}`, to: `n${i + 1}` };
          actions.push(edge);
          yield { type: 'action', index: index++, action: edge, ok: true };
        }
      }
      yield {
        type: 'changeSet',
        changeSet: {
          runId: ctx.runId,
          origin: 'ai',
          baseVersion: typeof request.diagram.version === 'number' ? request.diagram.version : 0,
          actions,
        },
      };
      return actions;
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
        yield* runStage(ctx, buildStage, { request, plan });
        // Connecting (layout + render) belongs to the orchestrator; the core only announces it.
        yield { type: 'status', stage: 'connecting' };
        await deps.sleep(paceMs, ctx.signal);
        yield { type: 'status', stage: 'validating' };
        yield { type: 'validation', result: { errors: [], warnings: [] } };
        yield { type: 'status', stage: 'done' };
      });
    },
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
