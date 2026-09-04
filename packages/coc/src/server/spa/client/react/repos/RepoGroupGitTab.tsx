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
 * A picker above the panel lists every member with its git status badge, so the
 * user switches repos inside the group without leaving the tab. Stale members
 * (`workspace-removed` / `path-missing`) are listed but disabled and are never
 * selected: they have no usable root path, so the host falls back to the first
 * healthy member.
 */

import { useCallback, useMemo, useState } from 'react';
import { RepoGitTab } from '../features/git/RepoGitTab';
import { RepoGroupGitMemberPicker } from './RepoGroupGitMemberPicker';
import type { RepoGroupMember } from './repoGroupService';
import { useRepoGroupMemberGitInfo } from './useRepoGroupMemberGitInfo';

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
    // What the user last clicked. It is a *preference*, not the answer: a member
    // that goes stale (or leaves the group) falls back to the first healthy one
    // without the user having to re-pick.
    const [preferredId, setPreferredId] = useState<string | null>(null);
    const selectedId = useMemo(
        () => resolveRepoGroupGitMember(members, preferredId),
        [members, preferredId],
    );

    // Badges for every member the picker can select, from one batch request.
    const healthyIds = useMemo(
        () => healthyRepoGroupMembers(members ?? []).map(member => member.workspaceId),
        [members],
    );
    const gitInfo = useRepoGroupMemberGitInfo(healthyIds);

    const handleSelect = useCallback((memberId: string) => setPreferredId(memberId), []);

    if (members === undefined) {
        return (
            <div className="text-xs text-[#848484] px-3 py-2" data-testid="repo-group-git-loading">
                Loading member repos…
            </div>
        );
    }

    return (
        <div
            className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden"
            data-testid="repo-group-git-tab"
            data-group={workspaceId}
            data-member={selectedId ?? ''}
        >
            <RepoGroupGitMemberPicker
                members={members}
                selectedId={selectedId}
                onSelect={handleSelect}
                gitInfo={gitInfo}
            />
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                {selectedId ? (
                    <RepoGitTab key={selectedId} workspaceId={selectedId} />
                ) : (
                    // Every member is stale (or the group is empty): the picker
                    // above still lists them so the user can see why.
                    <div className="text-xs text-[#848484] px-3 py-2" data-testid="repo-group-git-empty">
                        This group has no usable member repo to show git history for.
                    </div>
                )}
            </div>
        </div>
    );
}
