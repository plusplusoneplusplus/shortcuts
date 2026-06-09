/**
 * Provider-agnostic Team roster author matching shared by the PR SPA and server
 * background classification helpers.
 */

export interface PrTeamIdentity {
    id?: string | number;
    displayName?: string;
}

export interface PrTeamRosterEntry {
    id: string;
    displayName: string;
}

export interface PrTeamPullRequest {
    author?: PrTeamIdentity;
}

function stringifyIdentityId(id: string | number | undefined): string {
    if (id === undefined || id === null) return '';
    return String(id).trim();
}

function normalizeIdentityId(id: string | number | undefined): string {
    return stringifyIdentityId(id).toLowerCase();
}

function normalizeDisplayName(displayName: string | undefined): string {
    return (displayName ?? '').trim().toLowerCase();
}

export function getPrTeamIdentityKey(identity: Pick<PrTeamIdentity, 'id' | 'displayName'>): string {
    return normalizeIdentityId(identity.id) || normalizeDisplayName(identity.displayName);
}

export function authorMatchesPrTeamRosterEntry(
    author: PrTeamIdentity | undefined,
    entry: Pick<PrTeamRosterEntry, 'id' | 'displayName'>,
): boolean {
    const authorId = normalizeIdentityId(author?.id);
    const entryId = normalizeIdentityId(entry.id);
    if (authorId && entryId) {
        return authorId === entryId;
    }

    const authorDisplayName = normalizeDisplayName(author?.displayName);
    const entryDisplayName = normalizeDisplayName(entry.displayName);
    return Boolean(authorDisplayName && entryDisplayName && authorDisplayName === entryDisplayName);
}

export function pullRequestMatchesPrTeamRoster(
    pr: PrTeamPullRequest,
    roster: readonly Pick<PrTeamRosterEntry, 'id' | 'displayName'>[],
): boolean {
    return roster.some(entry => authorMatchesPrTeamRosterEntry(pr.author, entry));
}

export function filterPullRequestsByPrTeamRoster<T extends PrTeamPullRequest>(
    pullRequests: readonly T[],
    roster: readonly Pick<PrTeamRosterEntry, 'id' | 'displayName'>[],
): T[] {
    return pullRequests.filter(pr => pullRequestMatchesPrTeamRoster(pr, roster));
}
