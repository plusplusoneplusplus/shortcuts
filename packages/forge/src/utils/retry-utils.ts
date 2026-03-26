/**
 * Retry utilities for pipeline execution.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

export interface RetryPolicy {
    maxAttempts: number;
    shouldRetry?: (error: unknown) => boolean;
}

/**
 * Execute a function with retry logic based on the provided policy.
 *
 * @param fn - Function to execute; receives the attempt index (0-based).
 * @param policy - Retry policy (maxAttempts, optional shouldRetry predicate).
 * @returns Resolves with the function's result on success.
 * @throws The last error thrown by `fn` when all attempts are exhausted.
 */
export async function withRetry<T>(
    fn: (attempt: number) => Promise<T>,
    policy: RetryPolicy
): Promise<T> {
    const { maxAttempts, shouldRetry } = policy;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn(attempt);
        } catch (error) {
            lastError = error;
            const hasMoreAttempts = attempt < maxAttempts - 1;
            const canRetry = hasMoreAttempts && (shouldRetry === undefined || shouldRetry(error));
            if (!canRetry) {
                throw error;
            }
        }
    }

    // Unreachable in practice; ensures TypeScript sees a definite return/throw.
    throw lastError;
}
