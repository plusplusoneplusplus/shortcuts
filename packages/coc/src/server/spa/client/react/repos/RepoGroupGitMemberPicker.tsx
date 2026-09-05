/**
 * RepoGroupGitMemberPicker — the row of member repos at the top of a group's
 * Git tab.
 *
 * One repo at a time: clicking a member re-points the hosted single-repo git
 * panel at it. Each entry carries the member's git status — branch, a dirty dot,
 * ahead/behind counts — so the user can see which repo has work in it before
 * switching. Stale members are listed but disabled: `workspace-removed` has no
 * workspace left to talk to and `path-missing` has no worktree, so there is
 * nothing a git panel could show.
 */

import type { GitInfoResponse } from '@plusplusoneplusplus/coc-client';
import type { RepoGroupMember } from './repoGroupService';
import type { RepoGroupMemberGitInfo } from './useRepoGroupMemberGitInfo';

/** Label suffix explaining why a member is unusable; mirrors RepoGroupMemberList. */
function staleBadgeLabel(reason: RepoGroupMember['staleReason']): string {
    return reason === 'workspace-removed' ? 'removed' : 'path missing';
}

function staleBadgeTitle(reason: RepoGroupMember['staleReason']): string {
    return reason === 'workspace-removed'
        ? 'This workspace is no longer registered in CoC'
        : 'The repo folder no longer exists on disk';
}

/** Branch + dirty + ahead/behind, or nothing at all while the batch is in flight. */
function MemberGitBadge({ memberId, info }: { memberId: string; info: GitInfoResponse | null | undefined }) {
    if (!info || !info.isGitRepo) return null;
    const ahead = info.ahead ?? 0;
    const behind = info.behind ?? 0;
    return (
        <span
            className="flex items-center gap-1 text-[10px] text-[#848484]"
            data-testid={`repo-group-git-member-badge-${memberId}`}
        >
            {info.branch && (
                <span className="truncate max-w-[10rem]" title={`On branch ${info.branch}`}>
                    {info.branch}
                </span>
            )}
            {info.dirty && (
                <span
                    data-testid={`repo-group-git-member-dirty-${memberId}`}
                    title="Uncommitted changes"
                    className="text-[#bc4c00] dark:text-[#f0883e]"
                >
                    ●
                </span>
            )}
            {ahead > 0 && (
                <span data-testid={`repo-group-git-member-ahead-${memberId}`} title={`${ahead} commit(s) not pushed`}>
                    ↑{ahead}
                </span>
            )}
            {behind > 0 && (
                <span data-testid={`repo-group-git-member-behind-${memberId}`} title={`${behind} commit(s) behind`}>
                    ↓{behind}
                </span>
            )}
        </span>
    );
}

export interface RepoGroupGitMemberPickerProps {
    members: readonly RepoGroupMember[];
    /** Currently hosted member id; `undefined` when the group has no healthy member. */
    selectedId: string | undefined;
    onSelect: (memberId: string) => void;
    gitInfo: RepoGroupMemberGitInfo;
}

export function RepoGroupGitMemberPicker({
    members,
    selectedId,
    onSelect,
    gitInfo,
}: RepoGroupGitMemberPickerProps) {
    return (
        <div
            role="tablist"
            aria-label="Member repositories"
            data-testid="repo-group-git-member-picker"
            className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-[#e5e5e5] dark:border-[#2b2b2b] shrink-0"
        >
            {members.map(member => {
                const memberId = member.workspaceId;
                const selected = memberId === selectedId;
                return (
                    <button
                        key={memberId}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        disabled={member.stale === true}
                        data-testid={`repo-group-git-member-${memberId}`}
                        data-selected={selected ? 'true' : 'false'}
                        onClick={() => { if (!member.stale) onSelect(memberId); }}
                        title={member.stale ? staleBadgeTitle(member.staleReason) : member.rootPath || memberId}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
                            selected
                                ? 'border-[#0969da] bg-[#ddf4ff] text-[#0969da] dark:bg-[#0969da]/20 dark:text-[#58a6ff]'
                                : 'border-transparent text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f0f0f0] dark:hover:bg-[#2b2b2b]'
                        } ${member.stale ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span className="truncate max-w-[12rem]">{member.name || memberId}</span>
                        {member.stale ? (
                            <span
                                data-testid="repo-group-stale-badge"
                                className="px-1 rounded text-[10px] font-semibold bg-[#fff1e5] text-[#bc4c00] dark:bg-[#bc4c00]/20 dark:text-[#f0883e]"
                            >
                                {staleBadgeLabel(member.staleReason)}
                            </span>
                        ) : (
                            <MemberGitBadge memberId={memberId} info={gitInfo[memberId]} />
                        )}
                    </button>
                );
            })}
        </div>
    );
}
