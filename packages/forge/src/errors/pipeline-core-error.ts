/**
 * PipelineCoreError
 *
 * Base error class for all pipeline-core errors.
 * Provides structured error information with:
 * - code: Well-known error code for programmatic handling
 * - cause: Original error that caused this error (error chaining)
 * - meta: Additional context metadata
 */

import { ErrorCode, ErrorCodeType, mapSystemErrorCode } from './error-codes';
import { getLogger, LogCategory } from '../logger';

/**
 * Metadata that can be attached to errors for debugging and telemetry
 */
export interface ErrorMetadata {
    /** Unique identifier for the execution context */
    executionId?: string;
    /** Phase where the error occurred (input, filter, map, reduce) */
    phase?: string;
    /** Task identifier for queue operations */
    taskId?: string;
    /** Timeout value that was exceeded */
    timeoutMs?: number;
    /** Retry attempt number */
    attempt?: number;
    /** Maximum retry attempts configured */
    maxAttempts?: number;
    /** Item index in a batch operation */
    itemIndex?: number;
    /** Total items in a batch operation */
    totalItems?: number;
    /** File path related to the error */
    filePath?: string;
    /** Additional custom metadata */
    [key: string]: unknown;
}

/**
 * Base error class for pipeline-core package.
 *
 * @example
 * ```typescript
 * throw new PipelineCoreError('Failed to parse CSV', {
 *     code: ErrorCode.CSV_PARSE_ERROR,
 *     cause: originalError,
 *     meta: { filePath: 'input.csv', line: 42 }
 * });
 * ```
 */
export class PipelineCoreError extends Error {
    /** Well-known error code for programmatic handling */
    readonly code: ErrorCodeType;

    /** Original error that caused this error */
    readonly cause?: unknown;

    /** Additional context metadata */
    readonly meta?: ErrorMetadata;

    constructor(
        message: string,
        options?: {
            code?: ErrorCodeType;
            cause?: unknown;
            meta?: ErrorMetadata;
        }
    ) {
        super(message);

        this.name = 'PipelineCoreError';
        this.code = options?.code ?? ErrorCode.UNKNOWN;
        this.cause = options?.cause;
        this.meta = options?.meta;

        // Ensure proper prototype chain for instanceof checks
        Object.setPrototypeOf(this, new.target.prototype);
    }

    /**
     * Get a formatted string representation including code and metadata
     */
    toDetailedString(): string {
        const parts = [`[${this.code}] ${this.message}`];

        if (this.meta && Object.keys(this.meta).length > 0) {
            parts.push(`Meta: ${JSON.stringify(this.meta)}`);
        }

        if (this.cause instanceof Error) {
            parts.push(`Caused by: ${this.cause.message}`);
        } else if (this.cause !== undefined) {
            parts.push(`Caused by: ${String(this.cause)}`);
        }

        return parts.join('\n');
    }

    /**
     * Convert to a plain object for serialization
     */
    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            meta: this.meta,
            cause: this.cause instanceof Error
                ? { name: this.cause.name, message: this.cause.message }
                : this.cause,
            stack: this.stack,
        };
    }
}

/**
 * Type guard to check if an error is a PipelineCoreError
 */
export function isPipelineCoreError(error: unknown): error is PipelineCoreError {
    return error instanceof PipelineCoreError;
}

/**
 * Convert any error to a PipelineCoreError.
 * If already a PipelineCoreError, returns as-is.
 * Otherwise wraps the error with appropriate code detection.
 */
export function toPipelineCoreError(
    error: unknown,
    defaultCode: ErrorCodeType = ErrorCode.UNKNOWN,
    meta?: ErrorMetadata
): PipelineCoreError {
    // Already a PipelineCoreError
    if (isPipelineCoreError(error)) {
        // Merge additional meta if provided
        if (meta) {
            return new PipelineCoreError(error.message, {
                code: error.code,
                cause: error.cause,
                meta: { ...error.meta, ...meta },
            });
        }
        return error;
    }

    // Regular Error
    if (error instanceof Error) {
        // Try to detect code from Node.js system errors
        const nodeCode = (error as NodeJS.ErrnoException).code;
        const detectedCode = nodeCode ? mapSystemErrorCode(nodeCode) : defaultCode;

        return new PipelineCoreError(error.message, {
            code: detectedCode !== ErrorCode.UNKNOWN ? detectedCode : defaultCode,
            cause: error,
            meta,
        });
    }

    // String or other primitive
    const message = typeof error === 'string' ? error : String(error);
    return new PipelineCoreError(message, {
        code: defaultCode,
        cause: error,
        meta,
    });
}

/**
 * Wrap an error with a new message while preserving the original as cause.
 * Useful for adding context at different layers.
 */
export function wrapError(
    message: string,
    cause: unknown,
    code?: ErrorCodeType,
    meta?: ErrorMetadata
): PipelineCoreError {
    // If cause is already a PipelineCoreError, preserve its code unless overridden
    const causeError = isPipelineCoreError(cause) ? cause : undefined;
    const effectiveCode = code ?? causeError?.code ?? ErrorCode.UNKNOWN;
    const effectiveMeta = meta ?? causeError?.meta;

    return new PipelineCoreError(message, {
        code: effectiveCode,
        cause,
        meta: effectiveMeta,
    });
}

/**
 * Extract a human-readable message from an error's cause chain
 */
export function getErrorCauseMessage(error: unknown, maxDepth = 5): string {
    const messages: string[] = [];
    let current: unknown = error;
    let depth = 0;

    while (current && depth < maxDepth) {
        if (current instanceof Error) {
            messages.push(current.message);
            // Only PipelineCoreError has cause property in ES2020
            current = (current as PipelineCoreError).cause;
        } else if (typeof current === 'string') {
            messages.push(current);
            break;
        } else {
            messages.push(String(current));
            break;
        }
        depth++;
    }

    return messages.join(' -> ');
}

/**
 * Log an error with structured information.
 * Uses the global logger and formats PipelineCoreError specially.
 */
export function logError(
    category: string,
    message: string,
    error: unknown
): void {
    const logger = getLogger();

    if (isPipelineCoreError(error)) {
        const details = [
            `[${error.code}]`,
            error.message,
        ];

        if (error.meta && Object.keys(error.meta).length > 0) {
            details.push(`(${JSON.stringify(error.meta)})`);
        }

        logger.error(category, `${message}: ${details.join(' ')}`, error);
    } else if (error instanceof Error) {
        logger.error(category, `${message}: ${error.message}`, error);
    } else {
        logger.error(category, `${message}: ${String(error)}`);
    }
}

// Re-export for convenience
export { ErrorCode, ErrorCodeType, mapSystemErrorCode } from './error-codes';
