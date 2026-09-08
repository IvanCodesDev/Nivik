import { RunError } from '@nivik/protocol';
import { APICallError, NoObjectGeneratedError } from 'ai';
import { redact } from '../harness/redact';
import { isCorsFailure } from './transport';

const TIMEOUT_STATUSES = new Set([408, 504]);

/**
 * Spec 05 §10: normalises whatever a provider call throws into a `RunError` with the code the
 * recovery policy keys on. Messages are redacted because vendors echo request headers back.
 */
export function toProviderError(error: unknown): RunError {
  if (error instanceof RunError) return error;

  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? 0;
    const message = redact(`Provider responded ${status || 'with an error'}: ${error.message}`);
    if (status === 401 || status === 403)
      return new RunError('E_PROVIDER_AUTH', message, { cause: error });
    if (status === 429) return new RunError('E_PROVIDER_RATE_LIMIT', message, { cause: error });
    if (TIMEOUT_STATUSES.has(status))
      return new RunError('E_PROVIDER_TIMEOUT', message, { cause: error });
    return new RunError('E_INTERNAL', message, { cause: error });
  }

  if (NoObjectGeneratedError.isInstance(error)) {
    return new RunError('E_NO_OBJECT', redact(error.message), { cause: error });
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError')
      return new RunError('E_ABORTED', 'Run cancelled', { cause: error });
    if (error.name === 'TimeoutError') {
      return new RunError('E_PROVIDER_TIMEOUT', 'The provider did not answer in time', {
        cause: error,
      });
    }
    if (isCorsFailure(error)) {
      return new RunError(
        'E_PROVIDER_CORS',
        'The provider could not be reached from the browser (network or CORS)',
        { cause: error },
      );
    }
    return new RunError('E_INTERNAL', redact(error.message || error.name), { cause: error });
  }

  return new RunError(
    'E_INTERNAL',
    typeof error === 'string' ? redact(error) : 'Unknown provider error',
  );
}
