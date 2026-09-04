/**
 * RepoGroupGitTab — the Git tab of a repo-group virtual workspace.
 *
 * A group is not a git repo itself (its root holds only `group.json`), so this
 * is a HOST, not a git implementation: it picks one member repo and renders the
 * ordinary single-repo `RepoGitTab` against that member's `workspaceId`. Every
 * git endpoint is already `/api/workspaces/:id/git*` and every git hook takes an
 * explicit workspace id, so full parity comes for free — including members owned
 * by a remote CoC server, which route through `useCocClient(workspaceId)`.
 *
 * Stale members (`workspace-removed` / `path-missing`) are never selected: they
 * have no usable root path, so the host falls back to the first healthy member.
 */

import { useMemo } from 'react';
import { RepoGitTab } from '../features/git/RepoGitTab';
import type { RepoGroupMember } from './repoGroupService';

/** Members that can actually back a git panel: registered and present on disk. */
export function healthyRepoGroupMembers(members: readonly RepoGroupMember[]): RepoGroupMember[] {
    return members.filter(member => !member.stale);
}

/**
 * Resolve which member the git panel should show. `preferred` is honoured only
 * when it is still a healthy member of the group; otherwise the first healthy
 * member wins, and `undefined` means "nothing to show".
 */
export function resolveRepoGroupGitMember(
    members: readonly RepoGroupMember[] | undefined,
    preferred: string | null | undefined,
): string | undefined {
    const healthy = healthyRepoGroupMembers(members ?? []);
    if (preferred && healthy.some(member => member.workspaceId === preferred)) return preferred;
    return healthy[0]?.workspaceId;
}

export interface RepoGroupGitTabProps {
    /** The `group-<slug>` workspace id whose Git tab this is. */
    workspaceId: string;
    /** Members as resolved by `GET /api/repo-groups/:id`; `undefined` = loading. */
    members: readonly RepoGroupMember[] | undefined;
}

export function RepoGroupGitTab({ workspaceId, members }: RepoGroupGitTabProps) {
    const selectedId = useMemo(() => resolveRepoGroupGitMember(members, null), [members]);

    if (members === undefined) {
        return (
            <div className="text-xs text-[#848484] px-3 py-2" data-testid="repo-group-git-loading">
                Loading member repos…
            </div>
        );
    }

    if (!selectedId) {
        return (
            <div className="text-xs text-[#848484] px-3 py-2" data-testid="repo-group-git-empty">
                This group has no usable member repo to show git history for.
            </div>
        );
    }

    return (
        <div
            className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden"
            data-testid="repo-group-git-tab"
            data-group={workspaceId}
            data-member={selectedId}
        >
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <RepoGitTab key={selectedId} workspaceId={selectedId} />
            </div>
        </div>
    );
}
