/**
 * Factory for the read-only `list_workspaces` tool: lets the model discover
 * dispatchable directory IDs or read-only dashboard-visible workspace identities.
 *
 * Built alongside `send_to_conversation` (same addon, same gate) and backed by
 * the route-layer {@link WorkspaceDirectory} and owner-scoped dashboard relay. The repo list is fetched at call
 * time only — it never enters the system prompt or the tool schema.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { DashboardDiscoveryRuntime, DashboardVisibleWorkspace, DashboardWorkspaceTarget } from '@plusplusoneplusplus/coc-client';
import type {
    WorkspaceGitSummary,
    WorkspaceGitTarget,
    WorkspaceDirectory,
    WorkspaceDirectoryEntry,
    WorkspaceDirectoryServer,
} from '../servers/workspace-directory';

export interface ListWorkspacesArgs {
    /** Case-insensitive substring over repo name and server name. */
    query?: string;
    /** Dashboard observations are read-only and separate from dispatchable directory IDs. */
    source?: 'registered' | 'dashboard';
}

export interface ListWorkspacesSuccess {
    workspaces: Array<WorkspaceDirectoryEntry & { git?: WorkspaceGitSummary }>;
    /** Every server consulted, including offline ones with zero repos. */
    servers: WorkspaceDirectoryServer[];
    /** Matching entries before the cap. */
    total: number;
    truncated: boolean;
}

export interface DashboardWorkspacesSuccess {
    source: 'dashboard';
    workspaces: Array<DashboardVisibleWorkspace & { target?: DashboardWorkspaceTarget; git?: WorkspaceGitSummary }>;
    total: number;
    truncated: boolean;
}

export type ListWorkspacesResult = ListWorkspacesSuccess | DashboardWorkspacesSuccess | { error: string };

export const LIST_WORKSPACES_MAX_RESULTS = 50;

