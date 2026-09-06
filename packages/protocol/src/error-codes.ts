import { z } from 'zod';

/** Spec 05 §10. Recoverable codes may be retried by the harness; the rest end the run. */
export const RUN_ERROR_CODES = [
  'E_PROVIDER_AUTH',
  'E_PROVIDER_RATE_LIMIT',
  'E_PROVIDER_TIMEOUT',
  'E_PROVIDER_CORS',
  'E_NO_OBJECT',
  'E_NO_CHANGES',
  'E_ALL_REJECTED',
  'E_CONTEXT_TOO_LARGE',
  'E_BUDGET_EXCEEDED',
  'E_CONFLICT',
  'E_ABORTED',
  'E_INTERNAL',
] as const;

export const RunErrorCodeSchema = z.enum(RUN_ERROR_CODES);
export type RunErrorCode = z.infer<typeof RunErrorCodeSchema>;

export const RECOVERABLE_ERROR_CODES: ReadonlySet<RunErrorCode> = new Set<RunErrorCode>([
  'E_PROVIDER_RATE_LIMIT',
  'E_PROVIDER_TIMEOUT',
  'E_PROVIDER_CORS',
  'E_NO_OBJECT',
]);

export function isRecoverable(code: RunErrorCode): boolean {
  return RECOVERABLE_ERROR_CODES.has(code);
}

/** Thrown inside the agent core; the pipeline maps it to a `RunEvent{type:'error'}`. */
export class RunError extends Error {
  readonly code: RunErrorCode;
  readonly recoverable: boolean;

  constructor(code: RunErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RunError';
    this.code = code;
    this.recoverable = isRecoverable(code);
  }
}
