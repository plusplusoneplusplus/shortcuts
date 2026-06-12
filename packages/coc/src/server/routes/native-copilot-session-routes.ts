/**
 * Native GitHub Copilot CLI session routes.
 *
 * Read-only, workspace-scoped views over the current server user's native
 * Copilot CLI session store. Gated by the disabled-by-default
 * `features.nativeCopilotSessions` flag with a live guard so admin toggles
 * take effect without restart. Disabled and unavailable states return
 * HTTP 200 with typed payloads so the dashboard renders non-fatal states.
 */

import * as url from 'url';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound } from '../errors';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import type { NativeCopilotSessionService } from '../native-copilot-sessions/native-copilot-session-service';
import { DEFAULT_NATIVE_SESSION_LIST_LIMIT } from '../native-copilot-sessions/native-copilot-session-service';
import type { NativeSessionWorkspaceScope } from '../native-copilot-sessions/types';
import { parseGitHubRemoteUrl, readGitOriginRemote } from '../work-items/work-item-sync-github-repo';

export interface NativeCopilotSessionRouteContext {
    routes: Route[];
    store: ProcessStore;
    getEnabled: () => boolean;
    service: NativeCopilotSessionService;
    /** Override of workspace `owner/repo` resolution (tests avoid real git calls). */
    resolveWorkspaceRepository?: (workspace: WorkspaceInfo) => string | undefined;
}

function defaultResolveWorkspaceRepository(workspace: WorkspaceInfo): string | undefined {
    if (!workspace.rootPath) {
        return undefined;
    }
    const remote = readGitOriginRemote(workspace.rootPath);
    if (!remote) {
        return undefined;
    }
    const parsed = parseGitHubRemoteUrl(remote);
    return parsed ? `${parsed.owner}/${parsed.repo}` : undefined;
}

function queryString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

function queryNumber(value: unknown): number | undefined {
    const raw = queryString(value);
    if (raw === undefined) {
        return undefined;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
}

export function registerNativeCopilotSessionRoutes(ctx: NativeCopilotSessionRouteContext): void {
    const { routes, store, getEnabled, service } = ctx;
    const resolveRepository = ctx.resolveWorkspaceRepository ?? defaultResolveWorkspaceRepository;

    const buildScope = (workspace: WorkspaceInfo): NativeSessionWorkspaceScope => ({
        rootPath: workspace.rootPath,
        repository: resolveRepository(workspace),
    });

    // GET /api/workspaces/:id/native-copilot-sessions
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/native-copilot-sessions$/,
        handler: async (req, res, match) => {
            const query = url.parse(req.url || '', true).query;
            const limit = queryNumber(query.limit) ?? DEFAULT_NATIVE_SESSION_LIST_LIMIT;
            const offset = queryNumber(query.offset) ?? 0;
            if (!getEnabled()) {
                sendJSON(res, 200, {
                    enabled: false,
                    reason: 'feature-disabled',
                    items: [],
                    total: 0,
                    limit,
                    offset,
                });
                return;
            }
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) { return; }

            const result = service.listSessions(buildScope(workspace), {
                q: queryString(query.q),
                sessionId: queryString(query.sessionId),
                branch: queryString(query.branch),
                from: queryString(query.from),
                to: queryString(query.to),
                limit: queryNumber(query.limit),
                offset: queryNumber(query.offset),
            });

            if (!result.available) {
                sendJSON(res, 200, {
                    enabled: true,
                    available: false,
                    reason: result.reason,
                    items: [],
                    total: 0,
                    limit: result.limit,
                    offset: result.offset,
                });
                return;
            }
            sendJSON(res, 200, {
                enabled: true,
                available: true,
                items: result.items,
                total: result.total,
                searchIndexAvailable: result.searchIndexAvailable,
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
            const result = service.getSession(buildScope(workspace), sessionId);
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
