/**
 * Cancellation Utilities
 *
 * Provides a standard way to check for and handle cancellation across async operations.
 * Works with the existing ConcurrencyLimiter's isCancelled pattern.
 */

import { PipelineCoreError, ErrorCode, ErrorMetadata } from '../errors';

/**
 * Error thrown when an operation is cancelled.
 * Extends PipelineCoreError with CANCELLED code.
 */
export class CancellationError extends PipelineCoreError {
    constructor(message = 'Operation cancelled', meta?: ErrorMetadata) {
        super(message, {
            code: ErrorCode.CANCELLED,
            meta,
        });
        this.name = 'CancellationError';
    }
}

/**
 * Function type for cancellation check.
 * Returns true if the operation should be cancelled.
 */
export type IsCancelledFn = () => boolean;

/**
 * Check if an error is a cancellation error
 */
export function isCancellationError(error: unknown): error is CancellationError {
    if (error instanceof CancellationError) {
        return true;
    }
    if (error instanceof PipelineCoreError && error.code === ErrorCode.CANCELLED) {
        return true;
    }
    return false;
}

/**
 * Throws CancellationError if the operation has been cancelled.
 * Use at strategic points in long-running operations.
 *
 * @param isCancelled Optional function to check cancellation status
 * @param meta Optional metadata to include in the error
 * @throws CancellationError if cancelled
 */
export function throwIfCancelled(
    isCancelled?: IsCancelledFn,
    meta?: ErrorMetadata
): void {
    if (isCancelled?.()) {
        throw new CancellationError('Operation cancelled', meta);
    }
}

/**
 * Create a cancellation token from a function.
 * Useful for wrapping external cancellation sources.
 */
export function createCancellationToken(isCancelled?: IsCancelledFn): {
    isCancelled: IsCancelledFn;
    throwIfCancelled: (meta?: ErrorMetadata) => void;
} {
    const fn: IsCancelledFn = isCancelled ?? (() => false);
    return {
        isCancelled: fn,
        throwIfCancelled: (meta?: ErrorMetadata) => throwIfCancelled(fn, meta),
    };
}
