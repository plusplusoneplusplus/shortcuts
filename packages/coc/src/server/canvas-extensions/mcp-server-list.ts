import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { resolveWorkspaceMcp } from '../workspaces/workspace-mcp-resolver';

/** Wire shape of the Copilot SDK `session.mcp.list` result (`McpServerList`), which the SDK does not export. */
export interface CanvasMcpServerList {
    servers: { name: string; status: 'pending' | 'disabled'; source: 'user' | 'workspace' }[];
}

/**
 * Answer `session.mcp.list` from the owner workspace's MCP configuration, the
 * same resolution a chat turn and Settings → MCP use. CoC holds no live MCP
 * connections for a conversation, so an enabled server is `pending`, never
 * `connected`. Only names, status and source leave the server; no config.
 */
export async function listCanvasMcpServers(options: {
    store: ProcessStore;
    dataDir: string;
    workspaceId: string;
}): Promise<CanvasMcpServerList> {
    const workspace = (await options.store.getWorkspaces()).find(ws => ws.id === options.workspaceId);
    if (!workspace?.rootPath) return { servers: [] };
    const resolution = await resolveWorkspaceMcp({
        store: options.store, dataDir: options.dataDir,
        workspace: { id: workspace.id, rootPath: workspace.rootPath },
    });
    const enabled = workspace.enabledMcpServers;
    return {
        servers: Object.entries(resolution.servers).map(([name, server]) => ({
            name,
            status: enabled === null || enabled === undefined || enabled.includes(name) ? 'pending' : 'disabled',
            source: server.source === 'global' ? 'user' : 'workspace',
        })),
    };
}
