/**
 * Unified native CLI session routes.
 *
 * Read-only, workspace-scoped views over native Copilot, Codex, and Claude Code
 * CLI session stores. The route delegates all provider-specific store access to
 * short-lived read-only providers and never mutates external CLI data.
 */

import * as url from 'url';
import * as http from 'http';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { badRequest, handleAPIError, notFound } from '../errors';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import { DEFAULT_NATIVE_SESSION_LIST_LIMIT } from '../native-copilot-sessions/native-copilot-session-service';
import type {
    NativeCliSessionProviderId,
    NativeSessionProvider,
    NativeSessionWorkspaceScope,
} from '../native-copilot-sessions/types';
import { parseGitHubRemoteUrl, readGitOriginRemote } from '../work-items/work-item-sync-github-repo';

export interface NativeCliSessionRouteContext {
    routes: Route[];
    store: ProcessStore;
    getEnabled: () => boolean;
    providers: ReadonlyMap<NativeCliSessionProviderId, NativeSessionProvider>;
    /** Override of workspace `owner/repo` resolution (tests avoid real git calls). */
    resolveWorkspaceRepository?: (workspace: WorkspaceInfo) => string | undefined | Promise<string | undefined>;
}

async function defaultResolveWorkspaceRepository(workspace: WorkspaceInfo): Promise<string | undefined> {
    if (!workspace.rootPath) {
        return undefined;
    }
    const remote = await readGitOriginRemote(workspace.rootPath);
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

function parseProvider(value: unknown): NativeCliSessionProviderId | undefined {
    const raw = queryString(value) ?? 'copilot';
    return raw === 'copilot' || raw === 'codex' || raw === 'claude' ? raw : undefined;
}

export function registerNativeCliSessionRoutes(ctx: NativeCliSessionRouteContext): void {
    const { routes, store, getEnabled, providers } = ctx;
    const resolveRepository = ctx.resolveWorkspaceRepository ?? defaultResolveWorkspaceRepository;

    const buildScope = async (workspace: WorkspaceInfo): Promise<NativeSessionWorkspaceScope> => ({
        rootPath: workspace.rootPath,
        repository: await resolveRepository(workspace),
    });

    const resolveProvider = (res: http.ServerResponse, raw: unknown): NativeSessionProvider | null => {
        const providerId = parseProvider(raw);
        if (!providerId) {
            handleAPIError(res, badRequest('provider must be one of: copilot, codex, claude'));
            return null;
        }
        const provider = providers.get(providerId);
        if (!provider) {
            handleAPIError(res, badRequest(`Native CLI session provider is not registered: ${providerId}`));
            return null;
        }
        return provider;
    };

    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/native-cli-sessions$/,
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

            const provider = resolveProvider(res, query.provider);
            if (!provider) { return; }
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) { return; }

            const result = provider.listSessions(await buildScope(workspace), {
                provider: provider.provider,
                q: queryString(query.q),
                sessionId: queryString(query.sessionId),
                branch: queryString(query.branch),
                from: queryString(query.from),
                to: queryString(query.to),
                limit: queryNumber(query.limit),
                offset: queryNumber(query.offset),
                excludeSessionIds: store.getSdkSessionIds?.(workspace.id),
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
                    provider: provider.provider,
                });
                return;
            }

            sendJSON(res, 200, {
                enabled: true,
                available: true,
                provider: provider.provider,
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

    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/native-cli-sessions\/([^/]+)$/,
        handler: async (req, res, match) => {
            const query = url.parse(req.url || '', true).query;
            if (!getEnabled()) {
                sendJSON(res, 200, { enabled: false, reason: 'feature-disabled' });
                return;
            }
            const provider = resolveProvider(res, query.provider);
            if (!provider) { return; }
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) { return; }

            const sessionId = decodeURIComponent(match![2]);
            const result = provider.getSession(await buildScope(workspace), sessionId);
            if (!result.available) {
                sendJSON(res, 200, {
                    enabled: true,
                    available: false,
                    reason: result.reason,
                    provider: provider.provider,
                });
                return;
            }
            if (!result.session) {
                handleAPIError(res, notFound('Native CLI session'));
                return;
            }
            sendJSON(res, 200, {
                enabled: true,
                available: true,
                provider: provider.provider,
                session: result.session,
            });
        },
    });
}
