/**
 * Repo-Group REST API Handler.
 *
 * CRUD endpoints for repo-group virtual workspaces. Creation and updates
 * validate membership against the workspace registry (only registered,
 * non-virtual repo workspaces may be members); reads resolve members
 * against the live registry so stale entries surface in the edit dialog.
 * Per-member descriptions and read-only flags ride along on create/update as
 * optional maps and come back on every resolved member.
 * Deleting a group only deregisters the workspace — its data directory
 * stays on disk.
 */

import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import type { NativeRankedFileMatch } from '@plusplusoneplusplus/coc-native';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, badRequest, notFound, missingFields } from '../errors';
import type { RepoTreeService } from '../repos/tree-service';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import {
    createRepoGroup,
    deleteRepoGroup,
    readRepoGroup,
    resolveRepoGroupMembers,
    updateRepoGroup,
    RepoGroupValidationError,
} from './repo-group-workspace';

/** Minimal broadcast surface of the process WebSocket server. */
interface TopologyBroadcaster {
    broadcastProcessEvent(event: {
        type: 'workspace-topology-changed';
        workspaceId: string;
        action: 'added' | 'updated' | 'removed';
        timestamp: number;
    }): void;
}

export interface RepoGroupRouteDeps {
    /** Broadcast workspace topology changes to connected dashboard clients. */
    getWsServer?: () => TopologyBroadcaster | undefined;
    /**
     * Called after a new group workspace is registered so the server can wire
     * runtime services (queue-bridge repo-id map, schedule manager) the same
     * way the startup workspace sweep does for pre-existing workspaces.
     */
    onGroupRegistered?: (ws: WorkspaceInfo) => void | Promise<void>;
    /** Shared native file-index service used by repo and repo-group search. */
    repoTreeService?: Pick<RepoTreeService, 'searchFilesRanked'>;
}

const GROUP_SEARCH_CONCURRENCY = 4;

export interface RepoGroupSearchResult {
    status: 'complete' | 'partial' | 'failed' | 'no-searchable-members';
    results: Array<{
        workspaceId: string;
        repoName: string;
        path: string;
        score: number;
        indices: number[];
    }>;
    memberCount: number;
    searchableMemberCount: number;
    searchedMemberCount: number;
    unavailableMemberCount: number;
    failedMemberCount: number;
}

interface RankedGroupCandidate extends NativeRankedFileMatch {
    workspaceId: string;
    repoName: string;
    memberIndex: number;
}

function compareGroupCandidates(a: RankedGroupCandidate, b: RankedGroupCandidate): number {
    return (
        b.ranking.tier - a.ranking.tier ||
        b.score - a.score ||
        a.ranking.targetLen - b.ranking.targetLen ||
        a.ranking.pathLen - b.ranking.pathLen ||
        a.memberIndex - b.memberIndex ||
        a.ranking.snapshotIndex - b.ranking.snapshotIndex
    );
}

async function mapBounded<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await fn(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}

