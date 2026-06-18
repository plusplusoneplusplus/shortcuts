/**
 * Pull Requests Team auto-classification eligibility.
 *
 * Eligibility is intentionally based on the persisted Team roster for the
 * requested workspace/repo. Transient SPA chip state is not stored and must not
 * affect automatic background work.
 */

import {
    listPullRequestCoworkerRoster,
    type PullRequestCoworkerRosterEntry,
} from './pr-coworker-roster-store';
import type { PullRequestStorageScopeInput } from './pr-origin-scope';
import {
    pullRequestMatchesPrTeamRoster,
    type PrTeamPullRequest,
} from '../shared/pr-team-matching';

export interface TeamEligiblePullRequest extends PrTeamPullRequest {
    status?: string;
}

export interface TeamPullRequestEligibilityResult<T extends TeamEligiblePullRequest> {
    roster: PullRequestCoworkerRosterEntry[];
    pullRequests: T[];
}

export function isOpenPullRequestForTeamEligibility(pr: TeamEligiblePullRequest): boolean {
    return pr.status === 'open';
}

export function filterTeamEligiblePullRequests<T extends TeamEligiblePullRequest>(
    pullRequests: readonly T[],
    roster: readonly Pick<PullRequestCoworkerRosterEntry, 'id' | 'displayName'>[],
): T[] {
    if (roster.length === 0) return [];
    return pullRequests.filter(pr =>
        isOpenPullRequestForTeamEligibility(pr) &&
        pullRequestMatchesPrTeamRoster(pr, roster),
    );
}

export function listTeamEligiblePullRequests<T extends TeamEligiblePullRequest>(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    pullRequests: readonly T[],
    storageScope?: PullRequestStorageScopeInput,
): TeamPullRequestEligibilityResult<T> {
    const roster = listPullRequestCoworkerRoster(dataDir, workspaceId, repoId, storageScope);
    return {
        roster,
        pullRequests: filterTeamEligiblePullRequests(pullRequests, roster),
    };
}
