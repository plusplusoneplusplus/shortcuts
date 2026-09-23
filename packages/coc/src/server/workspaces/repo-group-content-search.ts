/**
 * Repo-group content search: one query, every live member.
 *
 * The group's owning server answers this, exactly like the group file search
 * next door in `repo-group-handler.ts` — membership is resolved fresh against
 * the registry for the transaction, so a removed or rebound member can never be
 * silently searched under its old identity. Members are addressed by workspace
 * ID and display name only; a root path never leaves this module.
 *
 * Two things make it more than a fan-out:
 *
 *  - **Fair capping.** The group answer is capped at the same 500 matches one
 *    repo may return, so a single huge repository must not spend the whole
 *    budget before the other members contribute. {@link apportionMatchQuota}
 *    gives every member an equal share, then hands the share nobody could use
 *    back to the members that still have matches waiting.
 *  - **Partial success.** A member that fails, or is stale, is reported by name
 *    rather than failing the query; the members that did answer stay visible.
 */

import { CONTENT_SEARCH_MAX_RESULTS } from '../repos/types';
import type { ContentMatch, ContentSearchOptions } from '../repos/types';
import { TrackedContentSearchUnavailableError } from '../repos/tree-service';
import type { RepoGroupMember } from './repo-group-workspace';

/** Cap on matches one group query may return, shared with single-repo search. */
export const REPO_GROUP_CONTENT_SEARCH_MAX_RESULTS = CONTENT_SEARCH_MAX_RESULTS;

/** How many members may be searched at once. */
export const REPO_GROUP_CONTENT_SEARCH_CONCURRENCY = 4;

/** The one method of `RepoTreeService` this module needs. */
export interface GroupContentSearchService {
    searchContent(
        repoId: string,
        query: string,
        options?: ContentSearchOptions,
    ): Promise<{ matches: ContentMatch[]; truncated: boolean }>;
}

/** One member's slice of the group answer. */
export interface RepoGroupContentSearchMemberResult {
    /** Member workspace ID — the routing identity the browser opens with. */
    workspaceId: string;
    /** Registry display name, for the repository group header. */
    repoName: string;
    /** Repo-relative matches, in the order the member's own search returned. */
    matches: ContentMatch[];
    /** Matches this member found before the group cap was applied. */
    totalMatches: number;
    /** True when this member's own caps hit, or the group cap dropped rows. */
    truncated: boolean;
}

/** A member that could not contribute to this answer. */
export interface RepoGroupContentSearchFailure {
    workspaceId: string;
    /** Registry display name; absent when the workspace itself is gone. */
    repoName?: string;
    /**
     * `stale` — removed from the registry or its root vanished.
     * `unavailable` — present but not a usable Git repository.
     * `error` — the search itself failed.
     */
    reason: 'stale' | 'unavailable' | 'error';
    message: string;
}

/** The aggregate answer for one group query. */
export interface RepoGroupContentSearchResult {
    /**
     * `complete` — every member answered. `partial` — some did not.
     * `failed` — none of the live members answered.
     * `no-searchable-members` — the group has no live member to search.
     */
    status: 'complete' | 'partial' | 'failed' | 'no-searchable-members';
    /** Members with at least one returned match, in group-membership order. */
    members: RepoGroupContentSearchMemberResult[];
    /** Members that were not searched successfully, in membership order. */
    failures: RepoGroupContentSearchFailure[];
    /** True when the group cap or any member's own cap dropped matches. */
    truncated: boolean;
    /** Matches actually returned across all members. */
    totalMatches: number;
    /** The cap this answer was apportioned against. */
    limit: number;
    memberCount: number;
    searchableMemberCount: number;
    searchedMemberCount: number;
    unavailableMemberCount: number;
    failedMemberCount: number;
}

/** Raised when the caller aborted before the fan-out finished. */
export class RepoGroupContentSearchAbortedError extends Error {
    readonly code = 'REPO_GROUP_CONTENT_SEARCH_ABORTED';
    constructor() {
        super('Repo-group content search was cancelled');
        this.name = 'RepoGroupContentSearchAbortedError';
    }
}

/**
 * Split `cap` across members that each want `counts[i]` matches, max-min fair.
 *
 * Every member starts with an equal share of what is left. A member wanting
 * less than its share takes only what it has, and the rest of that share is
 * redistributed to the members still waiting — repeatedly, until the cap is
 * spent or every demand is met. The final indivisible units go one apiece in
 * membership order, so the split is deterministic for a given member order.
 */
export function apportionMatchQuota(counts: readonly number[], cap: number): number[] {
    const allocated = counts.map(() => 0);
    let remaining = Math.max(0, cap);
    while (remaining > 0) {
        const waiting = counts.map((_, index) => index).filter(index => allocated[index] < counts[index]);
        if (waiting.length === 0) break;
        const share = Math.floor(remaining / waiting.length);
        if (share === 0) {
            // Fewer units left than members waiting: one each, in order.
            for (const index of waiting) {
                if (remaining === 0) break;
                allocated[index] += 1;
                remaining -= 1;
            }
            break;
        }
        for (const index of waiting) {
            const take = Math.min(share, counts[index] - allocated[index]);
            allocated[index] += take;
            remaining -= take;
        }
    }
    return allocated;
}

async function mapBounded<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await fn(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}

function staleMessage(member: RepoGroupMember): string {
    return member.staleReason === 'path-missing'
        ? 'Repository folder is missing'
        : 'Repository is no longer registered';
}

