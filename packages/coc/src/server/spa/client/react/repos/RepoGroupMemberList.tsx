/**
 * RepoGroupMemberList — the group's member repos with an inline-editable
 * description per row.
 *
 * A description says what the repo is for inside THIS group; the server appends
 * it to the member listing it injects into new chats, so it is the one place a
 * user can tell the model "this one is the API, that one is the UI".
 *
 * Editing is deliberately plain: type in the row's single-line field, then Enter
 * or blur to save, Escape to cancel. The save is optimistic — the typed text
 * stays on screen while the PATCH is in flight and is rolled back to the last
 * known value, with the server's message shown under the row, if it fails.
 *
 * The component never refetches: `members` is the loaded snapshot, and locally
 * saved descriptions are held as overrides on top of it, so a save does not cost
 * a round-trip through the parent.
 */

import { useCallback, useRef, useState } from 'react';
import {
    updateRepoGroup,
    REPO_GROUP_DESCRIPTION_MAX_LENGTH,
    type RepoGroupMember,
} from './repoGroupService';
import { getRepositoryApiErrorMessage } from './repositoryService';

/** Muted prompt shown in an empty description field. */
export const REPO_GROUP_DESCRIPTION_PLACEHOLDER = 'Add description';

/** Label suffix explaining why a member is unusable; mirrors RepoGroupView. */
function staleBadgeLabel(reason: RepoGroupMember['staleReason']): string {
    return reason === 'workspace-removed' ? 'removed' : 'path missing';
}

export interface RepoGroupMemberListProps {
    /** The `group-<slug>` workspace id owning these members. */
    workspaceId: string;
    /** Base URL of the server owning the group; omit for a local group. */
    baseUrl?: string;
    /** Members as resolved by `GET /api/repo-groups/:id`. */
    members: readonly RepoGroupMember[];
}

export function RepoGroupMemberList({ workspaceId, baseUrl, members }: RepoGroupMemberListProps) {
    // Text being typed, per member — absent means "not editing, show the saved
    // value". `saved` holds descriptions this component has written since the
    // snapshot in `members` was loaded.
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [saved, setSaved] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    // Escape reverts and blurs the field; the blur handler must not then treat
    // the (already dropped) draft as a save.
    const skipBlur = useRef<Set<string>>(new Set());

    const committed = useCallback((member: RepoGroupMember): string => {
        return saved[member.workspaceId] ?? member.description ?? '';
    }, [saved]);

    const dropDraft = useCallback((memberId: string) => {
        setDrafts(prev => {
            if (!(memberId in prev)) return prev;
            const next = { ...prev };
            delete next[memberId];
            return next;
        });
    }, []);

    const commit = useCallback(async (member: RepoGroupMember) => {
        const memberId = member.workspaceId;
        const draft = drafts[memberId];
        dropDraft(memberId);
        if (draft === undefined) return;
        const next = draft.trim();
        const previous = committed(member);
        if (next === previous) return;

        setSaved(prev => ({ ...prev, [memberId]: next }));
        setErrors(prev => {
            if (!(memberId in prev)) return prev;
            const rest = { ...prev };
            delete rest[memberId];
            return rest;
        });
        try {
            await updateRepoGroup(workspaceId, { descriptions: { [memberId]: next } }, baseUrl);
        } catch (err: unknown) {
            setSaved(prev => ({ ...prev, [memberId]: previous }));
            setErrors(prev => ({
                ...prev,
                [memberId]: getRepositoryApiErrorMessage(err, 'Failed to save description'),
            }));
        }
    }, [drafts, dropDraft, committed, workspaceId, baseUrl]);

    if (members.length === 0) {
        return (
            <div className="text-xs text-[#848484] px-3 py-2" data-testid="repo-group-members-empty">
                This group has no member repos yet. Add some from the group menu → Edit group.
            </div>
        );
    }

    return (
        <div className="flex flex-col" data-testid="repo-group-member-list">
            {members.map(member => {
                const memberId = member.workspaceId;
                const value = drafts[memberId] ?? committed(member);
                const error = errors[memberId];
                return (
                    <div
                        key={memberId}
                        className="flex flex-col gap-0.5 px-3 py-1.5 text-xs border-b border-[#f0f0f0] dark:border-[#2a2a2a] last:border-b-0"
                        data-testid={`repo-group-member-row-${memberId}`}
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc] shrink-0">
                                {member.name || memberId}
                            </span>
                            {member.stale && (
                                <span
                                    data-testid="repo-group-stale-badge"
                                    title={member.staleReason === 'workspace-removed'
                                        ? 'This workspace is no longer registered in CoC'
                                        : 'The repo folder no longer exists on disk'}
                                    className="px-1 rounded text-[10px] font-semibold bg-[#fff1e5] text-[#bc4c00] dark:bg-[#bc4c00]/20 dark:text-[#f0883e]"
                                >
                                    {staleBadgeLabel(member.staleReason)}
                                </span>
                            )}
                            {member.rootPath && (
                                <span className="text-[#848484] truncate">{member.rootPath}</span>
                            )}
                        </div>
                        <input
                            type="text"
                            value={value}
                            maxLength={REPO_GROUP_DESCRIPTION_MAX_LENGTH}
                            placeholder={REPO_GROUP_DESCRIPTION_PLACEHOLDER}
                            aria-label={`Description for ${member.name || memberId}`}
                            data-testid={`repo-group-member-description-${memberId}`}
                            onChange={e => setDrafts(prev => ({ ...prev, [memberId]: e.target.value }))}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    // The blur below must not commit a second
                                    // time: this render's `drafts` is still the
                                    // pre-commit one, so it would re-PATCH.
                                    skipBlur.current.add(memberId);
                                    void commit(member);
                                    (e.target as HTMLInputElement).blur();
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    skipBlur.current.add(memberId);
                                    dropDraft(memberId);
                                    (e.target as HTMLInputElement).blur();
                                }
                            }}
                            onBlur={() => {
                                if (skipBlur.current.delete(memberId)) return;
                                void commit(member);
                            }}
                            className="px-1.5 py-0.5 rounded border border-transparent bg-transparent text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#a0a0a0] dark:placeholder:text-[#6a6a6a] outline-none hover:border-[#e0e0e0] dark:hover:border-[#3c3c3c] focus:border-[#0078d4] focus:bg-white dark:focus:bg-[#1e1e1e]"
                        />
                        {error && (
                            <div
                                className="text-[11px] text-red-700 dark:text-red-400 px-1.5"
                                data-testid={`repo-group-member-description-error-${memberId}`}
                            >
                                {error}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
