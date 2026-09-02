/**
 * Read-only, workspace-scoped views over native Copilot, Codex, and Claude Code
 * CLI session stores. The route delegates all provider-specific store access to
 * short-lived read-only providers and never mutates external CLI data.
 */

import * as url from 'url';
import * as http from 'http';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { badRequest, handleAPIError, notFound } from '../errors';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import { DEFAULT_NATIVE_SESSION_LIST_LIMIT } from '../native-copilot-sessions/native-copilot-session-service';
import {
    getNativeCliProviderDescriptor,
    isNativeCliSessionProviderId,
    NATIVE_CLI_PROVIDER_IDS,
} from '../native-copilot-sessions/types';
import type {
    NativeCliSessionProviderId,
    NativeSessionProvider,
} from '../native-copilot-sessions/types';
import {
    createScopeBuilder,
    featureDisabledListPayload,
    parseListFilters,
    queryNumber,
    queryString,
    unavailableListPayload,
} from './native-session-route-utils';
import type { ResolveWorkspaceRepository } from './native-session-route-utils';

export interface NativeCliSessionRouteContext {
    routes: Route[];
    store: ProcessStore;
    getEnabled: () => boolean;
    providers: ReadonlyMap<NativeCliSessionProviderId, NativeSessionProvider>;
    /** Override of workspace `owner/repo` resolution (tests avoid real git calls). */
    resolveWorkspaceRepository?: ResolveWorkspaceRepository;
}

export function registerNativeCliSessionRoutes(ctx: NativeCliSessionRouteContext): void {
    const { routes, store, getEnabled, providers } = ctx;
    const buildScope = createScopeBuilder(ctx.resolveWorkspaceRepository);

    const resolveProvider = (res: http.ServerResponse, raw: unknown): NativeSessionProvider | null => {
        const requested = queryString(raw) ?? 'copilot';
        if (!isNativeCliSessionProviderId(requested)) {
            handleAPIError(res, badRequest(
                `provider must be one of: ${NATIVE_CLI_PROVIDER_IDS.join(', ')}`,
            ));
            return null;
        }
        const descriptor = getNativeCliProviderDescriptor(requested);
        // A `planned` descriptor is a known provider CoC cannot serve yet. It is
        // reported as such rather than as a registry wiring bug, and the shared
        // registry keeps it out of the dashboard tab list in the first place.
        if (descriptor.status !== 'available') {
            handleAPIError(res, badRequest(
                descriptor.plannedNote
                    ?? `Native CLI session provider is not supported yet: ${requested}`,
            ));
            return null;
        }
        const provider = providers.get(requested);
        if (!provider) {
            handleAPIError(res, badRequest(`Native CLI session provider is not registered: ${requested}`));
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
                sendJSON(res, 200, featureDisabledListPayload(limit, offset));
                return;
            }

            const provider = resolveProvider(res, query.provider);
            if (!provider) { return; }
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) { return; }

            const result = provider.listSessions(await buildScope(workspace), {
                provider: provider.provider,
                ...parseListFilters(query),
                excludeSessionIds: store.getSdkSessionIds?.(workspace.id),
            });

            if (!result.available) {
                sendJSON(res, 200, unavailableListPayload(result.reason, result.limit, result.offset, {
                    provider: provider.provider,
                    searchStrategy: provider.searchStrategy,
                }));
                return;
            }

            sendJSON(res, 200, {
                enabled: true,
                available: true,
                provider: provider.provider,
                searchStrategy: provider.searchStrategy,
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
                    searchStrategy: provider.searchStrategy,
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
                searchStrategy: provider.searchStrategy,
                session: result.session,
            });
        },
    });
}
