import type { ChangeSet } from '@nivik/ir';
import type { RunEvent, SessionTurn } from '@nivik/protocol';
import type { SessionRecord } from '@nivik/storage';
import { describe, expect, it } from 'vitest';
import { sessionForRequest, turnFromRun } from './session';

const turn = (i: number): SessionTurn => ({
  runId: `run_${i}`,
  at: i,
  user: `turn ${i}`,
  agent: { replies: [], questions: [], changes: [], outcome: 'finished' },
});

describe('sessionForRequest', () => {
  it('is empty before the first run and otherwise carries the last six turns plus the summary', () => {
    expect(sessionForRequest(null)).toEqual({ recentTurns: [], summary: null });
    const record: SessionRecord = {
      id: 'd1',
      diagramId: 'd1',
      turns: Array.from({ length: 8 }, (_, i) => turn(i)),
      summary: 'older stuff',
      updatedAt: 9,
    };
    const session = sessionForRequest(record);
    expect(session.recentTurns.map((t) => t.runId)).toEqual([
      'run_2',
      'run_3',
      'run_4',
      'run_5',
      'run_6',
      'run_7',
    ]);
    expect(session.summary).toBe('older stuff');
  });
});

describe('turnFromRun', () => {
  const cs = (
    diagramId: string,
    ops: ChangeSet['actions'],
    origin: ChangeSet['origin'] = 'ai',
  ): ChangeSet => ({
    id: `cs_${diagramId}`,
    diagramId,
    baseVersion: 1,
    origin,
    createdAt: 1,
    summary: origin === 'ai' ? `Edited ${diagramId}` : undefined,
    actions: ops,
  });

  it('keeps what the agent said, asked and changed, and how the run ended', () => {
    const events: RunEvent[] = [
      { type: 'reply', text: 'Adding ', final: false },
      { type: 'reply', text: 'payments.', final: true },
      { type: 'question', questionId: 'q1', text: 'Retries?', allowFreeText: true },
      { type: 'answer', questionId: 'q1', text: 'Yes' },
      { type: 'question', questionId: 'q2', text: 'Colour?', allowFreeText: true },
      { type: 'reply', text: 'Done, mostly', final: false },
      {
        type: 'done',
        runId: 'run_1',
        outcome: 'finished',
        summary: 'Added payments.',
        unresolved: [],
      },
    ];
    const result = turnFromRun({
      runId: 'run_1',
      prompt: 'Add payments',
      events,
      applied: [
        cs('d1', [
          { op: 'addNode', node: { id: 'p', type: 'box', label: 'P', parent: null } },
          {
            op: 'addEdge',
            edge: {
              id: 'e',
              type: 'flow',
              source: 'a',
              target: 'p',
              direction: 'forward',
              sourceSide: 'auto',
              targetSide: 'auto',
            },
          },
        ]),
        cs('d1', [{ op: 'moveNode', id: 'p', position: { x: 0, y: 0 } }], 'system'),
        cs('d2', [{ op: 'addNode', node: { id: 'q', type: 'box', label: 'Q', parent: null } }]),
      ],
      status: 'done',
      at: 42,
    });
    expect(result).toEqual({
      runId: 'run_1',
      at: 42,
      user: 'Add payments',
      agent: {
        replies: ['Adding payments.', 'Done, mostly', 'Added payments.'],
        questions: [
          { text: 'Retries?', answer: 'Yes' },
          { text: 'Colour?', answer: null },
        ],
        changes: [
          { documentId: 'd1', summary: 'Edited d1', counts: { addNode: 1, addEdge: 1 } },
          { documentId: 'd2', summary: 'Edited d2', counts: { addNode: 1 } },
        ],
        outcome: 'finished',
      },
    });
  });

  it('falls back to the host status when the run never reached done', () => {
    const failed = turnFromRun({
      runId: 'run_2',
      prompt: 'x',
      events: [{ type: 'error', code: 'E_PROVIDER_AUTH', message: 'nope', recoverable: false }],
      applied: [],
      status: 'failed',
      at: 1,
    });
    expect(failed.agent).toEqual({ replies: [], questions: [], changes: [], outcome: 'failed' });
    const aborted = turnFromRun({
      runId: 'run_3',
      prompt: 'y',
      events: [],
      applied: [],
      status: 'aborted',
      at: 2,
    });
    expect(aborted.agent.outcome).toBe('aborted');
  });
});
