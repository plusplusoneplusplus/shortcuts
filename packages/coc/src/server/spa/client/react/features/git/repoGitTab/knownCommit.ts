/**
 * knownCommit — hands an already-read commit from the surface that opened it
 * (e.g. the rail's outgoing list) to the Git detail that restores it from a
 * `coc://git` address, so a commit outside the loaded history page shows at
 * once instead of waiting on a `getCommit` refetch.
 *
 * One slot is enough: only the latest explicit open is ever being restored.
 */

import type { GitCommitItem } from '../commits/CommitList';

let known: { workspaceId: string; commit: GitCommitItem } | null = null;

/** Remember the commit an explicit open is about to address. */
export function rememberKnownCommit(workspaceId: string, commit: GitCommitItem): void {
    known = { workspaceId, commit };
}

/** The remembered commit for this workspace and exact hash, if any. */
export function knownCommitFor(workspaceId: string, hash: string): GitCommitItem | null {
    return known && known.workspaceId === workspaceId && known.commit.hash === hash ? known.commit : null;
}

export function resetKnownCommitForTests(): void {
    known = null;
}
