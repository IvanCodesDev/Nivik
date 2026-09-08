import { type Agent, type AgentDeps, createDefaultDeps } from '@nivik/agent';
import { createModelResolver } from '@nivik/agent/providers';
import {
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
    runtimeUrl: z.string().nullable(),
  }),
  z.object({ type: z.literal('cancel') }),
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
export function createWorkerHost(
  post: (message: WorkerOutbound) => void,
  makeAgent: (deps: AgentDeps) => Agent,
  options: WorkerHostOptions = {},
): WorkerHost {
  let controller: AbortController | null = null;

  const run = async (start: WorkerStart) => {
    controller = new AbortController();
    const deps = createDefaultDeps({
      ...options.deps,
      model: createModelResolver({
        providers: start.providers,
        keys: start.keys,
        ref: start.request.model,
        defaultProviderId: start.defaultProviderId,
        runtimeUrl: start.runtimeUrl,
        onTransportSwitch: (providerId) => options.onTransportSwitch?.(providerId),
      }),
    });
    try {
      const events = makeAgent(deps).run(start.request, { signal: controller.signal });
      for await (const event of events) post({ type: 'event', event: event as RunEvent });
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      controller = null;
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
      if (controller) {
        post({ type: 'error', message: 'A run is already in progress in this worker' });
        return;
      }
      await run(parsed.data);
    },
  };
}
