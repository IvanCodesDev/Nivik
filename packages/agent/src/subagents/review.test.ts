import { orderPlatformLaidOut } from '@nivik/ir/testing';
import { PlanSchema, RunError } from '@nivik/protocol';
import { describe, expect, it } from 'vitest';
import { createMockModel } from '../providers/mock';
import { critiquePlan, reviewDiagram } from './review';

const signal = () => new AbortController().signal;

describe('review sub-agent (design §3)', () => {
  it('returns the structured verdict and the tokens it spent', async () => {
    let prompt: unknown;
    const model = createMockModel(
      [
        {
          json: {
            intentMatch: 'partial',
            issues: [
              { severity: 'warning', message: 'Payments has no outgoing edge', ids: ['payments'] },
            ],
          },
          usage: { input: 900, output: 60 },
        },
      ],
      {
        onCall: (_i, p) => {
          prompt = p;
        },
      },
    );
    const diagram = orderPlatformLaidOut();
    const { result, usage } = await reviewDiagram(
      { model, signal: signal() },
      { diagram, request: 'Add a payments service', focus: 'edges' },
    );
    expect(result.intentMatch).toBe('partial');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.ids).toEqual(['payments']);
    expect(usage).toEqual({ inputTokens: 900, outputTokens: 60 });
    const text = JSON.stringify(prompt);
    expect(text).toContain('Add a payments service');
    expect(text).toContain('## Focus');
    expect(text).toContain('## Diagram after the edit');
    for (const node of diagram.nodes) expect(text).toContain(node.id);
  });

  it('critiques a plan against the request and the head of the diagram', async () => {
    const model = createMockModel([
      {
        json: {
          intentMatch: 'no',
          issues: [{ severity: 'error', message: 'A kanban wants the grid strategy' }],
        },
      },
    ]);
    const plan = PlanSchema.parse({
      intent: 'generate',
      diagramType: 'kanban',
      scope: { kind: 'all' },
      summary: 'Board',
      steps: ['columns'],
      layout: { algorithm: 'layered' },
      estimatedNodes: 6,
    });
    const { result } = await critiquePlan(
      { model, signal: signal() },
      { plan, diagram: orderPlatformLaidOut(), request: 'Make a kanban board' },
    );
    expect(result.intentMatch).toBe('no');
    expect(result.issues[0]?.ids).toEqual([]);
  });

  it('maps provider failures and malformed output to RunErrors', async () => {
    const failing = createMockModel([{ error: new Error('boom') }]);
    await expect(
      reviewDiagram(
        { model: failing, signal: signal() },
        { diagram: orderPlatformLaidOut(), request: 'x' },
      ),
    ).rejects.toBeInstanceOf(RunError);

    const garbage = createMockModel([{ text: 'not json at all' }]);
    await expect(
      reviewDiagram(
        { model: garbage, signal: signal() },
        { diagram: orderPlatformLaidOut(), request: 'x' },
      ),
    ).rejects.toBeInstanceOf(RunError);
  });
});
