/**
 * Destructive/data-movement operations: storage stats preview, data wipe,
 * full export, and import (preview + execute). Wipe and import are guarded by
 * one-time confirmation tokens and broadcast a WebSocket event on success.
 */

import * as url from 'url';
import { parseBody, sendJSON } from '../core/api-handler';
import { badRequest, forbidden, handleAPIError, invalidJSON } from '../errors';
import { exportAllData } from '../storage/data-exporter';
import { importData } from '../storage/data-importer';
import { DataWiper } from '../storage/data-wiper';
import type { CoCExportPayload, ImportMode } from '../storage/export-import-types';
import { validateExportPayload } from '../storage/export-import-types';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { Route } from '../types';
import type { AdminRouteOptions } from './admin-route-types';
import { TokenManager } from './token-manager';

export function registerDataRoutes(routes: Route[], options: AdminRouteOptions): void {
    const { store, dataDir, getWsServer, configFunctions } = options;
    const wiper = new DataWiper(dataDir, store);

    // Route-scoped token managers — isolated per server instance; TTL configurable for tests.
    const routeWipeTokenMgr = new TokenManager(options.tokenTtlMs);
    const routeImportTokenMgr = new TokenManager(options.tokenTtlMs);

    /** Broadcast an admin data event to all connected WebSocket clients. */
    const broadcast = (event: Record<string, unknown>): void => {
        const wsServer: ProcessWebSocketServer | undefined = getWsServer?.();
        if (wsServer) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            wsServer.broadcastProcessEvent(event as any);
        }
    };

    // ------------------------------------------------------------------
    // GET /api/admin/data/wipe-token — Generate a wipe confirmation token
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/data/wipe-token',
        handler: async (_req, res) => {
            const wt = routeWipeTokenMgr.generate();
            sendJSON(res, 200, {
                token: wt.token,
                expiresIn: routeWipeTokenMgr.ttl / 1000,
            });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/admin/data/stats — Get storage statistics (dry-run preview)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/data/stats',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const includeWikis = parsed.query.includeWikis === 'true';

            const summary = await wiper.getDryRunSummary({ includeWikis });
            sendJSON(res, 200, summary);
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/admin/data — Wipe all runtime data
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: '/api/admin/data',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const confirmToken = typeof parsed.query.confirm === 'string' ? parsed.query.confirm : '';
            const includeWikis = parsed.query.includeWikis === 'true';

            if (!confirmToken) {
                return handleAPIError(res, badRequest('Missing confirmation token. GET /api/admin/data/wipe-token first.'));
            }

            if (!routeWipeTokenMgr.validate(confirmToken)) {
                return handleAPIError(res, forbidden('Invalid or expired confirmation token'));
            }

            const result = await wiper.wipeData({ includeWikis });

            // Broadcast wipe event to all WebSocket clients
            broadcast({ type: 'data-wiped', timestamp: Date.now() });

            sendJSON(res, 200, result);
        },
    });

    // ------------------------------------------------------------------
    // GET /api/admin/export — Download full export as JSON attachment
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/export',
        handler: async (_req, res) => {
            const payload = await exportAllData({ store, dataDir, loadConfigFile: configFunctions?.loadConfigFile });
            const body = JSON.stringify(payload);

            // Build filename with current timestamp (colons replaced for FS safety)
            const ts = new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
            const filename = `coc-export-${ts}.json`;

            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': Buffer.byteLength(body),
            });
            res.end(body);
        },
    });

    // ------------------------------------------------------------------
    // GET /api/admin/import-token — Generate an import confirmation token
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/import-token',
        handler: async (_req, res) => {
            const it = routeImportTokenMgr.generate();
            sendJSON(res, 200, {
                token: it.token,
                expiresIn: routeImportTokenMgr.ttl / 1000,
            });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/admin/import/preview — Validate payload and return preview
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/admin/import/preview',
        handler: async (req, res) => {
            let body: unknown;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            const validation = validateExportPayload(body);
            if (!validation.valid) {
                return sendJSON(res, 400, {
                    valid: false,
                    error: validation.error,
                });
            }

            const payload = body as CoCExportPayload;
            sendJSON(res, 200, {
                valid: true,
                preview: {
                    processCount: payload.metadata.processCount,
                    workspaceCount: payload.metadata.workspaceCount,
                    wikiCount: payload.metadata.wikiCount,
                    queueFileCount: payload.metadata.queueFileCount,
                    sampleProcessIds: payload.processes.slice(0, 5).map(p => p.id),
                },
            });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/admin/import — Execute import with token confirmation
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/admin/import',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const confirmToken = typeof parsed.query.confirm === 'string' ? parsed.query.confirm : '';
            const mode: ImportMode = parsed.query.mode === 'merge' ? 'merge' : 'replace';

            if (!confirmToken) {
                return handleAPIError(res, badRequest('Missing confirmation token. GET /api/admin/import-token first.'));
            }

            if (!routeImportTokenMgr.validate(confirmToken)) {
                return handleAPIError(res, forbidden('Invalid or expired confirmation token'));
            }

            let body: unknown;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            const validation = validateExportPayload(body);
            if (!validation.valid) {
                return handleAPIError(res, badRequest(`Invalid payload: ${validation.error}`));
            }

            const payload = body as CoCExportPayload;

            // Rehydrate Date fields lost during JSON round-trip
            for (const proc of payload.processes) {
                if (typeof proc.startTime === 'string') { proc.startTime = new Date(proc.startTime); }
                if (typeof proc.endTime === 'string') { proc.endTime = new Date(proc.endTime); }
            }

            const result = await importData(payload, {
                store,
                dataDir,
                mode,
                wiper,
                getQueueManager: options.getQueueManager,
                getQueuePersistence: options.getQueuePersistence,
            });

            // Broadcast import event to all WebSocket clients
            broadcast({ type: 'data-imported', timestamp: Date.now(), mode });

            sendJSON(res, 200, result);
        },
    });
}
