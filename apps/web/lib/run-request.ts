import type { Diagram } from '@nivik/ir';
import type { RendererId, RunBudget, RunRequestInput, Session } from '@nivik/protocol';
import { resolveModelRef, type Settings } from '@/lib/stores/settings-store';

export interface RunRequestSource {
  /** The IR document the run edits (empty for a fresh canvas). */
  diagram: Diagram;
  prompt: string;
  renderer: RendererId;
  /** Saved (not draft) preferences — what the user has committed with "Save changes". */
  settings: Pick<Settings, 'defaultModel' | 'providers'>;
  /** One-shot model override from the composer; `null`/omitted = saved default. */
  temporaryModel?: string | null;
  /** Cross-run memory over this diagram (design D14′ §4); omitted = first turn. */
  session?: Session;
  /**
   * Whether this host can show a question card and relay the answer (spec 09 §3.2). Until the
   * canvas has one, the loop runs without `ask` and says so in its summary.
   */
  canAsk?: boolean;
  /** Soft budget override (spec 05 §12.5); omitted = protocol defaults. */
  budget?: RunBudget;
}

/**
 * The single place where user preferences become a wire `RunRequest`, so Settings → Canvas plumbing
 * is testable without a browser and the canvas never reaches into the store for run parameters.
 * Generation parameters (temperature, token budget, timeout, retries) and the soft budget are
 * deliberately not sent: the protocol's defaults are the tuned values (a Settings card can override
 * the budget later).
 */
export function buildRunRequest({
  diagram,
  prompt,
  renderer,
  settings,
  temporaryModel,
  session,
  canAsk,
  budget,
}: RunRequestSource): RunRequestInput {
  return {
    diagram,
    prompt,
    // No diagram type travels with the request: the agent classifies the diagram in its plan.
    hints: { renderer },
    model: resolveModelRef(settings, temporaryModel ?? settings.defaultModel),
    ...(session ? { session } : {}),
    capabilities: { runtimeTools: false, ask: canAsk ?? false },
    ...(budget ? { budget } : {}),
  };
}
