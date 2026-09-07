import { beforeEach, describe, expect, it } from 'vitest';
import { useRunOverrides } from './run-overrides-store';

describe('useRunOverrides', () => {
  beforeEach(() => useRunOverrides.setState({ temporaryModel: null }));

  it('starts with no temporary model', () => {
    expect(useRunOverrides.getState().temporaryModel).toBeNull();
  });

  it('hands the temporary model to exactly one run', () => {
    useRunOverrides.getState().setTemporaryModel('p1');
    expect(useRunOverrides.getState().consumeTemporaryModel()).toBe('p1');
    expect(useRunOverrides.getState().temporaryModel).toBeNull();
    expect(useRunOverrides.getState().consumeTemporaryModel()).toBeNull();
  });

  it('treats the "use default" sentinel as clearing the override', () => {
    useRunOverrides.getState().setTemporaryModel('p1');
    useRunOverrides.getState().setTemporaryModel(null);
    expect(useRunOverrides.getState().temporaryModel).toBeNull();
  });
});
