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
