/**
 * Factory for the read-only `list_workspaces` tool: lets the model discover
 * the local and remote repos (and repo groups) it can target with
 * `send_to_conversation`, with their IDs.
 *
 * Built alongside `send_to_conversation` (same addon, same gate) and backed by
 * the route-layer {@link WorkspaceDirectory}. The repo list is fetched at call
 * time only — it never enters the system prompt or the tool schema.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type {
    WorkspaceDirectory,
    WorkspaceDirectoryEntry,
    WorkspaceDirectoryServer,
} from '../servers/workspace-directory';

export interface ListWorkspacesArgs {
    /** Case-insensitive substring over repo name and server name. */
    query?: string;
}

export interface ListWorkspacesSuccess {
    workspaces: WorkspaceDirectoryEntry[];
    /** Every server consulted, including offline ones with zero repos. */
    servers: WorkspaceDirectoryServer[];
    /** Matching entries before the cap. */
    total: number;
    truncated: boolean;
}

export type ListWorkspacesResult = ListWorkspacesSuccess | { error: string };

export const LIST_WORKSPACES_MAX_RESULTS = 50;

export function createListWorkspacesTool(options: { directory: WorkspaceDirectory }) {
    const { directory } = options;
    const tool = defineTool<ListWorkspacesArgs>('list_workspaces', {
        description:
            'List the repos and repo groups you can start a conversation in, on this CoC server and on registered ' +
            'remote CoC servers. Returns `{ workspaces, servers, total, truncated }`; each workspace has `id`, ' +
            '`name`, `type` (`repo` | `group`, groups list `members`), `server` (`local` for this server), ' +
            '`serverKind`, and `online`. Pass an `id` (or a `name` / `name@server`) as `send_to_conversation` ' +
            '`workspaceId`. Remote IDs look like `remote:<serverId>:<workspaceId>`. Offline servers show their ' +
            `last-known repos with \`online: false\`. At most ${LIST_WORKSPACES_MAX_RESULTS} results; narrow with \`query\`.`,
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Optional case-insensitive substring matched against repo name and server name.',
                },
            },
        },
        handler: async (args: ListWorkspacesArgs): Promise<ListWorkspacesResult> => {
            if (args?.query !== undefined && typeof args.query !== 'string') {
                return { error: 'Invalid query: must be a string when provided.' };
            }
            const query = args?.query?.trim().toLowerCase();
            try {
                const { entries, servers } = await directory.list();
                const matches = query
                    ? entries.filter(e => e.name.toLowerCase().includes(query) || e.server.toLowerCase().includes(query))
                    : entries;
                return {
                    workspaces: matches.slice(0, LIST_WORKSPACES_MAX_RESULTS),
                    servers,
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
