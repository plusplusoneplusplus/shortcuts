/**
 * Server-scoped Pino logger for coc-server.
 *
 * Provides a set/get pair for injecting a Pino logger from the outside
 * (e.g., the `coc` CLI serve command) while keeping coc-server self-contained
 * and testable — tests can inject a silent logger or a captured stream.
 *
 * Falls back to a silent logger when `setServerLogger()` has not been called,
 * so no crash or output occurs when used without configuration.
 *
 * When a logger is injected via setServerLogger(), it is wrapped in a lightweight
 * proxy that intercepts log calls and feeds them into the in-process log capture
 * ring buffer (server-log-capture.ts). This enables /api/logs/stream without
 * requiring log files to be configured.
 */

import pino from 'pino';
import { captureEntry, buildLogEntry } from './server-log-capture';

// ── Level number lookup ────────────────────────────────────────────────────

const PINO_LEVELS: Array<[string, number]> = [
    ['trace', 10],
    ['debug', 20],
    ['info', 30],
    ['warn', 40],
    ['error', 50],
    ['fatal', 60],
];

// ── Proxy factory ──────────────────────────────────────────────────────────

/**
 * Wrap a Pino logger so every log call is also forwarded to the capture buffer.
 * The original logger is called first (preserving all Pino behaviour); capture
 * is best-effort (errors are silently swallowed).
 *
 * @param logger  - The real Pino logger to wrap.
 * @param bindings - Accumulated child bindings (component, store, …).
 */
function wrapForCapture(
    logger: pino.Logger,
    bindings: Record<string, unknown> = {},
): pino.Logger {
    return new Proxy(logger, {
        get(target, prop: string | symbol) {
            // Intercept log-level methods
            const levelEntry = PINO_LEVELS.find(([name]) => name === prop);
            if (levelEntry) {
                const [, levelNum] = levelEntry;
                return (...args: unknown[]) => {
                    // Call original first
                    (target as any)[prop as string](...args);
                    // Capture for ring buffer
                    try {
                        const entry = buildLogEntry(levelNum, bindings, args);
                        if (entry) captureEntry(entry);
                    } catch { /* ignore capture errors */ }
                };
            }

            // Intercept child() so child loggers are also wrapped
            if (prop === 'child') {
                return (childBindings: Record<string, unknown>) => {
                    const childLogger = target.child(childBindings);
                    return wrapForCapture(childLogger, { ...bindings, ...childBindings });
                };
            }

            return (target as any)[prop as string];
        },
    }) as pino.Logger;
}

// ── Module-level state ─────────────────────────────────────────────────────

let serverLogger: pino.Logger | null = null;
// Cache the silent fallback so it's not recreated on every call
let silentFallback: pino.Logger | null = null;

/**
 * Inject a Pino logger for use across all coc-server modules.
 * The logger is wrapped in a capture proxy before storage so all log calls
 * are also forwarded to the in-process log buffer.
 * Call this once from the `coc serve` command before the HTTP server starts.
 */
export function setServerLogger(logger: pino.Logger): void {
    serverLogger = wrapForCapture(logger, {});
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
