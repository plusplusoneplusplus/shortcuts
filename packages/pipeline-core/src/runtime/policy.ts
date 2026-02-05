/**
 * Policy Runner
 *
 * Composes timeout, retry, and cancellation into a single unified policy.
 * This is the top-level API for running operations with cross-cutting concerns.
 */

import { ErrorMetadata } from '../errors';
import { IsCancelledFn, throwIfCancelled } from './cancellation';
import { withTimeout, TimeoutOptions } from './timeout';
import { withRetry, RetryOptions, BackoffStrategy } from './retry';

/**
 * Unified policy options combining timeout, retry, and cancellation
 */
export interface PolicyOptions {
    // =========================================================================
    // Timeout Configuration
    // =========================================================================
    /** Timeout in milliseconds for each attempt (not total). Optional. */
    timeoutMs?: number;

    // =========================================================================
    // Retry Configuration
    // =========================================================================
    /** Whether to retry on failure. Default: false */
    retryOnFailure?: boolean;
    /** Number of retry attempts (including initial). Default: 3 when retryOnFailure is true */
    retryAttempts?: number;
    /** Base delay between retries in milliseconds. Default: 1000 */
    retryDelayMs?: number;
    /** Backoff strategy. Default: 'exponential' */
    backoff?: BackoffStrategy;
    /** Maximum delay between retries. Default: 30000 */
    maxRetryDelayMs?: number;

    // =========================================================================
    // Cancellation Configuration
    // =========================================================================
    /** Function to check if operation should be cancelled */
    isCancelled?: IsCancelledFn;

    // =========================================================================
    // Metadata
    // =========================================================================
    /** Operation name for error messages */
    operationName?: string;
    /** Additional metadata for errors */
    meta?: ErrorMetadata;
}

/** Default policy options */
export const DEFAULT_POLICY_OPTIONS: Partial<PolicyOptions> = {
    retryOnFailure: false,
    retryAttempts: 3,
    retryDelayMs: 1000,
    backoff: 'exponential',
    maxRetryDelayMs: 30000,
};

/**
 * Run an async function with a unified policy for timeout, retry, and cancellation.
 *
 * The policy applies in this order:
 * 1. Check for cancellation before starting
 * 2. If retry is enabled, wrap with retry logic
 * 3. For each attempt, if timeout is specified, wrap with timeout
 *
 * @param fn The async function to execute
 * @param options Policy configuration
 * @returns Promise resolving to the function's result
 *
 * @example
 * ```typescript
 * // Simple timeout
 * const result = await runWithPolicy(
 *     () => fetchData(),
 *     { timeoutMs: 5000 }
 * );
 *
 * // Timeout with retry
 * const result = await runWithPolicy(
 *     () => fetchData(),
 *     {
 *         timeoutMs: 5000,
 *         retryOnFailure: true,
 *         retryAttempts: 3,
 *         backoff: 'exponential'
 *     }
 * );
 *
 * // With cancellation
 * const result = await runWithPolicy(
 *     () => fetchData(),
 *     {
 *         timeoutMs: 5000,
 *         isCancelled: () => shouldCancel
 *     }
 * );
 * ```
 */
export async function runWithPolicy<T>(
    fn: () => Promise<T>,
    options?: PolicyOptions
): Promise<T> {
    const {
        timeoutMs,
        retryOnFailure = false,
        retryAttempts = 3,
        retryDelayMs = 1000,
        backoff = 'exponential',
        maxRetryDelayMs = 30000,
        isCancelled,
        operationName,
        meta,
    } = options ?? {};

    // Check for immediate cancellation
    throwIfCancelled(isCancelled, meta);

    // Build the execution function with timeout if specified
    const executeWithTimeout = timeoutMs
        ? () =>
            withTimeout(fn, {
                timeoutMs,
                isCancelled,
                operationName,
                meta,
            } as TimeoutOptions)
        : fn;

    // If retry is enabled, wrap with retry
    if (retryOnFailure) {
        return withRetry(executeWithTimeout, {
            attempts: retryAttempts,
            delayMs: retryDelayMs,
            backoff,
            maxDelayMs: maxRetryDelayMs,
            isCancelled,
            operationName,
            meta,
        } as RetryOptions);
    }

    // Just execute (possibly with timeout)
    return executeWithTimeout();
}

/**
 * Create a policy runner with pre-configured defaults.
 * Useful for creating consistent policies across a module.
 *
 * @example
 * ```typescript
 * const aiPolicy = createPolicyRunner({
 *     timeoutMs: 30000,
 *     retryOnFailure: true,
 *     retryAttempts: 2,
 *     operationName: 'AI Invocation'
 * });
 *
 * // Later use:
 * const result = await aiPolicy(() => invokeAI(prompt));
 * ```
 */
export function createPolicyRunner(
    defaultOptions: PolicyOptions
): <T>(fn: () => Promise<T>, overrides?: Partial<PolicyOptions>) => Promise<T> {
    return <T>(fn: () => Promise<T>, overrides?: Partial<PolicyOptions>) =>
        runWithPolicy(fn, { ...defaultOptions, ...overrides });
}
