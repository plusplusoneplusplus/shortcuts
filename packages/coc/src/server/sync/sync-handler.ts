/**
 * REST handler for the sync subsystem.
 *
 * POST /api/sync/trigger  — force an immediate sync
 * GET  /api/sync/status   — current sync status
 */

import type { Route } from '../types';
import type { SyncEngine } from './sync-engine';
import type { ResolvedCLIConfig } from '../../config';

export function registerSyncRoutes(
    routes: Route[],
    getSyncEngine: () => SyncEngine | undefined,
    getConfig: () => ResolvedCLIConfig | undefined,
): void {
    routes.push({
        method: 'GET',
        path: '/api/sync/status',
        handler: (_req, res) => {
            const engine = getSyncEngine();
            if (!engine) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    enabled: false,
                    inProgress: false,
                    lastSyncTime: null,
                    lastError: null,
                }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(engine.getStatus()));
        },
    });

    routes.push({
        method: 'POST',
        path: '/api/sync/trigger',
        handler: async (_req, res) => {
            const engine = getSyncEngine();
            const config = getConfig();
            if (!engine || !config?.sync?.gitRemote) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Sync is not configured' }));
                return;
            }

            try {
                const status = await engine.triggerSync(config.sync.gitRemote);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(status));
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: message }));
            }
        },
    });
}
