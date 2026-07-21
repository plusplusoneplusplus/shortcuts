/**
 * Local stub routes for surfaces the container does not run itself.
 *
 * The container has no local queue or notifications — those come from agents via
 * the proxy — so these endpoints return empty shapes. Preferences are persisted
 * as JSON in the container data dir.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedContainerConfig } from '../../config';
import { type RouteTable, sendJson, readBody } from '../http-util';

export function installStubRoutes(table: RouteTable, config: ResolvedContainerConfig): void {
    // Queue stub (container has no local queue — per-agent queues via proxy)
    table.on('GET', '/api/queue', ({ res }) => {
        sendJson(res, { tasks: [], stats: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 } });
    });

    // Queue repos stub
    table.on('GET', '/api/queue/repos', ({ res }) => {
        sendJson(res, { repos: [] });
    });

    // Preferences — persisted as JSON in container data dir (GET / PATCH / PUT)
    table.when(
        (method, url) => url.pathname === '/api/preferences' && (method === 'GET' || method === 'PATCH' || method === 'PUT'),
        async ({ req, res, method }) => {
            const prefsPath = path.join(config.serve.dataDir, 'preferences.json');
            if (method === 'GET') {
                try {
                    sendJson(res, JSON.parse(fs.readFileSync(prefsPath, 'utf8')));
                } catch {
                    sendJson(res, {});
                }
                return;
            }
            // PATCH or PUT — merge into existing prefs
            const body = await readBody(req) as Record<string, unknown>;
            let existing: Record<string, unknown> = {};
            try { existing = JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch { /* first write */ }
            const merged = { ...existing, ...body };
            fs.writeFileSync(prefsPath, JSON.stringify(merged, null, 2));
            sendJson(res, merged);
        },
    );

    // Notifications stub
    table.on('GET', '/api/notifications', ({ res }) => {
        sendJson(res, { notifications: [] });
    });
}
