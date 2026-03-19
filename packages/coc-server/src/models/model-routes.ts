import * as http from 'http';
import type { Route } from '../shared/router.js';
import { sendJson, send500 } from '../shared/router.js';
import type { ModelInfo } from '@plusplusoneplusplus/forge';
import { getAllModels } from '@plusplusoneplusplus/forge';

/** Minimal interface required by this route; allows mock injection in tests. */
export interface ModelStore {
    getAll(): ModelInfo[];
}

/** Dynamic fallback derived from the static model registry. */
function getStaticFallbackModels(): ModelInfo[] {
    return getAllModels().map(m => ({
        id: m.id,
        name: m.label,
        capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: m.contextWindow ?? 128_000 },
        },
    }));
}

/**
 * Register model-related API routes.
 *
 * @param routes  Mutable route array shared by the server.
 * @param store   Model store instance (may be uninitialized).
 */
export function registerModelRoutes(routes: Route[], store: ModelStore): void {
    // -- GET /api/models -------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/models',
        handler: (_req: http.IncomingMessage, res: http.ServerResponse) => {
            try {
                const models = store.getAll();
                sendJson(res, models.length > 0 ? models : getStaticFallbackModels());
            } catch (err) {
                send500(res, err instanceof Error ? err.message : 'Failed to retrieve models');
            }
        },
    });
}
