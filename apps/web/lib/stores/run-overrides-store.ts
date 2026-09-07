import { create } from 'zustand';

/**
 * Per-session overrides for the next generation. Deliberately not persisted: PRD 5.7 defines the
 * temporary model as "applies to the next generation only", so a reload or a consumed run clears it.
 */
interface RunOverridesState {
  /** A `ProviderConfig.id` to use for the next run; `null` = use the saved default model. */
  temporaryModel: string | null;
  setTemporaryModel: (modelId: string | null) => void;
  /** Returns the override for the run that is starting and clears it. */
  consumeTemporaryModel: () => string | null;
}

export const useRunOverrides = create<RunOverridesState>()((set, get) => ({
  temporaryModel: null,
  setTemporaryModel: (temporaryModel) => set({ temporaryModel }),
  consumeTemporaryModel: () => {
    const { temporaryModel } = get();
    if (temporaryModel !== null) set({ temporaryModel: null });
    return temporaryModel;
  },
}));
