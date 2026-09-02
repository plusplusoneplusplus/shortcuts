/**
 * Cancellation checks for async operations, built around the same
 * `isCancelled` callback pattern ConcurrencyLimiter uses.
 */

import { PipelineCoreError, ErrorCode, ErrorMetadata } from '../errors';

/**
 * Carries the CANCELLED code.
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
 * Returns true if the operation should be cancelled.
 */
export type IsCancelledFn = () => boolean;

export function isCancellationError(error: unknown): error is CancellationError {
    return error instanceof CancellationError
        || (error instanceof PipelineCoreError && error.code === ErrorCode.CANCELLED);
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
 * Wraps an external cancellation source as a token.
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