export function createListWorkspacesTool(options: {
    directory: WorkspaceDirectory;
    /** Invoking workspace, never accepted from tool arguments. */
    workspaceId?: string;
    getDashboardDiscovery?: () => DashboardDiscoveryRuntime | undefined;
}) {
    const { directory } = options;
    // One deadline for the whole capped collection; at most four owner reads in flight.
    async function withGit<T extends { type: 'repo' | 'group' }>(rows: T[], target: (row: T) => WorkspaceGitTarget, signal?: AbortSignal) {
        const controller = new AbortController();
        const abort = () => controller.abort(signal?.reason);
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort(new Error('Git summary timed out')), 4_000);
        const result: Array<T & { git?: WorkspaceGitSummary }> = rows.map(row => ({ ...row }));
        let next = 0;
        const stopped = new Promise<WorkspaceGitSummary>(resolve => {
            if (controller.signal.aborted) resolve({ state: 'unavailable' });
            else controller.signal.addEventListener('abort', () => resolve({ state: 'unavailable' }), { once: true });
        });
        try {
            await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
                while (next < rows.length) {
                    const index = next++;
                    if (rows[index].type !== 'repo') continue;
                    const owner = target(rows[index]);
                    result[index].git = !owner.online ? { state: 'offline' }
                        : controller.signal.aborted ? { state: 'unavailable' }
                        : !directory.getGitSummary ? { state: 'unsupported' }
                        : await Promise.race([
                            directory.getGitSummary(owner, controller.signal).catch((): WorkspaceGitSummary => ({ state: 'unavailable' })),
                            stopped,
                        ]);
                }
            }));
            return result;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }
    const tool = defineTool<ListWorkspacesArgs>('list_workspaces', {
        description:
            'List the repos and repo groups you can start a conversation in, on this CoC server and on registered ' +
            'remote CoC servers. Returns `{ workspaces, servers, total, truncated }`; each workspace has `id`, ' +
            '`name`, `type` (`repo` | `group`, groups list `members`), `server` (`local` for this server), ' +
            '`serverKind`, and `online`. Repo rows add `git`: `{ state: "clean" | "dirty", branch }`, ' +
            'optional `detached: true` (branch null) and upstream `ahead`/`behind`; otherwise ' +
            '`{ state: "non-git" | "unavailable" | "unsupported" | "offline" }`. Groups omit Git. Pass an `id` (or a `name` / `name@server`) as `send_to_conversation` ' +
            '`workspaceId`. Remote IDs look like `remote:<serverId>:<workspaceId>`. Offline servers show their ' +
            `last-known repos with \`online: false\`. At most ${LIST_WORKSPACES_MAX_RESULTS} results; narrow with \`query\`. ` +
            'Use `source: "dashboard"` to discover all workspaces visible to the dashboard viewing this workspace, ' +
            'including servers absent from this server registry and cached offline rows. Dashboard results carry ' +
            'server/workspace labels and a stable `target: { serverIdentity, workspaceId }` when identity is known. ' +
            'Git is unsupported for dashboard owners absent from the server registry. These are read-only observations, not verified chat ownership or send_to_conversation destinations. ' +
            'Unknown identity has no target; never substitute a server label or bare workspace ID. ' +
            'Ask the user when workspace/server labels match more than one target. The default source is registered.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Optional case-insensitive substring matched against repo name and server name.',
                },
                source: {
                    type: 'string',
                    enum: ['registered', 'dashboard'],
                    description: 'Registered dispatch targets (default), or read-only dashboard-visible workspaces for chat reference discovery.',
                },
            },
        },
        handler: async (args: ListWorkspacesArgs, invocation): Promise<ListWorkspacesResult> => {
            if (args?.query !== undefined && typeof args.query !== 'string') {
                return { error: 'Invalid query: must be a string when provided.' };
            }
            if (args?.source !== undefined && args.source !== 'registered' && args.source !== 'dashboard') {
                return { error: 'Invalid source: must be registered or dashboard.' };
            }
            const query = args?.query?.trim().toLowerCase();
            if (args?.source === 'dashboard') {
                if (!options.workspaceId) return { error: 'Dashboard discovery requires an invoking workspace.' };
                const discovery = options.getDashboardDiscovery?.();
                if (!discovery) return { error: 'Dashboard workspace discovery unavailable.' };
                try {
                    const rows = await discovery.listWorkspaces(options.workspaceId);
                    const matches = query
                        ? rows.filter(row => row.workspaceLabel.toLowerCase().includes(query) || row.serverLabel.toLowerCase().includes(query))
                        : rows;
                    return {
                        source: 'dashboard',
                        workspaces: await withGit(matches.slice(0, LIST_WORKSPACES_MAX_RESULTS).map(row => ({
                            ...row,
                            ...(row.serverIdentity === undefined ? {} : {
                                target: { serverIdentity: row.serverIdentity, workspaceId: row.workspaceId },
                            }),
                        })), row => ({ serverIdentity: row.serverIdentity, workspaceId: row.workspaceId, online: row.online }), invocation?.signal),
                        total: matches.length,
                        truncated: matches.length > LIST_WORKSPACES_MAX_RESULTS,
                    };
                } catch {
                    return { error: 'Dashboard workspace discovery unavailable. No registered or local fallback was attempted.' };
                }
            }
            try {
                const { entries, servers } = await directory.list();
                const matches = query
                    ? entries.filter(e => e.name.toLowerCase().includes(query) || e.server.toLowerCase().includes(query))
                    : entries;
                return {
                    workspaces: await withGit(matches.slice(0, LIST_WORKSPACES_MAX_RESULTS), row => ({ id: row.id, serverIdentity: row.serverIdentity, online: row.online }), invocation?.signal),
                    servers: servers.map(({ serverId: _serverId, ...server }) => server),
                    total: matches.length,
                    truncated: matches.length > LIST_WORKSPACES_MAX_RESULTS,
                };
            } catch (err) {
                return { error: `Failed to list workspaces: ${err instanceof Error ? err.message : String(err)}` };
            }
        },
    });
    return { tool };
}
