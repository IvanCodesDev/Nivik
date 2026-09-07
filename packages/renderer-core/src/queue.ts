export interface ReconcileQueue<T> {
  push(snapshot: T): void;
  /** Deliver the pending snapshot now (pointerup, end of text editing). */
  flush(): void;
  dispose(): void;
  readonly pending: boolean;
}

/**
 * Spec 04 §5.2 step 1: renderer change events arrive on every pointer move, so they are debounced
 * (250 ms) down to the latest snapshot; `flush` short-circuits the wait.
 */
export function createReconcileQueue<T>(opts: {
  debounceMs?: number;
  onFlush: (latest: T) => void;
}): ReconcileQueue<T> {
  const delay = opts.debounceMs ?? 250;
  let latest: T | undefined;
  let hasLatest = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const fire = () => {
    cancel();
    if (!hasLatest) return;
    const value = latest as T;
    latest = undefined;
    hasLatest = false;
    opts.onFlush(value);
  };
  return {
    push(snapshot) {
      latest = snapshot;
      hasLatest = true;
      cancel();
      timer = setTimeout(fire, delay);
    },
    flush: fire,
    dispose() {
      cancel();
      latest = undefined;
      hasLatest = false;
    },
    get pending() {
      return hasLatest;
    },
  };
}
