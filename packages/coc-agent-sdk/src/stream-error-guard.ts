/**
 * StreamErrorGuard — absorbs ERR_STREAM_DESTROYED process-level errors.
 *
 * The Copilot SDK's `connectViaStdio()` installs an `error` listener on the
 * child process's stdin that re-throws when `forceStopping` is false.
 * When the CLI process exits unexpectedly, any subsequent JSON-RPC write
 * triggers this re-throw, which surfaces as either an uncaught exception or
 * an unhandled promise rejection.  Both variants are silently absorbed here so
 * the per-session error-return path in the caller can surface them gracefully.
 */

import { getAIServiceLogger } from './logger';

// ============================================================================
// Error-pattern constants
// ============================================================================

const STREAM_DESTROYED_PATTERNS = [
    'stream was destroyed',
    'ERR_STREAM_DESTROYED',
    'cannot call write after a stream was destroyed',
    'EPIPE',
    'ECONNRESET',
];

const CONNECTION_DISPOSED_PATTERNS = [
    'Connection is disposed',
    'connection closed',
    'Connection got disposed',
];

// ============================================================================
// Standalone helpers (exported for use in RequestRunner / facade)
// ============================================================================

/**
 * Returns true when an error message indicates the underlying JSON-RPC stream
 * has been destroyed (broken pipe, reset, etc.).
 */
export function isStreamDestroyedError(errorMessage: string): boolean {
    const lower = errorMessage.toLowerCase();
    return STREAM_DESTROYED_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

/**
 * Returns true when an error indicates a disposed/closed JSON-RPC connection.
 */
export function isConnectionDisposedError(error: unknown): boolean {
    if (error instanceof Error) {
        const msg = error.message;
        if (CONNECTION_DISPOSED_PATTERNS.some(p => msg.includes(p))) return true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ('code' in error && (error as any).code === 2) return true;
    }
    return false;
}

// ============================================================================
// StreamErrorGuard class
// ============================================================================

/**
 * Manages process-level `uncaughtException` and `unhandledRejection` handlers
 * that absorb `ERR_STREAM_DESTROYED` errors originating from the SDK's stdio layer.
 *
 * Call `install()` once when the SDK is first loaded, and `remove()` on cleanup
 * or dispose to avoid accumulating stale listeners across singleton cycles.
 */
export class StreamErrorGuard {
    /** Active `uncaughtException` handler, or `null` when not installed. */
    handler: ((err: Error) => void) | null = null;

    /** Active `unhandledRejection` handler, or `null` when not installed. */
    rejectionHandler: ((reason: unknown) => void) | null = null;

    /**
     * Install both process-level error guards.
     * Idempotent: removes any previously installed guard first.
     */
    install(): void {
        this.remove();
        const aiLog = getAIServiceLogger();

        this.handler = (err: Error) => {
            if (isStreamDestroyedError(err.message || String(err))) {
                aiLog.debug({ errMessage: err.message }, 'Absorbed uncaught stream error');
                return;
            }
            throw err;
        };
        process.on('uncaughtException', this.handler);

        this.rejectionHandler = (reason: unknown) => {
            const msg = reason instanceof Error
                ? (reason.message || String(reason))
                : String(reason);
            if (isStreamDestroyedError(msg)) {
                aiLog.debug({ errMessage: msg }, 'Absorbed unhandled stream rejection');
                return;
            }
            // Not ours — let Node.js default unhandled-rejection handling run.
        };
        process.on('unhandledRejection', this.rejectionHandler);
    }

    /** Remove both process-level error guards. No-op when not installed. */
    remove(): void {
        if (this.handler) {
            process.removeListener('uncaughtException', this.handler);
            this.handler = null;
        }
        if (this.rejectionHandler) {
            process.removeListener('unhandledRejection', this.rejectionHandler);
            this.rejectionHandler = null;
        }
    }
}
