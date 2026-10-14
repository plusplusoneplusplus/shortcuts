/** Shared history paging and outgoing prefix used by the expanded Git view. */
export const COMMIT_PAGE_SIZE = 50;

export function outgoingCommits<T>(commits: readonly T[], unpushedCount: number): T[] {
    return commits.slice(0, unpushedCount);
}
