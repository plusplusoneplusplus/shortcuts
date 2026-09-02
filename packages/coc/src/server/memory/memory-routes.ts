/**
 * Registers all /api/memory/* REST endpoints.
 *
 * GET  /api/memory/config          — read config
 * PUT  /api/memory/config          — write config
 */

import type { Route } from '../types';
import { handleGetMemoryConfig, handlePutMemoryConfig } from './memory-config-handler';

// ============================================================================
// Registration
// ============================================================================

/**
 * Mutates the `routes` array in-place.
 *
 * @param dataDir - CoC data directory (e.g. ~/.coc)
 */
export function registerMemoryRoutes(routes: Route[], dataDir: string): void {

    // -- Config endpoints ----------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: '/api/memory/config',
        handler: async (req, res) => {
            handleGetMemoryConfig(req, res, dataDir);
        },
    });

    routes.push({
        method: 'PUT',
        pattern: '/api/memory/config',
        handler: async (req, res) => {
            await handlePutMemoryConfig(req, res, dataDir);
        },
    });
}
