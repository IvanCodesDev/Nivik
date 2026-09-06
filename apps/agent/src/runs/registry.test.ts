import { describe, expect, it } from 'vitest';
import { RunCapacityError, RunConflictError, RunRegistry } from './registry';

describe('RunRegistry', () => {
  it('tracks the lifecycle from running to done', () => {
    let now = 1_000;
    const registry = new RunRegistry({ now: () => now });
    registry.start('run_00000001');
    expect(registry.get('run_00000001')).toEqual({
      runId: 'run_00000001',
      status: 'running',
      startedAt: 1_000,
      events: 0,
    });
    registry.record('run_00000001', { type: 'status', stage: 'planning' });
    now = 1_500;
    registry.record('run_00000001', { type: 'done', runId: 'run_00000001' });
    expect(registry.get('run_00000001')).toMatchObject({
      status: 'done',
      endedAt: 1_500,
      events: 2,
    });
    expect(registry.counts()).toEqual({ running: 0, retained: 1 });
  });

  it('records error codes and distinguishes aborted runs', () => {
    const registry = new RunRegistry();
    registry.start('run_00000002');
    registry.record('run_00000002', {
      type: 'error',
      code: 'E_PROVIDER_AUTH',
      message: 'nope',
      recoverable: false,
    });
    expect(registry.get('run_00000002')).toMatchObject({
      status: 'error',
      errorCode: 'E_PROVIDER_AUTH',
    });

    const controller = registry.start('run_00000003');
    expect(registry.abort('run_00000003')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    registry.finish('run_00000003');
    expect(registry.get('run_00000003')?.status).toBe('aborted');
    expect(registry.abort('run_00000003')).toBe(false);
  });

  it('ignores recoverable errors as terminal markers', () => {
    const registry = new RunRegistry();
    registry.start('run_00000004');
    registry.record('run_00000004', {
      type: 'error',
      code: 'E_PROVIDER_RATE_LIMIT',
      message: '',
      recoverable: true,
    });
    expect(registry.get('run_00000004')?.status).toBe('running');
  });

  it('rejects duplicates and enforces capacity', () => {
    const registry = new RunRegistry({ maxRunning: 1 });
    registry.start('run_00000005');
    expect(() => registry.start('run_00000005')).toThrow(RunConflictError);
    expect(() => registry.start('run_00000006')).toThrow(RunCapacityError);
  });

  it('sweeps finished runs after the retention window', () => {
    let now = 0;
    const registry = new RunRegistry({ now: () => now, retainMs: 1_000 });
    registry.start('run_00000007');
    registry.record('run_00000007', { type: 'done', runId: 'run_00000007' });
    now = 500;
    registry.sweep();
    expect(registry.get('run_00000007')).toBeDefined();
    now = 1_501;
    registry.sweep();
    expect(registry.get('run_00000007')).toBeUndefined();
  });
});
