/**
 * Timeout Utilities
 *
 * Provides a standard way to apply timeouts to async operations.
 * Produces structured PipelineCoreError with TIMEOUT code.
 */

import { PipelineCoreError, ErrorCode, ErrorMetadata } from '../errors';
import { IsCancelledFn, throwIfCancelled } from './cancellation';

/**
 * Error thrown when an operation times out.
 * Extends PipelineCoreError with TIMEOUT code.
 */
export class TimeoutError extends PipelineCoreError {
    constructor(message: string, meta?: ErrorMetadata) {
        super(message, {
            code: ErrorCode.TIMEOUT,
            meta,
        });
        this.name = 'TimeoutError';
    }
}

/**
 * Options for withTimeout
 */
export interface TimeoutOptions {
    /** Timeout in milliseconds */
    timeoutMs: number;
    /** Optional callback when timeout occurs (before throwing) */
    onTimeout?: () => void;
    /** Optional cancellation check function */
    isCancelled?: IsCancelledFn;
    /** Optional operation name for error messages */
    operationName?: string;
    /** Additional metadata for the timeout error */
    meta?: ErrorMetadata;
}

/**
 * Execute an async function with a timeout.
 *
 * @param fn The async function to execute
 * @param options Timeout configuration
 * @returns Promise resolving to the function's result
 * @throws TimeoutError if the timeout is exceeded
 * @throws CancellationError if cancelled
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *     () => fetchData(),
 *     { timeoutMs: 5000, operationName: 'fetchData' }
 * );
 * ```
 */
export async function withTimeout<T>(
    fn: () => Promise<T>,
    options: TimeoutOptions
): Promise<T> {
    const { timeoutMs, onTimeout, isCancelled, operationName, meta } = options;

    // Check for immediate cancellation
    throwIfCancelled(isCancelled, meta);

    return new Promise<T>((resolve, reject) => {
        let completed = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        // Set up timeout
        timeoutId = setTimeout(() => {
            if (!completed) {
                completed = true;
                onTimeout?.();

                const name = operationName ?? 'Operation';
                reject(
                    new TimeoutError(`${name} timed out after ${timeoutMs}ms`, {
                        ...meta,
                        timeoutMs,
                    })
                );
            }
        }, timeoutMs);

        // Execute the function
        fn()
            .then((result) => {
                if (!completed) {
                    completed = true;
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    resolve(result);
                }
            })
            .catch((error) => {
                if (!completed) {
                    completed = true;
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    reject(error);
                }
            });
    });
}

/**
 * Check if an error is a timeout error
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
    if (error instanceof TimeoutError) {
        return true;
    }
    if (error instanceof PipelineCoreError && error.code === ErrorCode.TIMEOUT) {
        return true;
    }
    return false;
}

/**
 * Create a promise that rejects after a timeout.
 * Useful for Promise.race patterns.
 */
export function createTimeoutPromise(
    timeoutMs: number,
    operationName?: string,
    meta?: ErrorMetadata
): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => {
            const name = operationName ?? 'Operation';
            reject(
                new TimeoutError(`${name} timed out after ${timeoutMs}ms`, {
                    ...meta,
                    timeoutMs,
                })
            );
        }, timeoutMs);
    });
}
