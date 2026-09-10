/**
 * Turns a push-style producer into an async iterable: the loop calls `push` synchronously from
 * inside tool executes and stream handlers, the host consumes at its own pace.
 */
export interface EventChannel<T> extends AsyncIterable<T> {
  push(value: T): void;
  close(): void;
  fail(error: unknown): void;
}

export function createEventChannel<T>(): EventChannel<T> {
  const queue: T[] = [];
  let closed = false;
  let failure: { error: unknown } | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  return {
    push(value) {
      if (closed) return;
      queue.push(value);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    fail(error) {
      failure = { error };
      closed = true;
      notify();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (queue.length > 0) yield queue.shift() as T;
        if (failure) throw failure.error;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
