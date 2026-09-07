/** Compact member selector for a repo group's Git toolbar. */

import type { Ref } from 'react';
import type { RepoGroupMember } from './repoGroupService';
import type { RepoGroupMemberGitInfo } from './useRepoGroupMemberGitInfo';

export interface RepoGroupGitMemberPickerProps {
    members: readonly RepoGroupMember[];
    /** Currently hosted member id; undefined when no member is usable. */
    selectedId: string | undefined;
    onSelect: (memberId: string) => void;
    gitInfo: RepoGroupMemberGitInfo;
    selectRef?: Ref<HTMLSelectElement>;
}

export function RepoGroupGitMemberPicker({
    members,
    selectedId,
    onSelect,
    gitInfo,
    selectRef,
}: RepoGroupGitMemberPickerProps) {
    const selected = members.find(member => member.workspaceId === selectedId);

    return (
        <select
            ref={selectRef}
            aria-label="Member repository"
            data-testid="repo-group-git-member-picker"
            value={selectedId ?? ''}
            title={selected?.rootPath || selected?.name || 'Select a member repository'}
            onChange={event => {
                const member = members.find(candidate => candidate.workspaceId === event.target.value);
                if (member && !member.stale) onSelect(member.workspaceId);
            }}
            disabled={members.length === 0}
            className="h-6 min-w-0 max-w-[10rem] shrink rounded-md border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] px-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4] disabled:opacity-50"
        >
            {!selectedId && <option value="" disabled>No usable repositories</option>}
            {members.map(member => {
                const memberId = member.workspaceId;
                const info = gitInfo[memberId];
                const status = member.stale
                    ? [member.staleReason === 'workspace-removed' ? 'removed' : 'path missing']
                    : info?.isGitRepo
                        ? [info.branch, info.dirty && '●', (info.ahead ?? 0) > 0 && `↑${info.ahead}`, (info.behind ?? 0) > 0 && `↓${info.behind}`].filter(Boolean)
                        : [];
                return (
                    <option
                        key={memberId}
                        value={memberId}
                        disabled={member.stale === true}
                        data-testid={`repo-group-git-member-${memberId}`}
                    >
                        {member.name || memberId}{status.length > 0 ? ` — ${status.join(' ')}` : ''}
                    </option>
                );
            })}
        </select>
    );
}
