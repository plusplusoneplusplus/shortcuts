/**
 * Admin System Routes
 *
 * Build version reporting and server restart.
 */

import { sendJSON } from '../core/api-handler';
import type { Route } from '../types';
import type { AdminRouteOptions } from './admin-route-types';

/** Register version + restart routes. */
export function registerSystemRoutes(routes: Route[], options: AdminRouteOptions): void {
    // ------------------------------------------------------------------
    // GET /api/admin/version — Return build version and commit hash
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/version',
        handler: async (_req, res) => {
            let commit = 'dev';
            let version = 'dev';
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const info = require('../core/build-info');
                commit = info.BUILD_COMMIT ?? 'dev';
                version = info.BUILD_VERSION ?? 'dev';
            } catch {
                // build-info.ts not generated yet (dev mode) — fall back gracefully
            }
            sendJSON(res, 200, { version, commit });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/admin/restart — Rebuild & restart the server
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/admin/restart',
        handler: async (_req, res) => {
            const exitCode = options.restartExitCode ?? 75;
            sendJSON(res, 200, { message: 'Server is restarting...' });

            // Give the response time to flush, then exit with the restart code
            setTimeout(() => {
                process.exit(exitCode);
            }, 200);
        },
    });
}
