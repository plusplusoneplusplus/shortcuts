/**
 * AI Service Logger
 *
 * Provides a structured Pino logger for the AI/SDK domain.
 * Call `initAIServiceLogger()` once at startup (e.g., when the CoC CLI
 * initialises its root Pino logger). All AI-domain modules import
 * `getAIServiceLogger()` instead of the legacy `getLogger()`.
 *
 * If `initAIServiceLogger()` has never been called, `getAIServiceLogger()`
 * returns a silent (no-op) Pino logger so the module is safe to use in
 * test environments that do not set up logging.
 */

import pino from 'pino';
import { createLogStore, createRootPinoLogger } from './pino-logger';
import type { PinoLoggerOptions } from './pino-logger';

/**
 * Module-level AI service logger instance.
 * Null until `initAIServiceLogger()` is called.
 */
let aiServiceLogger: pino.Logger | null = null;

/**
 * Initialize the AI service logger.
 *
 * @param rootOrOptions - Either an existing Pino root logger or `PinoLoggerOptions`.
 *   - Pino logger: a child logger bound to `store='ai-service'` is derived from it.
 *   - PinoLoggerOptions: a new root logger is created, then a child is derived.
 */
export function initAIServiceLogger(
    rootOrOptions: pino.Logger | PinoLoggerOptions,
): void {
    if (rootOrOptions && typeof (rootOrOptions as pino.Logger).child === 'function') {
        // Existing Pino logger — derive a child bound to the ai-service store
        aiServiceLogger = createLogStore(rootOrOptions as pino.Logger, 'ai-service');
    } else {
        // Options object — create a root logger first, then derive the store child
        const root = createRootPinoLogger(rootOrOptions as PinoLoggerOptions);
        aiServiceLogger = createLogStore(root, 'ai-service');
    }
}

/**
 * Get the AI service logger.
 *
 * Returns the initialized logger when `initAIServiceLogger()` has been called.
 * Falls back to a silent (no-op) Pino logger if not yet initialized, so callers
 * never crash due to a missing logger.
 */
export function getAIServiceLogger(): pino.Logger {
    if (!aiServiceLogger) {
        return pino({ level: 'silent' });
    }
    return aiServiceLogger;
}

/**
 * Create a child logger scoped to a specific AI session.
 *
 * Every log entry produced by the returned logger will carry `{ sessionId }`
 * as a top-level field, making it trivial to filter per-session events from
 * an ndjson log stream.
 *
 * @param sessionId - The session identifier to bind to every log record.
 */
export function createSessionLogger(sessionId: string): pino.Logger {
    return getAIServiceLogger().child({ sessionId });
}
