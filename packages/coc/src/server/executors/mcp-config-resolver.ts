/**
 * Workspace MCP config resolver.
 *
 * Keeps workspace-scoped MCP additions out of the global Copilot config file.
 */

import type { MCPServerConfig, ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { normalizeExecutionPath } from '@plusplusoneplusplus/forge';
import { resolveEnDevXDpuMcpServers } from '../endev/endev-xdpu';

export interface ResolvedMcpConfig {
    mcpServers?: Record<string, MCPServerConfig>;
}

function pathsReferToSameWorkspace(leftPath: string | undefined, rightPath: string | undefined): boolean {
    if (!leftPath || !rightPath) return false;
    try {
        return normalizeExecutionPath(leftPath) === normalizeExecutionPath(rightPath);
    } catch {
        return leftPath.replace(/\\/g, '/').toLowerCase() === rightPath.replace(/\\/g, '/').toLowerCase();
    }
}

function findWorkspace(
    workspaces: WorkspaceInfo[],
    workspaceId: string | undefined,
    workingDirectory: string | undefined,
): WorkspaceInfo | undefined {
    if (workspaceId) {
        const exact = workspaces.find(workspace => workspace.id === workspaceId);
        if (exact) return exact;
    }

    return workspaces.find(workspace => pathsReferToSameWorkspace(workspace.rootPath, workingDirectory));
}

export async function resolveMcpConfig(
    store: ProcessStore,
    workspaceId: string | undefined,
    workingDirectory: string | undefined,
): Promise<ResolvedMcpConfig> {
    const workspaces = await store.getWorkspaces();
    const workspace = findWorkspace(workspaces, workspaceId, workingDirectory);
    if (!workspace) {
        return {};
    }

    const endevServers = await resolveEnDevXDpuMcpServers(workspace);
    return endevServers ? { mcpServers: endevServers } : {};
}
