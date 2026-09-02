/**
 * Retry of async operations with configurable backoff.
 * Produces a structured PipelineCoreError with the RETRY_EXHAUSTED code.
 */

import { PipelineCoreError, ErrorCode, ErrorMetadata } from '../errors';
import { IsCancelledFn, throwIfCancelled, isCancellationError } from './cancellation';
import { isTimeoutError } from './timeout';

export class RetryExhaustedError extends PipelineCoreError {
    constructor(
        message: string,
        cause?: unknown,
        meta?: ErrorMetadata
    ) {
        super(message, {
            code: ErrorCode.RETRY_EXHAUSTED,
            cause,
            meta,
        });
        this.name = 'RetryExhaustedError';
    }
}

export type BackoffStrategy = 'fixed' | 'exponential' | 'linear';

/**
 * Function called before each retry attempt
 */
export type OnAttemptFn = (attempt: number, maxAttempts: number, lastError?: unknown) => void;

export type RetryOnFn = (error: unknown, attempt: number) => boolean;

export interface RetryOptions {
    /** Maximum number of attempts (including initial attempt). Default: 3 */
    attempts?: number;
    /** Base delay between retries in milliseconds. Default: 1000 */
    delayMs?: number;
    /** Backoff strategy. Default: 'exponential' */
    backoff?: BackoffStrategy;
    /** Maximum delay between retries (caps exponential/linear growth). Default: 30000 */
    maxDelayMs?: number;
    /** Function to determine if error should trigger retry. Default: retry all except cancellation */
    retryOn?: RetryOnFn;
    /** Callback before each attempt */
    onAttempt?: OnAttemptFn;
    /** Optional cancellation check function */
    isCancelled?: IsCancelledFn;
    /** Optional operation name for error messages */
    operationName?: string;
    /** Additional metadata for errors */
    meta?: ErrorMetadata;
}

export const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'retryOn' | 'onAttempt' | 'isCancelled' | 'operationName' | 'meta'>> = {
    attempts: 3,
    delayMs: 1000,
    backoff: 'exponential',
    maxDelayMs: 30000,
};

/**
 * Default retry predicate - retry everything except cancellation errors
 */
export const defaultRetryOn: RetryOnFn = (error: unknown): boolean => {
    return !isCancellationError(error);
};

/**
 * Retry predicate that also retries on timeout
 */
export const retryOnTimeout: RetryOnFn = (error: unknown): boolean => {
    return !isCancellationError(error) && isTimeoutError(error);
};

export function calculateDelay(
    attempt: number,
    baseDelayMs: number,
    backoff: BackoffStrategy,
    maxDelayMs: number
): number {
    let delay: number;

    switch (backoff) {
        case 'fixed':
            delay = baseDelayMs;
            break;
        case 'linear':
            delay = baseDelayMs * attempt;
            break;
        case 'exponential':
        default:
            delay = baseDelayMs * Math.pow(2, attempt - 1);
            break;
    }

    return Math.min(delay, maxDelayMs);
}

/**
 * Execute an async function with retries.
 *
 * @param fn The async function to execute
 * @param options Retry configuration
 * @returns Promise resolving to the function's result
 * @throws RetryExhaustedError if all attempts fail
 * @throws CancellationError if cancelled
 * @throws Original error if retryOn returns false
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *     () => fetchData(),
 *     {
 *         attempts: 3,
 *         delayMs: 1000,
 *         backoff: 'exponential',
 *         onAttempt: (attempt) => console.log(`Attempt ${attempt}`)
 *     }
 * );
 * ```
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options?: RetryOptions
): Promise<T> {
    const {
        attempts = DEFAULT_RETRY_OPTIONS.attempts,
        delayMs = DEFAULT_RETRY_OPTIONS.delayMs,
        backoff = DEFAULT_RETRY_OPTIONS.backoff,
        maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
        retryOn = defaultRetryOn,
        onAttempt,
        isCancelled,
        operationName,
        meta,
    } = options ?? {};

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        // Check for cancellation before each attempt
        throwIfCancelled(isCancelled, { ...meta, attempt, maxAttempts: attempts });

        // Notify about attempt
        onAttempt?.(attempt, attempts, lastError);

        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Check if we should retry
            if (!retryOn(error, attempt)) {
                throw error;
            }

            // Check if we have more attempts
            if (attempt < attempts) {
                const delay = calculateDelay(attempt, delayMs, backoff, maxDelayMs);
                await sleep(delay);
            }
        }
    }

    const name = operationName ?? 'Operation';
    throw new RetryExhaustedError(
        `${name} failed after ${attempts} attempts`,
        lastError,
        {
            ...meta,
            attempt: attempts,
            maxAttempts: attempts,
        }
    );
}

export function isRetryExhaustedError(error: unknown): error is RetryExhaustedError {
    if (error instanceof RetryExhaustedError) {
        return true;
    }
    if (error instanceof PipelineCoreError && error.code === ErrorCode.RETRY_EXHAUSTED) {
        return true;
    }
    return false;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
