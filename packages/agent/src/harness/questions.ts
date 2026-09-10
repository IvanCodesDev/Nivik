import { RunError } from '@nivik/protocol';

export interface QuestionInput {
  text: string;
  choices?: string[];
  allowFreeText: boolean;
}

export interface PendingQuestion extends QuestionInput {
  questionId: string;
  askedAt: number;
}

export interface Questions {
  /** Registers a question and returns the promise the `ask` tool awaits. */
  ask(input: QuestionInput): { questionId: string; answer: Promise<string> };
  /** The host's reply; false when nothing with that id is waiting. */
  answer(questionId: string, text: string): boolean;
  pending(): PendingQuestion[];
  /** Rejects every waiting question (cancellation); idempotent. */
  rejectAll(error?: RunError): void;
}

export interface QuestionsOptions {
  signal: AbortSignal;
  now(): number;
  newId(): string;
}

interface Waiting extends PendingQuestion {
  resolve(text: string): void;
  reject(error: RunError): void;
}

/**
 * Spec 09 §3.2: a person in the loop is a tool call that waits. Nothing is persisted — the run
 * lives in memory until the answer arrives or the host cancels.
 */
export function createQuestions(opts: QuestionsOptions): Questions {
  const waiting = new Map<string, Waiting>();
  const abortAll = () =>
    rejectAll(new RunError('E_ABORTED', 'Run cancelled while waiting for an answer'));
  const rejectAll = (error = new RunError('E_ABORTED', 'Run cancelled')) => {
    for (const q of waiting.values()) q.reject(error);
    waiting.clear();
  };
  opts.signal.addEventListener('abort', abortAll, { once: true });

  return {
    ask(input) {
      if (opts.signal.aborted) {
        return {
          questionId: '',
          answer: Promise.reject(new RunError('E_ABORTED', 'Run cancelled')),
        };
      }
      const questionId = opts.newId();
      const answer = new Promise<string>((resolve, reject) => {
        waiting.set(questionId, { ...input, questionId, askedAt: opts.now(), resolve, reject });
      });
      return { questionId, answer };
    },
    answer(questionId, text) {
      const q = waiting.get(questionId);
      if (!q) return false;
      waiting.delete(questionId);
      q.resolve(text);
      return true;
    },
    pending() {
      return Array.from(waiting.values()).map(({ resolve: _r, reject: _j, ...rest }) => rest);
    },
    rejectAll,
  };
}
