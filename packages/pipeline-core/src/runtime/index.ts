/**
 * Runtime Module - Public API
 *
 * Exports centralized async policy utilities for timeout, retry, cancellation, and concurrency.
 */

// Cancellation
export {
    CancellationError,
    IsCancelledFn,
    isCancellationError,
    throwIfCancelled,
    createCancellationToken,
} from './cancellation';

// Timeout
export {
    TimeoutError,
    TimeoutOptions,
    withTimeout,
    isTimeoutError,
    createTimeoutPromise,
} from './timeout';

// Retry
export {
    RetryExhaustedError,
    BackoffStrategy,
    OnAttemptFn,
    RetryOnFn,
    RetryOptions,
    DEFAULT_RETRY_OPTIONS,
    defaultRetryOn,
    retryOnTimeout,
    calculateDelay,
    withRetry,
    isRetryExhaustedError,
} from './retry';

// Policy (unified runner)
export {
    PolicyOptions,
    DEFAULT_POLICY_OPTIONS,
    runWithPolicy,
    createPolicyRunner,
} from './policy';
