import * as http from 'http';
import type { Route } from '../shared/router.js';
import { sendJson, send500 } from '../shared/router.js';
import type { ModelInfo } from '@plusplusoneplusplus/forge';

/** Minimal interface required by this route; allows mock injection in tests. */
export interface ModelStore {
    getAll(): ModelInfo[];
}

/** Static fallback list used when the store has no entries yet. */
const STATIC_FALLBACK_MODELS: ModelInfo[] = [
    {
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: {
            supports: { vision: true, reasoningEffort: false },
            limits: { max_context_window_tokens: 128_000 },
        },
    },
    {
        id: 'gpt-4o-mini',
        name: 'GPT-4o mini',
        capabilities: {
            supports: { vision: true, reasoningEffort: false },
            limits: { max_context_window_tokens: 128_000 },
        },
    },
    {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        capabilities: {
            supports: { vision: true, reasoningEffort: false },
            limits: { max_context_window_tokens: 200_000 },
        },
    },
    {
        id: 'o3-mini',
        name: 'o3-mini',
        capabilities: {
            supports: { vision: false, reasoningEffort: true },
            limits: { max_context_window_tokens: 128_000 },
        },
    },
];

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
                sendJson(res, models.length > 0 ? models : STATIC_FALLBACK_MODELS);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : 'Failed to retrieve models');
            }
        },
    });
}
