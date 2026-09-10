import { toReadout } from '@nivik/ir';
import { type Plan, RunError, type RunEvent, type RunRequest } from '@nivik/protocol';
import type { ModelMessage, ToolSet } from 'ai';
import type { Agent, RunOptions } from './agent';
import type { AgentDeps } from './deps';
import { toRunError } from './harness/context';
import { createEventChannel } from './harness/events';
import { runToolLoop, type ToolLoopResult } from './harness/loop';
import { createQuestions } from './harness/questions';
import type { Transcript } from './harness/recorder';
import { SoftBudget } from './harness/soft-budget';
import { buildSystemPrompt } from './prompts/system';
import { createDocuments } from './tools/documents';
import { converge } from './tools/finish';
import {
  createTools,
  stageOf,
  summarizeToolResult,
  TOOL_NAMES,
  type ToolContext,
  type ToolState,
  toolNamesFor,
} from './tools/registry';

export interface SystemPromptInput {
  request: RunRequest;
  tools: readonly string[];
  /** The plan so far — the prompt is rebuilt before every step so hint packs can join. */
  plan: Plan | null;
}

export interface LoopAgentOptions {
  /** Builds the system prompt; the default is spec 05 §4.3 (`buildSystemPrompt`). */
  system?(input: SystemPromptInput): string;
  keepRecentSteps?: number;
  /** Sub-agent call timeout; default 30 s. */
  subagentTimeoutMs?: number;
  /** Runtime-only tools to register alongside the core diagram tools for each run. */
  tools?(context: ToolContext, options: { signal: AbortSignal }): ToolSet;
  /** Called with the transcript when a run ends, however it ends (recording, RunRecord). */
  onTranscript?(runId: string, transcript: Transcript): void;
}

/** An `Agent` that can also relay the user's reply to a pending `ask`. */
export interface LoopAgent extends Agent {
  answer(questionId: string, text: string): boolean;
  /** Questions the running run is waiting on (empty when idle). */
  pendingQuestions(runId?: string): { questionId: string; text: string }[];
}

const DEFAULT_SYSTEM = (input: SystemPromptInput): string =>
  buildSystemPrompt({
    tools: input.tools,
    capabilities: input.request.capabilities,
    plan: input.plan,
  });

/**
 * D14′ / spec 05 §1.1: the open tool loop as an `Agent`. One `run` = one `runToolLoop`; the
 * closing events (change sets and `done`) are derived from what the tools recorded, and the
 * budget safety net or an abort ends the run when the model does not.
 */
