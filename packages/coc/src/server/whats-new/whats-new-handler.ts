/**
 * HTTP routes for the "What's New" release-notes modal.
 *
 *   GET  /api/whats-new       — is there unseen release content for this version?
 *   POST /api/whats-new/ack   — record a version as seen.
 *
 * Both are deliberately forgiving: the SPA calls them on every dashboard load,
 * and nothing here may block startup or surface an error to the user.
 */

import { sendJSON } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import { WhatsNewService } from './whats-new-service';

export function registerWhatsNewRoutes(routes: Route[], service: WhatsNewService): void {
    routes.push({
        method: 'GET',
        pattern: /^\/api\/whats-new$/,
        handler: async (_req, res) => {
            const status = await service.getStatus();
            sendJSON(res, 200, status);
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/whats-new\/ack$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const version = typeof body.version === 'string' ? body.version.trim() : '';
            if (!version) {
                sendJSON(res, 400, { error: 'Missing or invalid "version" string' });
                return;
            }
            await service.ack(version);
            sendJSON(res, 200, { ok: true });
        },
    });
}
