import { describe, expect, it } from 'vitest';
import { isTerminalEvent, RunEventSchema } from './run-event';
import { RunRequestSchema } from './run-request';

describe('RunRequestSchema', () => {
  it('applies defaults for optional collections and settings', () => {
    const parsed = RunRequestSchema.parse({
      diagram: {},
      prompt: '  Draw a login flow  ',
      hints: { renderer: 'excalidraw' },
    });
    expect(parsed.prompt).toBe('Draw a login flow');
    expect(parsed.selection).toEqual([]);
    expect(parsed.sources).toEqual([]);
    expect(parsed.model).toBe('auto');
    expect(parsed.settings).toEqual({
      temperature: 0.3,
      maxTokens: 8_192,
      timeoutMs: 120_000,
      retries: 1,
      thinking: false,
    });
  });

  it('rejects blank prompts, unknown renderers and malformed run ids', () => {
    const base = { diagram: {}, hints: { renderer: 'excalidraw' } };
    expect(RunRequestSchema.safeParse({ ...base, prompt: '   ' }).success).toBe(false);
    expect(
      RunRequestSchema.safeParse({ ...base, prompt: 'x', hints: { renderer: 'visio' } }).success,
    ).toBe(false);
    expect(RunRequestSchema.safeParse({ ...base, prompt: 'x', runId: 'short' }).success).toBe(
      false,
    );
    expect(
      RunRequestSchema.safeParse({ ...base, prompt: 'x', runId: 'run_0123456789' }).success,
    ).toBe(true);
  });
});

describe('RunEventSchema', () => {
  it('round-trips every event kind through JSON', () => {
    const events = [
      { type: 'status', stage: 'planning' },
      {
        type: 'plan',
        plan: {
          intent: 'generate',
          diagramType: 'flow',
          scope: { kind: 'all' },
          summary: 'Login flow',
          steps: ['Add nodes', 'Connect'],
          layout: { direction: 'RIGHT' },
          estimatedNodes: 6,
        },
      },
      { type: 'action', index: 0, action: { type: 'addNode', label: 'Start' }, ok: true },
      { type: 'repair', attempted: 2, fixed: 1 },
      { type: 'changeSet', changeSet: { actions: [] } },
      { type: 'validation', result: { errors: [], warnings: [] } },
      { type: 'review', issues: [{ severity: 'warning', message: 'Orphan node', ids: ['n1'] }] },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, calls: 1 } },
      { type: 'tool', name: 'findNodes', durationMs: 3 },
      { type: 'error', code: 'E_PROVIDER_TIMEOUT', message: 'timed out', recoverable: true },
      { type: 'done', runId: 'run_0123456789' },
    ];
    for (const event of events) {
      const parsed = RunEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(parsed).toEqual(event);
    }
  });

  it('rejects unknown event types and stages', () => {
    expect(RunEventSchema.safeParse({ type: 'progress', value: 1 }).success).toBe(false);
    expect(RunEventSchema.safeParse({ type: 'status', stage: 'thinking' }).success).toBe(false);
    expect(
      RunEventSchema.safeParse({ type: 'error', code: 'E_NOPE', message: '', recoverable: false })
        .success,
    ).toBe(false);
  });

  it('treats done and unrecoverable errors as terminal', () => {
    expect(isTerminalEvent({ type: 'done', runId: 'run_0123456789' })).toBe(true);
    expect(
      isTerminalEvent({ type: 'error', code: 'E_ABORTED', message: '', recoverable: false }),
    ).toBe(true);
    expect(
      isTerminalEvent({
        type: 'error',
        code: 'E_PROVIDER_RATE_LIMIT',
        message: '',
        recoverable: true,
      }),
    ).toBe(false);
    expect(isTerminalEvent({ type: 'status', stage: 'done' })).toBe(false);
  });
});
