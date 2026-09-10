import { createLoopAgent } from '@nivik/agent';
import { createWorkerHost } from '@/lib/agent-worker-protocol';

/** The dedicated-worker global, typed locally so this file compiles with the app's DOM lib. */
interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;

// Spec 07 §1.1 local mode: the same @nivik/agent core the runtime hosts, off the main thread, with
// the model resolver built from the providers and keys the page hands over per run. Since D14′ the
// agent is the open tool loop; the scripted mock only serves pages without a configured provider.
const host = createWorkerHost(
  (message) => scope.postMessage(message),
  (deps) => createLoopAgent(deps),
);

scope.onmessage = (event) => {
  void host.handle(event.data);
};
