import type { Diagram } from '@nivik/ir';
import type { RendererId, RunRequestInput } from '@nivik/protocol';
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
}

/**
 * The single place where user preferences become a wire `RunRequest`, so Settings → Canvas plumbing
 * is testable without a browser and the canvas never reaches into the store for run parameters.
 * Generation parameters (temperature, token budget, timeout, retries) are deliberately not sent:
 * the protocol's `RunSettingsSchema` defaults are the runtime's tuned values.
 */
export function buildRunRequest({
  diagram,
  prompt,
  renderer,
  settings,
  temporaryModel,
}: RunRequestSource): RunRequestInput {
  return {
    diagram,
    prompt,
    // No diagram type travels with the request: the agent classifies the diagram in its plan.
    hints: { renderer },
    model: resolveModelRef(settings, temporaryModel ?? settings.defaultModel),
  };
}
