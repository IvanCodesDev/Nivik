import type { ChangeSet } from '@nivik/ir';
import type { RunEvent, Session, SessionTurn } from '@nivik/protocol';
import type { SessionRecord } from '@nivik/storage';

/** Design D14′ §4: the last turns verbatim plus the folded summary, as the request carries them. */
export function sessionForRequest(record: SessionRecord | null | undefined): Session {
  if (!record) return { recentTurns: [], summary: null };
  return {
    recentTurns: record.turns.slice(-6),
    summary: record.summary ? record.summary.slice(0, 4_000) : null,
  };
}

export interface TurnInput {
  runId: string;
  prompt: string;
  events: readonly RunEvent[];
  /** Change sets the host actually persisted (the agent's, not the system layout ones). */
  applied: readonly ChangeSet[];
  status: 'done' | 'failed' | 'aborted';
  at: number;
}

const countOps = (cs: ChangeSet) => {
  const counts: Record<string, number> = {};
  for (const action of cs.actions) counts[action.op] = (counts[action.op] ?? 0) + 1;
  return counts;
};

/** What of a finished run is worth remembering for the next one. */
export function turnFromRun(input: TurnInput): SessionTurn {
  const replies: string[] = [];
  let reply = '';
  const questions: { text: string; answer: string | null }[] = [];
  const byQuestion = new Map<string, number>();
  let outcome: string = input.status;
  let summary: string | null = null;

  for (const event of input.events) {
    switch (event.type) {
      case 'reply':
        reply += event.text;
        if (event.final) {
          if (reply.trim()) replies.push(reply.trim());
          reply = '';
        }
        break;
      case 'question':
        byQuestion.set(event.questionId, questions.length);
        questions.push({ text: event.text, answer: null });
        break;
      case 'answer': {
        const index = byQuestion.get(event.questionId);
        const entry = index === undefined ? undefined : questions[index];
        if (entry) entry.answer = event.text;
        break;
      }
      case 'done':
        if (event.outcome) outcome = event.outcome;
        summary = event.summary ?? null;
        break;
      default:
        break;
    }
  }
  if (reply.trim()) replies.push(reply.trim());
  if (summary && !replies.includes(summary)) replies.push(summary);

  return {
    runId: input.runId,
    at: input.at,
    user: input.prompt.slice(0, 4_000),
    agent: {
      replies: replies.slice(-10).map((r) => r.slice(0, 2_000)),
      questions: questions.slice(-10).map((q) => ({
        text: q.text.slice(0, 600),
        answer: q.answer === null ? null : q.answer.slice(0, 2_000),
      })),
      changes: input.applied
        .filter((cs) => cs.origin === 'ai')
        .slice(0, 10)
        .map((cs) => ({
          documentId: cs.diagramId,
          summary: (cs.summary ?? '').slice(0, 300),
          counts: countOps(cs),
        })),
      outcome: outcome.slice(0, 40),
    },
  };
}
