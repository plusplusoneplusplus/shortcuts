/**
 * Shared plumbing for the native CLI session routes.
 *
 * The unified `/native-cli-sessions` routes and the legacy Copilot-only
 * `/native-copilot-sessions` compatibility aliases answer for the same provider
 * kernel, so query parsing, workspace scope construction, and the
 * disabled/unavailable envelopes live here once. A behaviour fix applied here
 * reaches both surfaces.
 */

import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { parseGitHubRemoteUrl, readGitOriginRemote } from '../work-items/work-item-sync-github-repo';
import type { NativeSessionWorkspaceScope } from '../native-copilot-sessions/types';

/** Resolves a workspace `owner/repo` identity from its git origin remote. */
export type ResolveWorkspaceRepository = (
    workspace: WorkspaceInfo,
) => string | undefined | Promise<string | undefined>;

export async function defaultResolveWorkspaceRepository(
    workspace: WorkspaceInfo,
): Promise<string | undefined> {
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

/** Builds the workspace scope used to filter native sessions. */
export function createScopeBuilder(
    resolveRepository: ResolveWorkspaceRepository = defaultResolveWorkspaceRepository,
): (workspace: WorkspaceInfo) => Promise<NativeSessionWorkspaceScope> {
    return async workspace => ({
        rootPath: workspace.rootPath,
        repository: await resolveRepository(workspace),
    });
}

/** A trimmed non-empty query-string value, or `undefined`. */
export function queryString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

/** A base-10 integer query-string value, or `undefined` when absent/unparseable. */
export function queryNumber(value: unknown): number | undefined {
    const raw = queryString(value);
    if (raw === undefined) {
        return undefined;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
}

/** The list filters both route families accept, parsed from a query object. */
export function parseListFilters(query: Record<string, unknown>): {
    q?: string;
    sessionId?: string;
    branch?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
} {
    return {
        q: queryString(query.q),
        sessionId: queryString(query.sessionId),
        branch: queryString(query.branch),
        from: queryString(query.from),
        to: queryString(query.to),
        limit: queryNumber(query.limit),
        offset: queryNumber(query.offset),
    };
}

/**
 * The list payload returned when the feature flag is off. Pagination echoes the
 * requested window so the dashboard keeps its controls consistent.
 */
export function featureDisabledListPayload(limit: number, offset: number): Record<string, unknown> {
    return {
        enabled: false,
        reason: 'feature-disabled',
        items: [],
        total: 0,
        limit,
        offset,
    };
}

/** The list payload returned when the provider store cannot be read. */
export function unavailableListPayload(
    reason: string,
    limit: number,
    offset: number,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        enabled: true,
        available: false,
        reason,
        items: [],
        total: 0,
        limit,
        offset,
        ...extra,
    };
}
