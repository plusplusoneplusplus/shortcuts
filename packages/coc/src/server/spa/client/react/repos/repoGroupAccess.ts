import type { RepoGroupAccessResponse, RepoGroupWriterConflict } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor } from '../api/cocClient';

export function getRepoGroupAccess(groupId?: string, baseUrl?: string): Promise<RepoGroupAccessResponse> {
    const query = groupId ? `?groupId=${encodeURIComponent(groupId)}` : '';
    return getCocClientFor(baseUrl).request(`/repo-groups/access${query}`);
}

export function getRepoGroupWriterConflicts(error: unknown): RepoGroupWriterConflict[] {
    const details = (error as { details?: { conflicts?: unknown } } | null)?.details;
    if (!Array.isArray(details?.conflicts)) return [];
    return details.conflicts.filter((entry): entry is RepoGroupWriterConflict =>
        entry && typeof entry.workspaceId === 'string' &&
        typeof entry.writerGroupId === 'string' && typeof entry.writerGroupName === 'string');
}

/** Advisory registered-path defaults; save-time admission resolves canonical roots. */
export function getRepoGroupReadOnlyDefaults(
    members: readonly { workspaceId: string; rootPath?: string }[],
    policies: Record<string, boolean>,
    sharedIds: ReadonlySet<string>,
): Record<string, boolean> {
    const result = Object.fromEntries(members.map(member =>
        [member.workspaceId, policies[member.workspaceId] ?? sharedIds.has(member.workspaceId)]));
    const normalize = (root: string) => {
        const normalized = root.replace(/\\/g, '/').replace(/\/+$/, '');
        return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized;
    };
    const overlaps = (left: string, right: string) => {
        const a = normalize(left), b = normalize(right);
        return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
    };
    let changed = true;
    while (changed) {
        changed = false;
        for (const member of members) {
            const rootPath = member.rootPath;
            if (policies[member.workspaceId] !== undefined || result[member.workspaceId] || !rootPath) continue;
            if (members.some(other => result[other.workspaceId] && other.rootPath && overlaps(rootPath, other.rootPath))) {
                result[member.workspaceId] = true;
                changed = true;
            }
        }
    }
    return result;
}
