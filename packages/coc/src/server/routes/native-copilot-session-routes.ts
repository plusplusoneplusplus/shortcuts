/**
 * Read-only, workspace-scoped views over the current server user's native
 * Copilot CLI session store. These compatibility routes are gated by the
 * disabled-by-default `features.nativeCliSessions` flag with a live guard so
 * admin toggles take effect without restart. Disabled and unavailable states return
 * HTTP 200 with typed payloads so the dashboard renders non-fatal states.
 */

import * as url from 'url';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound } from '../errors';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { NativeCopilotSessionService } from '../native-copilot-sessions/native-copilot-session-service';
import { DEFAULT_NATIVE_SESSION_LIST_LIMIT } from '../native-copilot-sessions/native-copilot-session-service';
import {
    createScopeBuilder,
    featureDisabledListPayload,
    parseListFilters,
    queryNumber,
    unavailableListPayload,
} from './native-session-route-utils';
import type { ResolveWorkspaceRepository } from './native-session-route-utils';

export interface NativeCopilotSessionRouteContext {
    routes: Route[];
    store: ProcessStore;
    getEnabled: () => boolean;
    service: NativeCopilotSessionService;
    /** Override of workspace `owner/repo` resolution (tests avoid real git calls). */
    resolveWorkspaceRepository?: ResolveWorkspaceRepository;
}

export function registerNativeCopilotSessionRoutes(ctx: NativeCopilotSessionRouteContext): void {
    const { routes, store, getEnabled, service } = ctx;
    const buildScope = createScopeBuilder(ctx.resolveWorkspaceRepository);

    // GET /api/workspaces/:id/native-copilot-sessions
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/native-copilot-sessions$/,
        handler: async (req, res, match) => {
            const query = url.parse(req.url || '', true).query;
            const limit = queryNumber(query.limit) ?? DEFAULT_NATIVE_SESSION_LIST_LIMIT;
            const offset = queryNumber(query.offset) ?? 0;
            if (!getEnabled()) {
                sendJSON(res, 200, featureDisabledListPayload(limit, offset));
                return;
            }
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) { return; }

            // Dedup: hide native sessions already tracked as CoC processes for
            // this workspace. The Copilot SDK/CLI session id equals the native
            // store id, so a single indexed query yields the exclusion set.
            const excludeSessionIds = store.getSdkSessionIds?.(workspace.id);

            const result = service.listSessions(await buildScope(workspace), {
                ...parseListFilters(query),
                excludeSessionIds,
            });

            if (!result.available) {
                sendJSON(res, 200, unavailableListPayload(result.reason, result.limit, result.offset));
                return;
            }
            sendJSON(res, 200, {
                enabled: true,
                available: true,
                items: result.items,
                total: result.total,
                searchIndexAvailable: result.searchIndexAvailable,
                deduplicatedCount: result.deduplicatedCount,
                backgroundJobCount: result.backgroundJobCount,
                limit: result.limit,
                offset: result.offset,
            });
        },
    });

    // GET /api/workspaces/:id/native-copilot-sessions/:sessionId
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/native-copilot-sessions\/([^/]+)$/,
        handler: async (_req, res, match) => {
            if (!getEnabled()) {
                sendJSON(res, 200, { enabled: false, reason: 'feature-disabled' });
                return;
            }
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) { return; }

            const sessionId = decodeURIComponent(match![2]);
            const result = service.getSession(await buildScope(workspace), sessionId);
            if (!result.available) {
                sendJSON(res, 200, { enabled: true, available: false, reason: result.reason });
                return;
            }
            if (!result.session) {
                handleAPIError(res, notFound('Native Copilot session'));
                return;
            }
            sendJSON(res, 200, { enabled: true, available: true, session: result.session });
        },
    });
}