async function searchRepoGroup(
    members: Awaited<ReturnType<typeof resolveRepoGroupMembers>>,
    service: Pick<RepoTreeService, 'searchFilesRanked'>,
    query: string,
    limit: number,
    showIgnored: boolean,
): Promise<RepoGroupSearchResult> {
    const searchable = members
        .map((member, memberIndex) => ({ member, memberIndex }))
        .filter(({ member }) => !member.stale && member.name !== undefined);
    const unavailableMemberCount = members.length - searchable.length;
    if (searchable.length === 0) {
        return {
            status: 'no-searchable-members',
            results: [],
            memberCount: members.length,
            searchableMemberCount: 0,
            searchedMemberCount: 0,
            unavailableMemberCount,
            failedMemberCount: 0,
        };
    }

    const searches = await mapBounded(searchable, GROUP_SEARCH_CONCURRENCY, async ({ member, memberIndex }) => {
        try {
            const matches = await service.searchFilesRanked(member.workspaceId, query, { limit, showIgnored });
            return {
                matches: matches.map((match): RankedGroupCandidate => ({
                    ...match,
                    workspaceId: member.workspaceId,
                    repoName: member.name!,
                    memberIndex,
                })),
                failed: false,
            };
        } catch {
            return { matches: [] as RankedGroupCandidate[], failed: true };
        }
    });
    const failedMemberCount = searches.filter(search => search.failed).length;
    const searchedMemberCount = searchable.length - failedMemberCount;
    const status = searchedMemberCount === 0
        ? 'failed'
        : failedMemberCount > 0 || unavailableMemberCount > 0
            ? 'partial'
            : 'complete';
    const results = searches
        .flatMap(search => search.matches)
        .sort(compareGroupCandidates)
        .slice(0, limit)
        .map(({ workspaceId, repoName, path, score, indices }) => ({
            workspaceId,
            repoName,
            path,
            score,
            indices,
        }));
    return {
        status,
        results,
        memberCount: members.length,
        searchableMemberCount: searchable.length,
        searchedMemberCount,
        unavailableMemberCount,
        failedMemberCount,
    };
}

function parseGroupSearchQuery(req: Parameters<Route['handler']>[0]):
    | { query: string; limit: number; showIgnored: boolean }
    | { error: string } {
    const params = new URL(req.url ?? '', 'http://localhost').searchParams;
    const queryValues = params.getAll('q');
    if (queryValues.length !== 1 || queryValues[0].length === 0) {
        return { error: 'Missing required query parameter: q' };
    }
    let limit = 50;
    const limitValues = params.getAll('limit');
    if (limitValues.length > 1) {
        return { error: 'Invalid query parameter: limit' };
    }
    if (limitValues.length === 1) {
        if (!/^-?\d+$/.test(limitValues[0])) {
            return { error: 'Invalid query parameter: limit' };
        }
        limit = Math.min(Math.max(Number(limitValues[0]), 1), 200);
    }
    const showIgnoredValues = params.getAll('showIgnored');
    if (
        showIgnoredValues.length > 1 ||
        (showIgnoredValues.length === 1 &&
            showIgnoredValues[0] !== 'true' &&
            showIgnoredValues[0] !== 'false')
    ) {
        return { error: 'Invalid query parameter: showIgnored' };
    }
    return { query: queryValues[0], limit, showIgnored: showIgnoredValues[0] === 'true' };
}

/** Members must arrive as an array of workspace-ID strings. */
function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Descriptions must arrive as a plain object of workspace ID -> string. Length
 * and membership of each key are checked further in, by the store, so those
 * failures share the one `RepoGroupValidationError -> 400` path.
 */
function isStringMap(value: unknown): value is Record<string, string> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string')
    );
}

/**
 * Read-only flags must arrive as a plain object of workspace ID -> boolean.
 * Membership of each key is checked further in, by the store, so that failure
 * shares the one `RepoGroupValidationError -> 400` path.
 */
function isBooleanMap(value: unknown): value is Record<string, boolean> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.values(value as Record<string, unknown>).every((v) => typeof v === 'boolean')
    );
}

