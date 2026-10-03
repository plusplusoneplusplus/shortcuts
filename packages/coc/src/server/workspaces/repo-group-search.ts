/** Shared request controls, membership split, ordered fan-out and status for repository-group searches. */
import type { RepoGroupMember } from './repo-group-workspace';

export const GROUP_SEARCH_CONCURRENCY = 4;

export type LiveGroupMember = RepoGroupMember & { name: string };

/** Split members into live ones (with membership index) and stale ones, in membership order. */
export function partitionGroupMembers(members: readonly RepoGroupMember[]): {
    live: { member: LiveGroupMember; memberIndex: number }[];
    stale: RepoGroupMember[];
} {
    const live: { member: LiveGroupMember; memberIndex: number }[] = [];
    const stale: RepoGroupMember[] = [];
    members.forEach((member, memberIndex) => {
        if (member.stale || member.name === undefined) stale.push(member);
        else live.push({ member: member as LiveGroupMember, memberIndex });
    });
    return { live, stale };
}

/** Member counters and the status they imply, shared by file and content group search. */
export function groupSearchSummary(memberCount: number, searchableMemberCount: number, failedMemberCount: number) {
    const searchedMemberCount = searchableMemberCount - failedMemberCount;
    const unavailableMemberCount = memberCount - searchableMemberCount;
    const status = searchableMemberCount === 0
        ? 'no-searchable-members' as const
        : searchedMemberCount === 0
            ? 'failed' as const
            : failedMemberCount > 0 || unavailableMemberCount > 0 ? 'partial' as const : 'complete' as const;
    return { status, memberCount, searchableMemberCount, searchedMemberCount, unavailableMemberCount, failedMemberCount };
}

/** Validate controls in wire-error precedence: query, limit, then flags. */
export function parseGroupSearchControls(
    params: URLSearchParams,
    defaultLimit: number,
    maxLimit: number,
    flagNames: readonly string[],
): { query: string; limit: number; flags: Record<string, boolean> } | { error: string } {
    const queryValues = params.getAll('q');
    if (queryValues.length !== 1 || queryValues[0].length === 0) {
        return { error: 'Missing required query parameter: q' };
    }
    const limits = params.getAll('limit');
    if (limits.length > 1 || (limits.length === 1 && !/^-?\d+$/.test(limits[0]))) {
        return { error: 'Invalid query parameter: limit' };
    }
    const limit = limits.length === 0
        ? defaultLimit
        : Math.min(Math.max(Number(limits[0]), 1), maxLimit);
    const flags: Record<string, boolean> = {};
    for (const name of flagNames) {
        const values = params.getAll(name);
        if (values.length > 1 || (values.length === 1 && values[0] !== 'true' && values[0] !== 'false')) {
            return { error: `Invalid query parameter: ${name}` };
        }
        flags[name] = values[0] === 'true';
    }
    return { query: queryValues[0], limit, flags };
}

/** Dispatch at most `concurrency` jobs, retaining the input membership order. */
export async function mapBounded<T, R>(
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

