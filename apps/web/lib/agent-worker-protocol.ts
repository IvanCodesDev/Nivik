import { type Agent, type AgentDeps, createDefaultDeps } from '@nivik/agent';
import { createModelResolver } from '@nivik/agent/providers';
import {
  AnswerRequestSchema,
  ProviderConfigSchema,
  type RunEvent,
  RunEventSchema,
  RunRequestSchema,
} from '@nivik/protocol';
import { z } from 'zod';

/** Main thread → Worker (spec 07 §1.1 local mode). Keys travel here and nowhere else. */
export const WorkerInboundSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    request: RunRequestSchema,
    providers: z.array(ProviderConfigSchema),
    keys: z.record(z.string(), z.string()),
    defaultProviderId: z.string().nullable(),
    fastProviderId: z.string().nullable().default(null),
    runtimeUrl: z.string().nullable(),
  }),
  z.object({ type: z.literal('cancel') }),
  /** D14′: the user's reply to a pending `ask` (spec 09 §3.2). */
  AnswerRequestSchema.extend({ type: z.literal('answer') }),
]);
export type WorkerInbound = z.infer<typeof WorkerInboundSchema>;
export type WorkerStart = Extract<WorkerInbound, { type: 'start' }>;

/** Worker → main thread. `error` is for failures outside the core (the core reports its own). */
export const WorkerOutboundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('event'), event: RunEventSchema }),
  z.object({ type: z.literal('end') }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type WorkerOutbound = z.infer<typeof WorkerOutboundSchema>;

export interface WorkerHost {
  handle(message: unknown): Promise<void>;
  readonly running: boolean;
}

export interface WorkerHostOptions {
  /** Injected for tests; the Worker passes `createDefaultDeps` overrides through. */
  deps?: Partial<AgentDeps>;
  onTransportSwitch?(providerId: string): void;
}

/**
 * The Worker's brain, kept free of `self` so it runs in Node tests. One host serves one run:
 * `start` builds the model resolver from the bootstrap and streams the agent's events back,
 * `cancel` aborts it; when the stream ends the host posts `end` and the client terminates the Worker.
 */
/** An agent that can take the user's reply to a pending question (`createLoopAgent`). */
type AnsweringAgent = Agent & { answer(questionId: string, text: string): boolean };
const canAnswer = (agent: Agent): agent is AnsweringAgent =>
  typeof (agent as Partial<AnsweringAgent>).answer === 'function';

export function createWorkerHost(
  post: (message: WorkerOutbound) => void,
  makeAgent: (deps: AgentDeps) => Agent,
  options: WorkerHostOptions = {},
): WorkerHost {
  let controller: AbortController | null = null;
  let agent: Agent | null = null;

  const run = async (start: WorkerStart) => {
    controller = new AbortController();
    const deps = createDefaultDeps({
      ...options.deps,
      model: createModelResolver({
        providers: start.providers,
        keys: start.keys,
        ref: start.request.model,
        defaultProviderId: start.defaultProviderId,
        fastProviderId: start.fastProviderId,
        runtimeUrl: start.runtimeUrl,
        onTransportSwitch: (providerId) => options.onTransportSwitch?.(providerId),
      }),
    });
    try {
      agent = makeAgent(deps);
      const events = agent.run(start.request, { signal: controller.signal });
      for await (const event of events) post({ type: 'event', event: event as RunEvent });
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      controller = null;
      agent = null;
      post({ type: 'end' });
    }
  };

  return {
    get running() {
      return controller !== null;
    },
    async handle(message) {
      const parsed = WorkerInboundSchema.safeParse(message);
      if (!parsed.success) {
        post({ type: 'error', message: 'Malformed worker message' });
        return;
      }
      if (parsed.data.type === 'cancel') {
        controller?.abort();
        return;
      }
      if (parsed.data.type === 'answer') {
        // A stale answer (question already closed, run over) is not a failure of the run.
        if (agent && canAnswer(agent)) agent.answer(parsed.data.questionId, parsed.data.text);
        return;
      }
      if (controller) {
        post({ type: 'error', message: 'A run is already in progress in this worker' });
        return;
      }
      await run(parsed.data);
    },
  };
}
