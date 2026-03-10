/**
 * Server-scoped Pino logger for coc-server.
 *
 * Provides a set/get pair for injecting a Pino logger from the outside
 * (e.g., the `coc` CLI serve command) while keeping coc-server self-contained
 * and testable — tests can inject a silent logger or a captured stream.
 *
 * Falls back to a silent logger when `setServerLogger()` has not been called,
 * so no crash or output occurs when used without configuration.
 */

import pino from 'pino';

let serverLogger: pino.Logger | null = null;
// Cache the silent fallback so it's not recreated on every call
let silentFallback: pino.Logger | null = null;

/**
 * Inject a Pino logger for use across all coc-server modules.
 * Call this once from the `coc serve` command before the HTTP server starts.
 */
export function setServerLogger(logger: pino.Logger): void {
    serverLogger = logger;
}

/**
 * Returns the active server logger.
 * Falls back to a silent (no-op) logger if `setServerLogger()` was not called.
 */
export function getServerLogger(): pino.Logger {
    if (serverLogger) {
        return serverLogger;
    }
    if (!silentFallback) {
        silentFallback = pino({ level: 'silent' });
    }
    return silentFallback;
}

/** Create a child logger bound to the HTTP request pipeline. */
export function createRequestLogger(): pino.Logger {
    return getServerLogger().child({ component: 'http' });
}

/** Create a child logger bound to the WebSocket subsystem. */
export function createWSLogger(): pino.Logger {
    return getServerLogger().child({ component: 'websocket' });
}

/** Create a child logger bound to the task queue subsystem. */
export function createQueueLogger(): pino.Logger {
    return getServerLogger().child({ component: 'queue' });
}
