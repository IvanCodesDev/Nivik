import { AgentActionSchema, DiagramTypeSchema, IdSchema, LayoutPatchSchema } from '@nivik/ir';
import {
  type Plan,
  PlanSchema,
  type ResolvedSource,
  type RunEvent,
  type RunStage,
} from '@nivik/protocol';
import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import type { Questions } from '../harness/questions';
import type { SoftBudget } from '../harness/soft-budget';
import type { Documents } from './documents';
import { converge, type FinishInput } from './finish';
import { describe, findElements } from './read';
import { readSource, searchSources } from './sources';

export interface ToolContext {
  runId: string;
  documents: Documents;
  sources: readonly ResolvedSource[];
  questions: Questions;
  budget: SoftBudget;
  emit(event: RunEvent): void;
  now(): number;
}

/** What the loop learns from the tools between steps: the plan so far and how it ended. */
export interface ToolState {
  plan: Plan | null;
  finish: (FinishInput & { convergence: ReturnType<typeof converge> }) | null;
}

export const TOOL_NAMES = [
  'setPlan',
  'findElements',
  'describe',
  'searchSources',
  'readSource',
  'applyActions',
  'createDiagram',
  'switchDiagram',
  'ask',
  'finish',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Spec 05 §12.1: the loop's `status` follows what the model is doing. */
export function stageOf(toolName: string): RunStage | null {
  switch (toolName) {
    case 'setPlan':
      return 'thinking';
    case 'findElements':
    case 'describe':
    case 'searchSources':
    case 'readSource':
      return 'reading';
    case 'applyActions':
    case 'createDiagram':
    case 'switchDiagram':
      return 'building';
    case 'ask':
      return 'asking';
    default:
      return null;
  }
}

/** One-line renderings for the trace and for trimmed history. */
export function summarizeToolResult(toolName: string, output: unknown): string {
  const o = (output ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case 'applyActions':
      return `${o.accepted ?? 0} accepted, ${Array.isArray(o.rejected) ? o.rejected.length : 0} rejected`;
    case 'findElements':
      return `${Array.isArray(o.matches) ? o.matches.length : 0} match(es)`;
    case 'searchSources':
      return `${Array.isArray(o.hits) ? o.hits.length : 0} passage(s)`;
    case 'describe':
    case 'readSource':
      return typeof o.text === 'string'
        ? `${o.text.length} chars`
        : typeof o.readout === 'string'
          ? `${o.readout.length} chars`
          : 'ok';
    case 'ask':
      return typeof o.answer === 'string' ? `answer: ${o.answer.slice(0, 80)}` : 'no answer';
    case 'setPlan':
      return typeof o.summary === 'string' ? o.summary.slice(0, 120) : 'plan set';
    case 'finish':
      return typeof o.outcome === 'string' ? o.outcome : 'finished';
    default: {
      try {
        return JSON.stringify(output).slice(0, 120);
      } catch {
        return toolName;
      }
    }
  }
}

/**
 * Spec 05 §2.2 (design): the model's whole world. Reads are pure functions over the staging
 * documents and the resolved sources; the only write is `applyActions`; `ask` waits for a person;
 * `finish` converges the change sets. Runtime-only tools (browseRepo / fetchUrl) are appended by
 * the runtime host (task 1.7b).
 */
export function createTools(ctx: ToolContext, state: ToolState): ToolSet {
  const emitDocument = (
    op: 'create' | 'switch',
    document: { id: string; name: string; type: string },
  ) => ctx.emit({ type: 'document', op, document: { ...document, type: document.type } });

  return {
    setPlan: tool({
      description:
        'Record (or update) your plan for this request: intent, the diagram type you will produce, the layout strategy, the steps you intend to take and the expected size. Shown to the user.',
      inputSchema: PlanSchema,
      execute: async (plan) => {
        state.plan = plan;
        ctx.emit({ type: 'plan', plan });
        return { ok: true, summary: plan.summary };
      },
    }),
    findElements: tool({
      description:
        'Search the current diagram for elements whose id, label, role, description or type contains every word of the query.',
      inputSchema: z.object({
        query: z.string().min(1).max(80),
        kinds: z.array(z.enum(['node', 'edge', 'group'])).optional(),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async (input) => ({
        matches: findElements(ctx.documents.current().staging, input),
      }),
    }),
    describe: tool({
      description:
        'Readout of specific elements (by id) and their neighbourhood in the current diagram; use it when the Readout you were given was scoped.',
      inputSchema: z.object({
        ids: z.array(IdSchema).min(1).max(20),
        hops: z.union([z.literal(0), z.literal(1)]).default(0),
      }),
      execute: async (input) => describe(ctx.documents.current().staging, input),
    }),
    searchSources: tool({
      description: 'Find the passages of the attached sources most relevant to a query.',
      inputSchema: z.object({
        query: z.string().min(1).max(80),
        limit: z.number().int().min(1).max(5).default(3),
      }),
      execute: async ({ query, limit }) => ({
        hits: searchSources(ctx.sources, query, limit).map((h) => ({
          sourceId: h.sourceId,
          title: h.title,
          chunk: h.index,
          text: h.text,
        })),
      }),
    }),
    readSource: tool({
      description: 'Read a passage of an attached source verbatim (by source id and chunk range).',
      inputSchema: z.object({
        sourceId: z.string().min(1),
        from: z.number().int().min(0).optional(),
        to: z.number().int().min(0).optional(),
      }),
      execute: async (input) => {
        const passage = readSource(ctx.sources, input);
        return passage ?? { error: `No source "${input.sourceId}"` };
      },
    }),
    applyActions: tool({
      description:
        'Apply a batch of diagram actions to the current (or given) document. Each action is validated in order; the result tells you which were accepted, why the others were rejected (with a hint), any warnings you introduced, and a Readout of what you touched.',
      inputSchema: z.object({
        documentId: IdSchema.optional(),
        actions: z.array(AgentActionSchema).min(1).max(200),
      }),
      execute: async ({ documentId, actions }) => {
        const { result, outcomes } = ctx.documents.applyActions(actions, documentId);
        for (const outcome of outcomes) {
          ctx.emit({
            type: 'action',
            documentId: result.documentId,
            index: outcome.index,
            action: outcome.action,
            ok: outcome.ok,
            ...(outcome.error ? { error: outcome.error } : {}),
          });
        }
        return result;
      },
    }),
    createDiagram: tool({
      description:
        'Start a new, separate diagram (for example when the request is better served by several diagrams). It becomes the current document.',
      inputSchema: z.object({
        name: z.string().min(1).max(120),
        type: DiagramTypeSchema,
        layout: LayoutPatchSchema.pick({ algorithm: true, direction: true }).partial().optional(),
      }),
      execute: async (input) => {
        const info = ctx.documents.create(input);
        emitDocument('create', info);
        return { documentId: info.id };
      },
    }),
    switchDiagram: tool({
      description: 'Make another document of this run the current one.',
      inputSchema: z.object({ documentId: IdSchema }),
      execute: async ({ documentId }) => {
        const info = ctx.documents.switchTo(documentId);
        emitDocument('switch', info);
        const doc = ctx.documents.current();
        return {
          documentId: info.id,
          name: info.name,
          type: info.type,
          nodes: doc.staging.nodes.length,
          edges: doc.staging.edges.length,
        };
      },
    }),
    ask: tool({
      description:
        'Ask the user one specific question when you need a decision only they can make. Offer choices when there are natural options. The run waits for the answer.',
      inputSchema: z.object({
        text: z.string().min(1).max(300),
        choices: z.array(z.string().min(1).max(120)).max(5).optional(),
        allowFreeText: z.boolean().default(true),
      }),
      execute: async (input) => {
        const { questionId, answer } = ctx.questions.ask(input);
        ctx.emit({
          type: 'question',
          questionId,
          text: input.text,
          ...(input.choices ? { choices: input.choices } : {}),
          allowFreeText: input.allowFreeText,
        });
        ctx.budget.pause();
        try {
          const text = await answer;
          ctx.emit({ type: 'answer', questionId, text });
          return { answer: text };
        } finally {
          ctx.budget.resume();
        }
      },
    }),
    finish: tool({
      description:
        'Declare the work complete. Summarise what you did for the user and list anything you could not do in `unresolved`.',
      inputSchema: z.object({
        summary: z.string().min(1).max(300),
        unresolved: z.array(z.string().min(1).max(300)).max(10).optional(),
      }),
      execute: async (input) => {
        const convergence = converge(ctx.documents, state.plan, input.summary, {
          runId: ctx.runId,
          now: ctx.now,
        });
        state.finish = { ...input, convergence };
        return { ok: true, outcome: convergence.outcome, documents: convergence.documents.length };
      },
    }),
  };
}
