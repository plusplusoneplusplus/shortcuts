const isId = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 512;

/** Identity-only links are resolved against the viewing dashboard's current topology. */
export function buildDashboardChatReference(serverIdentity: string | undefined, workspaceId: string | undefined, processId: string): string {
    if (!isId(serverIdentity) || !isId(workspaceId) || !isId(processId)) {
        throw new Error('Chat link unavailable: owning server/workspace/process identity is required.');
    }
    return `#chat-references/${[serverIdentity, workspaceId, processId].map(encodeURIComponent).join('/')}`;
}
