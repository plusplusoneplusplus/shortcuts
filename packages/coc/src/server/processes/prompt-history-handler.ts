/**
 * Prompt History REST API Handler
 *
 * Serves the user's recent unique initial prompts in a workspace, ordered
 * most-recent first. Powers the up/down arrow history navigation in chat
 * inputs (NewChatArea, FollowUpInputArea, EnqueueDialog).
 *
 * Route: GET /api/prompt-history?workspaceId=<id>&limit=<n>
 * Response: { items: string[] }
 *
 * Errors are silently swallowed: any thrown exception, missing workspaceId,
 * or store without the optional method returns { items: [] } so a hiccup in
 * history navigation never breaks typing.
 */

import * as url from 'url';
import { sendJSON } from '../core/api-handler';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

// ============================================================================
// Types
// ============================================================================

/** Narrow interface for the recent-initial-prompts store method. */
export interface PromptHistoryStore {
    getRecentUserPrompts?(
        workspaceId: string,
        opts?: { limit?: number },
    ): string[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ============================================================================
// Route registration
// ============================================================================

export function registerPromptHistoryRoutes(
    routes: Route[],
    store: ProcessStore | PromptHistoryStore,
): void {
    routes.push({
        method: 'GET',
        pattern: /^\/api\/prompt-history$/,
        handler: async (req, res) => {
            try {
                const parsed = url.parse(req.url || '', true);
                const workspaceId = getStringQuery(parsed.query['workspaceId']);
                if (!workspaceId) {
                    sendJSON(res, 200, { items: [] });
                    return;
                }
                const limit = clampLimit(parseLimit(parsed.query['limit']));
                const fn = (store as PromptHistoryStore).getRecentUserPrompts;
                if (typeof fn !== 'function') {
                    sendJSON(res, 200, { items: [] });
                    return;
                }
                const items = fn.call(store, workspaceId, { limit });
                sendJSON(res, 200, { items: Array.isArray(items) ? items : [] });
            } catch {
                // Never propagate history-lookup failures to the client.
                sendJSON(res, 200, { items: [] });
            }
        },
    });
}

function getStringQuery(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseLimit(value: unknown): number {
    if (typeof value !== 'string' || value.length === 0) return DEFAULT_LIMIT;
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : DEFAULT_LIMIT;
}

function clampLimit(n: number): number {
    if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, Math.floor(n));
}