export function registerRepoGroupRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
    deps: RepoGroupRouteDeps = {},
): void {

    function broadcast(workspaceId: string, action: 'added' | 'updated' | 'removed'): void {
        deps.getWsServer?.()?.broadcastProcessEvent({
            type: 'workspace-topology-changed',
            workspaceId,
            action,
            timestamp: Date.now(),
        });
    }

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repo-groups\/([^/]+)\/search$/,
        handler: async (req, res, match) => {
            try {
                const id = decodeURIComponent(match![1]);
                if (!readRepoGroup(dataDir, id)) {
                    return handleAPIError(res, notFound('Repo group'));
                }
                const parsed = parseGroupSearchQuery(req);
                if ('error' in parsed) {
                    return handleAPIError(res, badRequest(parsed.error));
                }
                if (!deps.repoTreeService) {
                    throw new Error('Repo-group search service is unavailable');
                }
                const members = await resolveRepoGroupMembers(dataDir, store, id);
                sendJSON(
                    res,
                    200,
                    await searchRepoGroup(
                        members,
                        deps.repoTreeService,
                        parsed.query,
                        parsed.limit,
                        parsed.showIgnored,
                    ),
                );
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/repo-groups — Create a repo group
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/repo-groups',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.name !== 'string' || body.members === undefined) {
                return handleAPIError(res, missingFields(['name', 'members']));
            }
            if (!isStringArray(body.members)) {
                return handleAPIError(res, badRequest('members must be an array of workspace IDs'));
            }
            if (body.descriptions !== undefined && !isStringMap(body.descriptions)) {
                return handleAPIError(res, badRequest('descriptions must be an object of workspace ID to string'));
            }
            if (body.readOnly !== undefined && !isBooleanMap(body.readOnly)) {
                return handleAPIError(res, badRequest('readOnly must be an object of workspace ID to boolean'));
            }
            try {
                const ws = await createRepoGroup(dataDir, store, {
                    name: body.name,
                    members: body.members,
                    descriptions: body.descriptions,
                    readOnly: body.readOnly,
                });
                await deps.onGroupRegistered?.(ws);
                broadcast(ws.id, 'added');
                const members = await resolveRepoGroupMembers(dataDir, store, ws.id);
                sendJSON(res, 201, { workspace: ws, members });
            } catch (err) {
                handleAPIError(res, err instanceof RepoGroupValidationError ? badRequest(err.message) : err);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/repo-groups/:id — Membership file + registry-resolved members
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/repo-groups\/([^/]+)$/,
        handler: async (_req, res, match) => {
            try {
                const id = decodeURIComponent(match![1]);
                const file = readRepoGroup(dataDir, id);
                if (!file) {
                    return handleAPIError(res, notFound('Repo group'));
                }
                const members = await resolveRepoGroupMembers(dataDir, store, id);
                sendJSON(res, 200, { id, name: file.name, members });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/repo-groups/:id — Rename, membership, descriptions, read-only
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/repo-groups\/([^/]+)$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (body.name !== undefined && typeof body.name !== 'string') {
                return handleAPIError(res, badRequest('name must be a string'));
            }
            if (body.members !== undefined && !isStringArray(body.members)) {
                return handleAPIError(res, badRequest('members must be an array of workspace IDs'));
            }
            if (body.descriptions !== undefined && !isStringMap(body.descriptions)) {
                return handleAPIError(res, badRequest('descriptions must be an object of workspace ID to string'));
            }
            if (body.readOnly !== undefined && !isBooleanMap(body.readOnly)) {
                return handleAPIError(res, badRequest('readOnly must be an object of workspace ID to boolean'));
            }
            try {
                const id = decodeURIComponent(match![1]);
                const updated = await updateRepoGroup(dataDir, store, id, {
                    name: body.name,
                    members: body.members,
                    descriptions: body.descriptions,
                    readOnly: body.readOnly,
                });
                if (!updated) {
                    return handleAPIError(res, notFound('Repo group'));
                }
                broadcast(id, 'updated');
                const members = await resolveRepoGroupMembers(dataDir, store, id);
                sendJSON(res, 200, { id, name: updated.name, members });
            } catch (err) {
                handleAPIError(res, err instanceof RepoGroupValidationError ? badRequest(err.message) : err);
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/repo-groups/:id — Deregister; data stays on disk
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/repo-groups\/([^/]+)$/,
        handler: async (_req, res, match) => {
            try {
                const id = decodeURIComponent(match![1]);
                const removed = await deleteRepoGroup(store, id);
                if (!removed) {
                    return handleAPIError(res, notFound('Repo group'));
                }
                broadcast(id, 'removed');
                res.writeHead(204);
                res.end();
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });
}
