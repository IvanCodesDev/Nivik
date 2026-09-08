import { createMockAgent } from '@nivik/agent';
import { createWorkerHost } from '@/lib/agent-worker-protocol';

/** The dedicated-worker global, typed locally so this file compiles with the app's DOM lib. */
interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;

/** Pacing of the scripted agent so the UI shows stage transitions; real stages (task 1.7) replace it. */
const MOCK_PACE_MS = 80;

// Spec 07 §1.1 local mode: the same @nivik/agent core the runtime hosts, off the main thread, with
// the model resolver built from the providers and keys the page hands over per run.
const host = createWorkerHost(
  (message) => scope.postMessage(message),
  (deps) => createMockAgent(deps, { paceMs: MOCK_PACE_MS }),
);

scope.onmessage = (event) => {
  void host.handle(event.data);
};
