const isId = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 512;

export interface DashboardChatReference {
    serverIdentity: string;
    workspaceId: string;
    processId: string;
    artifactPath?: string;
}

/** Syntax only: the owning server's existing preview guards authorize the path. */
export function isDashboardArtifactPath(value: unknown): value is string {
    return typeof value === 'string' && value.length > 1 && value.length <= 2_000
        && !/[\u0000-\u001f\u007f]/.test(value)
        && (/^\//.test(value) || /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]/.test(value))
        && !value.replace(/\\/g, '/').split('/').some(segment => segment === '..' || segment === '.');
}

/** Parse once; neither endpoint URLs nor connection aliases are durable identities. */
export function parseDashboardChatReference(hash: string): DashboardChatReference | null {
    const parts = hash.split('/');
    if (hash.includes('?') || parts[0] !== '#chat-references'
        || (parts.length !== 4 && (parts.length !== 6 || parts[4] !== 'artifacts'))) return null;
    try {
        const [serverIdentity, workspaceId, processId] = parts.slice(1, 4).map(decodeURIComponent);
        if (![serverIdentity, workspaceId, processId].every(isId)) return null;
        if (parts.length === 4) return { serverIdentity, workspaceId, processId };
        const artifactPath = decodeURIComponent(parts[5]);
        return isDashboardArtifactPath(artifactPath) && hash.length <= 2_000
            ? { serverIdentity, workspaceId, processId, artifactPath } : null;
    } catch {
        return null;
    }
}

/** Identity-only links are resolved against the viewing dashboard's current topology. */
export function buildDashboardChatReference(serverIdentity: string | undefined, workspaceId: string | undefined, processId: string): string {
    if (!isId(serverIdentity) || !isId(workspaceId) || !isId(processId)) {
        throw new Error('Chat link unavailable: owning server/workspace/process identity is required.');
    }
    return `#chat-references/${[serverIdentity, workspaceId, processId].map(encodeURIComponent).join('/')}`;
}

export function buildDashboardArtifactReference(
    serverIdentity: string | undefined, workspaceId: string | undefined, processId: string, artifactPath: string,
): string {
    if (!isDashboardArtifactPath(artifactPath)) throw new Error('Artifact link unavailable: invalid file path.');
    const href = `${buildDashboardChatReference(serverIdentity, workspaceId, processId)}/artifacts/${encodeURIComponent(artifactPath)}`;
    if (href.length > 2_000) throw new Error('Artifact link unavailable: file reference is too long.');
    return href;
}