export function createLoopAgent(deps: AgentDeps, opts: LoopAgentOptions = {}): LoopAgent {
  // One agent may host several runs at once (the runtime does); each keeps its own question table.
  const active = new Map<string, ReturnType<typeof createQuestions>>();

  const agent: LoopAgent = {
    answer: (questionId, text) => {
      for (const questions of active.values()) {
        if (questions.answer(questionId, text)) return true;
      }
      return false;
    },
    pendingQuestions: (runId) =>
      [...active.entries()]
        .filter(([id]) => runId === undefined || id === runId)
        .flatMap(([, questions]) =>
          questions.pending().map(({ questionId, text }) => ({ questionId, text })),
        ),
    async *run(request: RunRequest, options: RunOptions = {}): AsyncGenerator<RunEvent> {
      const runId = request.runId ?? deps.newRunId();
      const signal = options.signal ?? new AbortController().signal;
      const channel = createEventChannel<RunEvent>();
      const emit = (event: RunEvent) => channel.push(event);

      const work = async () => {
        const resolver = deps.model;
        if (!resolver) throw new RunError('E_INTERNAL', 'No model configured for this run');
        const model = resolver('main');
        const budget = new SoftBudget(request.budget, deps.now);
        const questions = createQuestions({
          signal,
          now: deps.now,
          newId: () => `q_${deps.newRunId().slice(4, 12)}`,
        });
        active.set(runId, questions);
        const documents = createDocuments(request.diagram, { now: deps.now, runId });
        const state: ToolState = { plan: null, finish: null };
        const context: ToolContext = {
          runId,
          documents,
          sources: request.sources,
          questions,
          budget,
          emit,
          now: deps.now,
          request: request.prompt,
          canAsk: request.capabilities.ask,
          subagents: {
            model: resolver,
            signal,
            ...(opts.subagentTimeoutMs !== undefined ? { timeoutMs: opts.subagentTimeoutMs } : {}),
          },
        };
        // Host tools (runtime-only browseRepo / fetchUrl) join the core set; the core wins on a name clash.
        const hostTools = opts.tools?.(context, { signal }) ?? {};
        const tools = { ...hostTools, ...createTools(context, state) };
        const toolNames = [
          ...toolNamesFor(context),
          ...Object.keys(hostTools).filter(
            (name) => !(TOOL_NAMES as readonly string[]).includes(name),
          ),
        ];
        const buildSystem = opts.system ?? DEFAULT_SYSTEM;
        const system = () => buildSystem({ request, tools: toolNames, plan: state.plan });
        const readout = toReadout(request.diagram, {
          scope: request.selection.length ? { selection: request.selection, hops: 2 } : 'all',
          selection: request.selection,
        });
        const messages: ModelMessage[] = [
          { role: 'user', content: userTurn(request, readout.text) },
        ];

        emit({ type: 'status', stage: 'thinking' });
        let result: ToolLoopResult;
        try {
          result = await runToolLoop({
            model,
            system,
            messages,
            tools,
            budget,
            signal,
            emit,
            now: deps.now,
            stageOf,
            summarize: summarizeToolResult,
            trim: { keepRecentSteps: opts.keepRecentSteps ?? 3 },
            temperature: request.settings.temperature,
            maxOutputTokens: request.settings.maxTokens,
          });
        } catch (error) {
          const runError = toRunError(error);
          if (runError.code === 'E_ABORTED' && questions.interruptedWhileWaiting()) {
            // Cancelled while the model waited for a person: not a failure, an unfinished exchange.
            emit({
              type: 'done',
              runId,
              outcome: 'clarify-pending',
              summary: 'Cancelled while waiting for your answer.',
              unresolved: [],
            });
            return;
          }
          throw runError;
        } finally {
          active.delete(runId);
        }

        const summaryFromReply = lastReply(result.transcript) ?? 'Done.';
        const finish = state.finish ?? {
          summary: result.exhausted
            ? 'Budget exhausted; delivering what was built so far.'
            : summaryFromReply,
          unresolved: result.exhausted ? unresolvedFromPlan(state) : [],
          convergence: converge(
            documents,
            state.plan,
            result.exhausted ? 'Budget exhausted' : summaryFromReply,
            {
              runId,
              now: deps.now,
            },
          ),
        };
        for (const { doc, changeSet } of finish.convergence.documents) {
          emit({ type: 'changeSet', documentId: doc.id, changeSet });
        }
        opts.onTranscript?.(runId, result.transcript);
        emit({ type: 'usage', usage: budget.usage() });
        emit({ type: 'status', stage: 'done' });
        emit({
          type: 'done',
          runId,
          outcome: result.exhausted ? 'budget-exhausted' : finish.convergence.outcome,
          summary: finish.summary.slice(0, 600),
          unresolved: (finish.unresolved ?? []).slice(0, 10),
        });
      };

      void work().then(
        () => channel.close(),
        (error: unknown) => {
          const runError = toRunError(error);
          channel.push({
            type: 'error',
            code: runError.code,
            message: runError.message,
            recoverable: false,
          });
          channel.close();
        },
      );

      for await (const event of channel) yield event;
    },
  };
  return agent;
}

function userTurn(request: RunRequest, readout: string): string {
  const parts: string[] = [];
  if (request.session.summary || request.session.recentTurns.length > 0) {
    parts.push('## Session');
    if (request.session.summary) parts.push(request.session.summary);
    for (const turn of request.session.recentTurns) {
      parts.push(`- User: ${turn.user}`);
      for (const reply of turn.agent.replies) parts.push(`  - You: ${reply}`);
      for (const q of turn.agent.questions)
        parts.push(`  - You asked: ${q.text} → ${q.answer ?? '(no answer)'}`);
      for (const change of turn.agent.changes)
        parts.push(`  - Changed ${change.documentId}: ${change.summary}`);
    }
  }
  parts.push('## Current diagram', readout);
  if (request.sources.length > 0) {
    parts.push(
      '## Sources',
      ...request.sources.map(
        (s) =>
          `- ${s.id} (${s.kind}): ${s.title} — ${s.text.length} chars; use searchSources / readSource`,
      ),
    );
  }
  parts.push('## Request', request.prompt);
  return parts.join('\n');
}

function lastReply(transcript: Transcript): string | null {
  for (let i = transcript.steps.length - 1; i >= 0; i -= 1) {
    const text = transcript.steps[i]?.text.trim();
    if (text) return text.slice(0, 600);
  }
  return null;
}

function unresolvedFromPlan(state: ToolState): string[] {
  return state.plan?.steps.slice(0, 10) ?? [];
}
