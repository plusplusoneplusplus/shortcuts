/**
 * Workspace resolution utilities for the dashboard SPA.
 * Resolves workspace IDs to human-readable names using the AppContext workspace list.
 */

/**
 * Resolve a workspace ID to a display name.
 * Checks the workspaces array first, then falls back to process-level workspaceName,
 * and finally the raw ID.
 */
export function resolveWorkspaceName(
    workspaceId: string | null | undefined,
    workspaceName: string | null | undefined,
    workspaces: any[]
): string | null {
    if (!workspaceId) return null;
    const ws = workspaces.find((w: any) => w.id === workspaceId);
    if (ws?.name) return ws.name;
    if (workspaceName) return workspaceName;
    return workspaceId;
}

/**
 * Extract workspace ID from a process object, checking both top-level and metadata fields.
 */
export function getProcessWorkspaceId(process: any): string | null {
    return process?.workspaceId
        || process?.metadata?.workspaceId
        || null;
}

/**
 * Extract workspace name from a process object.
 */
export function getProcessWorkspaceName(process: any): string | null {
    return process?.workspaceName
        || process?.metadata?.workspaceName
        || null;
}
