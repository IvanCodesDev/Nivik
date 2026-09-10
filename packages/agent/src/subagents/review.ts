import { type Diagram, toReadout } from '@nivik/ir';
import { type Plan, type ReviewIssue, ReviewIssueSchema, RunError } from '@nivik/protocol';
import { generateText, type LanguageModel, Output } from 'ai';
import { z } from 'zod';
import { toProviderError } from '../providers/errors';

export const ReviewOutputSchema = z.object({
  intentMatch: z.enum(['yes', 'partial', 'no']),
  issues: z.array(ReviewIssueSchema).max(10),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export interface SubagentCall<T> {
  result: T;
  usage: { inputTokens: number; outputTokens: number };
}

export interface SubagentDeps {
  model: LanguageModel;
  signal: AbortSignal;
  timeoutMs?: number;
}

const REVIEW_SYSTEM = [
  'You review a structured diagram another agent just edited for a person. You only read; you never edit.',
  'Check, in this order: missing elements the request implies; orphan nodes; illegal or missing connections; groups that mix unrelated things; labels that are unclear or duplicated; whether the result matches the request.',
  'Report at most 10 issues, each with a severity (info / warning / error), a one-sentence message and the ids involved. Say intentMatch: yes / partial / no.',
  'Do not invent problems; an empty list with intentMatch "yes" is a valid answer.',
].join('\n');

const CRITIQUE_SYSTEM = [
  'You critique a plan for editing a structured diagram before it is executed. You only read.',
  'Check: does the diagram type and layout strategy fit the request (position carries meaning → grid; connections drive position → layered / radial; interactions over time → sequence)? Are the steps complete and in a sensible order? Is the estimated size plausible? Is anything in the request ignored?',
  'Report at most 10 issues with severity, message and no ids (ids: []). Say intentMatch: yes / partial / no.',
].join('\n');

async function call(
  deps: SubagentDeps,
  system: string,
  prompt: string,
): Promise<SubagentCall<ReviewOutput>> {
  try {
    const result = await generateText({
      model: deps.model,
      system,
      prompt,
      output: Output.object({ schema: ReviewOutputSchema }),
      maxRetries: 0,
      abortSignal: deps.signal,
      timeout: deps.timeoutMs ?? 30_000,
    });
    if (deps.signal.aborted) throw new RunError('E_ABORTED', 'Run cancelled');
    return {
      result: result.output,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      },
    };
  } catch (error) {
    throw toProviderError(error);
  }
}

/**
 * Design §3 `review`: an independent-context reviewer over the staging document — its own system
 * prompt, the Readout, the person's request. One structured call, no tools.
 */
export function reviewDiagram(
  deps: SubagentDeps,
  input: { diagram: Diagram; request: string; focus?: string },
): Promise<SubagentCall<ReviewOutput>> {
  const readout = toReadout(input.diagram, { includeNotes: true, maxTokens: 6_000 }).text;
  const prompt = [
    '## The person asked',
    input.request,
    ...(input.focus ? ['## Focus', input.focus] : []),
    '## Diagram after the edit',
    readout,
  ].join('\n');
  return call(deps, REVIEW_SYSTEM, prompt);
}

/** Design §3 `critiquePlan`: the same shape of call, aimed at the plan instead of the result. */
export function critiquePlan(
  deps: SubagentDeps,
  input: { plan: Plan; diagram: Diagram; request: string },
): Promise<SubagentCall<ReviewOutput>> {
  const head = toReadout(input.diagram, { includeNotes: false, maxTokens: 1_500 }).text;
  const prompt = [
    '## The person asked',
    input.request,
    '## The plan',
    JSON.stringify(input.plan, null, 1),
    '## Current diagram (head)',
    head,
  ].join('\n');
  return call(deps, CRITIQUE_SYSTEM, prompt);
}

export type { ReviewIssue };
