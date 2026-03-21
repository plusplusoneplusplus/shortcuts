/**
 * Server Log Capture
 *
 * In-process ring buffer + EventEmitter for live server log streaming.
 * All coc-server log calls are captured here so the /api/logs endpoints
 * can serve real-time SSE streams and history without requiring a log file.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
    /** ISO 8601 timestamp */
    ts: string;
    /** Numeric Pino level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal) */
    level: LogLevel;
    /** Source component (http, websocket, queue, ai-service, coc-service, …) */
    component?: string;
    /** Log message */
    msg: string;
    /** Any extra structured fields from the log call */
    [key: string]: unknown;
}

export interface LogHistoryOptions {
    /** Minimum level to include (default: 'trace' = all) */
    level?: LogLevel;
    /** Only include entries from this component */
    component?: string;
    /** Return at most this many entries newest-first (default: 200, max: 1000) */
    limit?: number;
    /** Return only entries with ts < this ISO timestamp */
    before?: string;
    /** Free-text search (case-insensitive match on msg + component) */
    search?: string;
}

// ============================================================================
// Level utilities
// ============================================================================

const LEVEL_NUM: Record<LogLevel, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
};

const NUM_LEVEL: Record<number, LogLevel> = {
    10: 'trace',
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error',
    60: 'fatal',
};

export function levelToNum(level: LogLevel): number {
    return LEVEL_NUM[level] ?? 30;
}

export function numToLevel(num: number): LogLevel {
    return NUM_LEVEL[num] ?? 'info';
}

// ============================================================================
// Ring Buffer
// ============================================================================

const MAX_BUFFER = 1000;
const buffer: LogEntry[] = [];

// ============================================================================
// EventEmitter
// ============================================================================

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

// ============================================================================
// Public API
// ============================================================================

/**
 * Append a structured log entry to the ring buffer and emit it to live SSE clients.
 * Called by the server-logger proxy wrapper.
 */
export function captureEntry(entry: LogEntry): void {
    buffer.push(entry);
    if (buffer.length > MAX_BUFFER) {
        buffer.shift();
    }
    emitter.emit('log-entry', entry);
}

/**
 * Return buffered log entries (newest-last order) with optional filtering.
 * The returned array is always a shallow copy.
 */
export function getLogHistory(opts: LogHistoryOptions = {}): LogEntry[] {
    const minLevel = opts.level ? levelToNum(opts.level) : 0;
    const limit = Math.min(opts.limit ?? 200, 1000);
    const beforeMs = opts.before ? Date.parse(opts.before) : Infinity;
    const search = opts.search?.toLowerCase();

    // Filter newest-first
    const results: LogEntry[] = [];
    for (let i = buffer.length - 1; i >= 0 && results.length < limit; i--) {
        const e = buffer[i];
        if (levelToNum(e.level) < minLevel) continue;
        if (opts.component && e.component !== opts.component) continue;
        const entryMs = Date.parse(e.ts);
        if (entryMs >= beforeMs) continue;
        if (search) {
            const hay = (e.msg + ' ' + (e.component ?? '')).toLowerCase();
            if (!hay.includes(search)) continue;
        }
        results.push(e);
    }
    return results;
}

/**
 * Returns the EventEmitter for live log subscriptions.
 * Subscribers listen for 'log-entry' events with LogEntry payloads.
 */
export function getLogEmitter(): EventEmitter {
    return emitter;
}

/**
 * Clear the in-memory ring buffer (does not delete any log files).
 */
export function clearLogBuffer(): void {
    buffer.splice(0, buffer.length);
}

/**
 * Build a LogEntry from raw Pino bindings and a log call's arguments.
 * Handles the two Pino call forms:
 *   logger.info(msg)
 *   logger.info({ ...mergeObj }, msg)
 */
export function buildLogEntry(
    pinoLevelNum: number,
    bindings: Record<string, unknown>,
    args: unknown[],
): LogEntry | null {
    if (args.length === 0) return null;

    let msg = '';
    let extra: Record<string, unknown> = {};

    if (typeof args[0] === 'string') {
        // logger.info(msg, ...formatArgs)
        msg = args[0] as string;
    } else if (args[0] !== null && typeof args[0] === 'object' && !Buffer.isBuffer(args[0])) {
        // logger.info({ ...mergeObj }, msg)
        const mergeObj = args[0] as Record<string, unknown>;
        msg = typeof args[1] === 'string' ? args[1] : '';
        // Copy merge obj fields (excluding internal Pino keys)
        for (const [k, v] of Object.entries(mergeObj)) {
            if (k !== 'level' && k !== 'time' && k !== 'pid' && k !== 'hostname') {
                extra[k] = v;
            }
        }
    } else {
        return null;
    }

    const level = numToLevel(pinoLevelNum);
    const component = (bindings.component as string | undefined)
        ?? (extra.component as string | undefined);

    const entry: LogEntry = {
        ts: new Date().toISOString(),
        level,
        msg,
    };

    if (component !== undefined) {
        entry.component = component;
    }

    // Copy remaining bindings (excluding internal fields & component already applied)
    for (const [k, v] of Object.entries(bindings)) {
        if (k !== 'component' && k !== 'store') {
            entry[k] = v;
        }
    }
    for (const [k, v] of Object.entries(extra)) {
        if (k !== 'component') {
            entry[k] = v;
        }
    }

    return entry;
}
