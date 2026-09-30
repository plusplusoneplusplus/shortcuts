/**
 * Workspace-scoped views over the current server user's native Copilot CLI
 * session store, plus the explicit import action that snapshots one native
 * session into a workspace's CoC chat list. These routes are gated by the
 * disabled-by-default `features.nativeCliSessions` flag with a live guard so
 * admin toggles take effect without restart. Read routes return disabled and
 * unavailable states as HTTP 200 with typed payloads so the dashboard renders
 * non-fatal states; the import route answers 404 / 503 instead.
 */

import * as url from 'url';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { APIError, handleAPIError, notFound } from '../errors';
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
import {
    buildImportedCopilotChatProcess,
    getImportedNativeSessionProcessIds,
} from '../native-copilot-sessions/native-copilot-session-import';

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
    // Serializes imports per (workspace, native session) so concurrent clicks
    // cannot create two chats for the same session.
    const importsInFlight = new Map<string, Promise<{ processId: string; created: boolean }>>();

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

            // `scope=all` serves the import picker: every native session from
            // any cwd, each tagged with the chat it was already imported into.
            const listAll = query.scope === 'all';

            // Dedup: hide native sessions already tracked as CoC processes for
            // this workspace. The Copilot SDK/CLI session id equals the native
            // store id, so a single indexed query yields the exclusion set.
            const excludeSessionIds = listAll ? undefined : store.getSdkSessionIds?.(workspace.id);

            const result = service.listSessions(listAll ? { matchAll: true } : await buildScope(workspace), {
                ...parseListFilters(query),
                excludeSessionIds,
            });

            if (!result.available) {
                sendJSON(res, 200, unavailableListPayload(result.reason, result.limit, result.offset));
                return;
            }
            let items = result.items;
            if (listAll) {
                const imported = await getImportedNativeSessionProcessIds(store, workspace.id);
                items = items.map(item => {
                    const importedProcessId = imported.get(item.id);
                    return importedProcessId ? { ...item, importedProcessId } : item;
                });
            }
            sendJSON(res, 200, {
                enabled: true,
                available: true,
                items,
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

    // POST /api/workspaces/:id/native-copilot-sessions/:sessionId/import
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/native-copilot-sessions\/([^/]+)\/import$/,
        handler: async (_req, res, match) => {
            if (!getEnabled()) {
                handleAPIError(res, notFound('Native Copilot session import'));
                return;
            }
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) { return; }
            const sessionId = decodeURIComponent(match![2]);
            const key = `${workspace.id}\u0000${sessionId}`;

            let pending = importsInFlight.get(key);
            if (!pending) {
                pending = (async () => {
                    const existing = (await getImportedNativeSessionProcessIds(store, workspace.id)).get(sessionId);
                    if (existing) {
                        return { processId: existing, created: false };
                    }
                    // Any native session may be imported into any workspace.
                    const result = service.getSession({ matchAll: true }, sessionId);
                    if (!result.available) {
                        throw new APIError(503, `Native Copilot session store unavailable: ${result.reason}`, result.reason);
                    }
                    if (!result.session) {
                        throw notFound('Native Copilot session');
                    }
                    const proc = buildImportedCopilotChatProcess({
                        workspaceId: workspace.id,
                        workingDirectory: workspace.rootPath,
                        session: result.session,
                    });
                    await store.addProcess(proc);
                    return { processId: proc.id, created: true };
                })().finally(() => importsInFlight.delete(key));
                importsInFlight.set(key, pending);
            }

            try {
                const outcome = await pending;
                sendJSON(res, outcome.created ? 201 : 200, outcome);
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });
}
