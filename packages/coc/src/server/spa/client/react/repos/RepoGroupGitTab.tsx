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
 * A dropdown in the Git toolbar lists every member with its git status, so the
 * user switches repos inside the group without leaving the tab. Stale members
 * (`workspace-removed` / `path-missing`) are listed but disabled and are never
 * selected: they have no usable root path, so the host falls back to the first
 * healthy member.
 *
 * The pick is remembered per group id in the AppContext per-workspace memory
 * (`repoGroupGitMemberState`, persisted to localStorage), so returning to the
 * group — after a tab switch or a full reload — lands on the same member.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppOptional } from '../contexts/AppContext';
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
    /**
     * Split-workspace wiring, forwarded verbatim to the hosted `RepoGitTab` so a
     * group's git list can live inside `SplitWorkspacePanel` exactly like a
     * repo's does (AC-06). All optional: absent ⇒ the host renders the ordinary
     * standalone Git tab, unchanged.
     */
    layout?: 'split-workspace';
    /** Portal target for the git detail pane when `layout === 'split-workspace'`. */
    detailContainer?: HTMLElement | null;
    /** Only portal the detail while git holds the last click. */
    detailActive?: boolean;
    /** Fired when the user clicks in the git list. */
    onActivateDetail?: () => void;
    /** Portal target for the compact, hoisted git toolbar. */
    headerToolbarContainer?: HTMLElement | null;
}

/**
 * The remembered member pick for a group, backed by AppContext when it is
 * mounted and by local state otherwise (pop-out shells and unit tests render
 * this panel standalone, and a forgotten pick there is harmless).
 */
function useRepoGroupGitMemberPreference(groupId: string): [string | null, (memberId: string) => void] {
    const app = useAppOptional();
    const [localPreferredId, setLocalPreferredId] = useState<string | null>(null);
    const dispatch = app?.dispatch;
    const persisted = app?.state.repoGroupGitMemberState?.[groupId] ?? null;
    const setPreferred = useCallback((memberId: string) => {
        setLocalPreferredId(memberId);
        dispatch?.({ type: 'SET_REPO_GROUP_GIT_MEMBER', groupId, memberId });
    }, [dispatch, groupId]);
    return [app ? persisted : localPreferredId, setPreferred];
}

export function RepoGroupGitTab({
    workspaceId,
    members,
    layout,
    detailContainer,
    detailActive,
    onActivateDetail,
    headerToolbarContainer,
}: RepoGroupGitTabProps) {
    // What the user last picked, remembered across reloads. It is a
    // *preference*, not the answer: a member that goes stale (or leaves the
    // group) falls back to the first healthy one without the user re-picking.
    const [preferredId, setPreferredId] = useRepoGroupGitMemberPreference(workspaceId);
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

    const handleSelect = useCallback((memberId: string) => setPreferredId(memberId), [setPreferredId]);
    const selectorRef = useRef<HTMLSelectElement | null>(null);
    const restoreSelectorFocus = useRef(false);
    // The keyed Git panel and its loading/error views remount the selector.
    // Carry keyboard focus with it so arrow-key navigation can continue.
    const setSelectorRef = useCallback((element: HTMLSelectElement | null) => {
        if (!element && selectorRef.current === document.activeElement) {
            restoreSelectorFocus.current = true;
        }
        selectorRef.current = element;
        if (element && restoreSelectorFocus.current) {
            element.focus();
            restoreSelectorFocus.current = false;
        }
    }, []);

    if (members === undefined) {
        return (
            <div className="text-xs text-[#848484] px-3 py-2" data-testid="repo-group-git-loading">
                Loading member repos…
            </div>
        );
    }

    const repositorySelector = (
        <RepoGroupGitMemberPicker
            members={members}
            selectedId={selectedId}
            onSelect={handleSelect}
            gitInfo={gitInfo}
            selectRef={setSelectorRef}
        />
    );

    return (
        <div
            className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden"
            data-testid="repo-group-git-tab"
            data-group={workspaceId}
            data-member={selectedId ?? ''}
        >
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                {selectedId ? (
                    <RepoGitTab
                        key={selectedId}
                        workspaceId={selectedId}
                        repositorySelector={repositorySelector}
                        layout={layout}
                        detailContainer={detailContainer}
                        detailActive={detailActive}
                        onActivateDetail={onActivateDetail}
                        headerToolbarContainer={headerToolbarContainer}
                    />
                ) : (
                    <div className="text-xs text-[#848484] px-3 py-2" data-testid="repo-group-git-empty">
                        {repositorySelector}
                        <p className="mt-2">This group has no usable member repo to show git history for.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