/**
 * Strip the member's root out of an error message.
 *
 * Git and the search addon happily quote the directory they were pointed at,
 * and this answer goes to a browser that must never learn where a member lives
 * on disk. The member's display name reads better there anyway.
 */
function sanitizeMemberMessage(message: string, member: RepoGroupMember): string {
    const root = member.rootPath;
    if (!root) return message;
    const label = member.name ?? member.workspaceId;
    return message
        .split(root).join(label)
        .split(root.split('\\').join('/')).join(label);
}

interface MemberSearch {
    workspaceId: string;
    repoName: string;
    matches: ContentMatch[];
    /** The member's own search hit a cap before the group cap was applied. */
    selfTruncated: boolean;
    failure?: RepoGroupContentSearchFailure;
}

/**
 * Search every live member of an already-resolved membership list.
 *
 * `members` must come from `resolveRepoGroupMembers` for this transaction.
 * `signal` is checked before each member starts and again before the answer is
 * assembled, so a superseded query stops costing work as soon as the member in
 * flight returns.
 */
export async function searchRepoGroupContent(input: {
    members: readonly RepoGroupMember[];
    service: GroupContentSearchService;
    query: string;
    options: Omit<ContentSearchOptions, 'limit'>;
    limit?: number;
    concurrency?: number;
    signal?: { aborted: boolean };
}): Promise<RepoGroupContentSearchResult> {
    const { members, service, query, options, signal } = input;
    const limit = Math.min(
        Math.max(input.limit ?? REPO_GROUP_CONTENT_SEARCH_MAX_RESULTS, 1),
        REPO_GROUP_CONTENT_SEARCH_MAX_RESULTS,
    );
    const concurrency = input.concurrency ?? REPO_GROUP_CONTENT_SEARCH_CONCURRENCY;

    const live: RepoGroupMember[] = [];
    const staleFailures: RepoGroupContentSearchFailure[] = [];
    for (const member of members) {
        if (member.stale || member.name === undefined) {
            staleFailures.push({
                workspaceId: member.workspaceId,
                ...(member.name !== undefined ? { repoName: member.name } : {}),
                reason: 'stale',
                message: staleMessage(member),
            });
        } else {
            live.push(member);
        }
    }

    const base = {
        memberCount: members.length,
        searchableMemberCount: live.length,
        unavailableMemberCount: staleFailures.length,
        limit,
    };

    if (live.length === 0) {
        return {
            ...base,
            status: 'no-searchable-members',
            members: [],
            failures: staleFailures,
            truncated: false,
            totalMatches: 0,
            searchedMemberCount: 0,
            failedMemberCount: 0,
        };
    }

    if (signal?.aborted) throw new RepoGroupContentSearchAbortedError();

    const searches = await mapBounded(live, concurrency, async (member): Promise<MemberSearch> => {
        const repoName = member.name!;
        if (signal?.aborted) {
            // Not a failure to report — the whole answer is discarded below.
            return { workspaceId: member.workspaceId, repoName, matches: [], selfTruncated: false };
        }
        try {
            // Every member may offer up to the whole cap; the apportionment
            // below, not the member, decides how much of it is kept.
            const result = await service.searchContent(member.workspaceId, query, { ...options, limit });
            return {
                workspaceId: member.workspaceId,
                repoName,
                matches: result.matches,
                selfTruncated: result.truncated,
            };
        } catch (error) {
            // A bad regex or glob is bad for every member, not a member
            // failure — let it out so the route can answer 400 once.
            if ((error as { code?: unknown } | null)?.code === 'InvalidArg') throw error;
            const message = sanitizeMemberMessage(
                error instanceof Error ? error.message : String(error),
                member,
            );
            return {
                workspaceId: member.workspaceId,
                repoName,
                matches: [],
                selfTruncated: false,
                failure: {
                    workspaceId: member.workspaceId,
                    repoName,
                    reason: error instanceof TrackedContentSearchUnavailableError ? 'unavailable' : 'error',
                    message,
                },
            };
        }
    });

    if (signal?.aborted) throw new RepoGroupContentSearchAbortedError();

    const quota = apportionMatchQuota(searches.map(search => search.matches.length), limit);
    const memberResults: RepoGroupContentSearchMemberResult[] = [];
    const searchFailures: RepoGroupContentSearchFailure[] = [];
    let totalMatches = 0;
    let truncated = false;
    searches.forEach((search, index) => {
        if (search.failure) {
            searchFailures.push(search.failure);
            return;
        }
        const kept = search.matches.slice(0, quota[index]);
        const memberTruncated = search.selfTruncated || kept.length < search.matches.length;
        if (memberTruncated) truncated = true;
        totalMatches += kept.length;
        if (kept.length === 0 && !memberTruncated) return;
        memberResults.push({
            workspaceId: search.workspaceId,
            repoName: search.repoName,
            matches: kept,
            totalMatches: search.matches.length,
            truncated: memberTruncated,
        });
    });

    const failedMemberCount = searchFailures.length;
    const searchedMemberCount = live.length - failedMemberCount;
    const status: RepoGroupContentSearchResult['status'] = searchedMemberCount === 0
        ? 'failed'
        : failedMemberCount > 0 || staleFailures.length > 0
            ? 'partial'
            : 'complete';

    return {
        ...base,
        status,
        members: memberResults,
        // Membership order first, then the members that failed mid-search.
        failures: [...staleFailures, ...searchFailures],
        truncated,
        totalMatches,
        searchedMemberCount,
        failedMemberCount,
    };
}
