/**
 * Admin Provider Routes
 *
 * Per-provider SDK availability checks.
 */

import { sendJSON } from '../core/api-handler';
import type { Route } from '../types';
import type { AdminRouteOptions } from './admin-route-types';

/** Register SDK provider availability route. */
export function registerProviderRoutes(routes: Route[], options: AdminRouteOptions): void {
    // ------------------------------------------------------------------
    // GET /api/admin/providers/availability — per-provider SDK install check
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/providers/availability',
        handler: async (_req, res) => {
            const registry = options.sdkServiceRegistry;
            if (!registry || registry.size === 0) {
                sendJSON(res, 200, {});
                return;
            }
            const result: Record<string, { available: boolean; error?: string }> = {};
            await Promise.all(
                registry.getProviderNames().map(async (name) => {
                    try {
                        const avail = await registry.get(name)!.isAvailable();
                        result[name] = { available: avail.available, ...(avail.error ? { error: avail.error } : {}) };
                    } catch (err) {
                        result[name] = { available: false, error: err instanceof Error ? err.message : String(err) };
                    }
                }),
            );
            sendJSON(res, 200, result);
        },
    });
}
