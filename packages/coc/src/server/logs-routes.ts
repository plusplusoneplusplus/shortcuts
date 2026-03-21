/**
 * Logs Routes
 *
 * Registers the /api/logs/* REST and SSE endpoints.
 *
 * GET /api/logs/stream   — SSE: live log streaming (text/event-stream)
 * GET /api/logs/history  — JSON array of buffered log entries, newest-first
 * GET /api/logs/sources  — JSON: configured log sources + status
 *
 * Live streaming uses the in-process EventEmitter from server-log-capture.ts.
 * No log files are required for live streaming; file-based history is optional.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Route } from './types';
import { sendJson } from './router';
import {
    getLogEmitter,
    getLogHistory,
    type LogLevel,
    type LogHistoryOptions,
} from './server-log-capture';

// ============================================================================
// Helpers
// ============================================================================

function sendSseEvent(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseLevel(raw: unknown): LogLevel | undefined {
    const VALID: Set<string> = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
    return typeof raw === 'string' && VALID.has(raw) ? (raw as LogLevel) : undefined;
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all /api/logs/* routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * @param routes  - Shared route table
 * @param logDir  - Optional log file directory (enables "files configured" in /sources)
 */
export function registerLogsRoutes(routes: Route[], logDir?: string): void {

    // ── GET /api/logs/stream ─────────────────────────────────────────────────

    routes.push({
        method: 'GET',
        pattern: '/api/logs/stream',
        handler: async (req: IncomingMessage, res: ServerResponse) => {
            const parsedUrl = url.parse(req.url ?? '', true);
            const minLevel = parseLevel(parsedUrl.query.level);

            // Set SSE headers
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            });
            res.flushHeaders();

            // Send buffered history as initial batch (newest-last order for stream)
            const historyOpts: LogHistoryOptions = { limit: 200 };
            if (minLevel) historyOpts.level = minLevel;
            const history = getLogHistory(historyOpts).reverse(); // oldest-first for initial replay
            if (history.length > 0) {
                sendSseEvent(res, 'history', history);
            }

            // Subscribe to live entries
            let closed = false;
            const logEmitter = getLogEmitter();

            const onEntry = (entry: unknown) => {
                if (closed) return;
                // Level filter
                if (minLevel) {
                    const e = entry as { level: string };
                    const LEVEL_NUM: Record<string, number> = {
                        trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
                    };
                    const VALID_LEVEL_NUM: Record<LogLevel, number> = {
                        trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
                    };
                    if ((LEVEL_NUM[e.level] ?? 0) < VALID_LEVEL_NUM[minLevel]) return;
                }
                sendSseEvent(res, 'log-entry', entry);
            };

            logEmitter.on('log-entry', onEntry);

            // Heartbeat every 15 s
            const heartbeat = setInterval(() => {
                if (!closed) sendSseEvent(res, 'heartbeat', {});
            }, 15_000);

            const cleanup = () => {
                if (closed) return;
                closed = true;
                clearInterval(heartbeat);
                logEmitter.removeListener('log-entry', onEntry);
            };

            req.on('close', cleanup);
            req.on('error', cleanup);
        },
    });

    // ── GET /api/logs/history ────────────────────────────────────────────────

    routes.push({
        method: 'GET',
        pattern: '/api/logs/history',
        handler: async (req: IncomingMessage, res: ServerResponse) => {
            const parsedUrl = url.parse(req.url ?? '', true);
            const opts: LogHistoryOptions = {};

            const level = parseLevel(parsedUrl.query.level);
            if (level) opts.level = level;

            if (typeof parsedUrl.query.component === 'string' && parsedUrl.query.component) {
                opts.component = parsedUrl.query.component;
            }

            if (parsedUrl.query.limit) {
                const n = parseInt(String(parsedUrl.query.limit), 10);
                if (!isNaN(n) && n > 0) opts.limit = Math.min(n, 1000);
            }

            if (typeof parsedUrl.query.before === 'string' && parsedUrl.query.before) {
                opts.before = parsedUrl.query.before;
            }

            if (typeof parsedUrl.query.search === 'string' && parsedUrl.query.search) {
                opts.search = parsedUrl.query.search;
            }

            const entries = getLogHistory(opts);
            sendJson(res, { entries, total: entries.length });
        },
    });

    // ── GET /api/logs/sources ────────────────────────────────────────────────

    routes.push({
        method: 'GET',
        pattern: '/api/logs/sources',
        handler: async (_req: IncomingMessage, res: ServerResponse) => {
            const sources = [
                {
                    id: 'in-process',
                    label: 'In-process (live)',
                    description: 'Real-time log stream from the running server process',
                    active: true,
                    fileConfigured: false,
                },
            ];

            if (logDir) {
                sources.push({
                    id: 'coc-service',
                    label: 'coc-service',
                    description: 'coc-service log file',
                    active: true,
                    fileConfigured: true,
                });
                sources.push({
                    id: 'ai-service',
                    label: 'ai-service',
                    description: 'ai-service log file',
                    active: true,
                    fileConfigured: true,
                });
            }

            sendJson(res, { sources, logDir: logDir ?? null });
        },
    });
}
