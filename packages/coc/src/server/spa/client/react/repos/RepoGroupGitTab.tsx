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
 * The GROUP stays the selected page while you browse a member's history: the
 * hosted panel gets the group as `routeWorkspaceId` and the member as
 * `workspaceId`, so its URLs read `#repos/{groupId}/git/member/{memberId}/…`.
 * The member lives in the URL because a group id plus a SHA cannot identify a
 * repository once the remembered member changes — reload, Back/Forward and a
 * shared link all have to agree on which repo the commit came from.
 *
 * A dropdown in the Git toolbar lists every member with its git status, so the
 * user switches repos inside the group without leaving the tab. Stale members
 * (`workspace-removed` / `path-missing`) are listed but disabled and are never
 * selected: they have no usable root path, so the host falls back to the first
 * healthy member.
 *
 * The pick is remembered per group id in the AppContext per-workspace memory
 * (`repoGroupGitMemberState`, persisted to localStorage), so a group entry with
 * no member in the URL — and any older `/git/{sha}` link — lands on the same
 * member. An explicit member in the URL always wins over that preference.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppOptional } from '../contexts/AppContext';
import { RepoGitTab } from '../features/git/RepoGitTab';
import { buildGitRouteHash, buildGitRouteSuffix } from '../layout/gitRoute';
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
    const app = useAppOptional();
    const dispatch = app?.dispatch;

    // What the user last picked, remembered across reloads. It is a
    // *preference*, not the answer: it only decides a route that never named a
    // member, and a member that goes stale (or leaves the group) falls back to
    // the first healthy one without the user re-picking.
    const [preferredId, setPreferredId] = useRepoGroupGitMemberPreference(workspaceId);

    // The Git route the router published, but only while it addresses THIS
    // group. Anything else (another workspace's git route, or none at all —
    // pop-out shells and unit tests) leaves the host on preference-only rules.
    const scope = app?.state.gitRouteScope ?? null;
    const routeOwnsThisGroup = scope?.routeWorkspaceId === workspaceId;
    const routedMemberId = routeOwnsThisGroup ? (scope?.workspaceId ?? null) : null;
    const routeCommitHash = routeOwnsThisGroup ? (app?.state.selectedGitCommitHash ?? null) : null;
    const routeFilePath = routeOwnsThisGroup ? (app?.state.selectedGitFilePath ?? null) : null;

    const healthyIds = useMemo(
        () => healthyRepoGroupMembers(members ?? []).map(member => member.workspaceId),
        [members],
    );
    const membersLoaded = members !== undefined;
    const routedMemberIsHealthy = !!routedMemberId && healthyIds.includes(routedMemberId);

    /**
     * The member to mount. An explicit member in the URL wins outright — it is
     * either healthy (mount it) or unavailable (mount nothing and say so). With
     * no member in the URL the remembered preference decides, and the effect
     * below rewrites the URL into the explicit form.
     */
    const selectedId = useMemo(() => {
        if (routedMemberId) return routedMemberIsHealthy ? routedMemberId : undefined;
        return resolveRepoGroupGitMember(members, preferredId);
    }, [routedMemberId, routedMemberIsHealthy, members, preferredId]);

    /**
     * An explicitly requested member that is stale, removed, or not in the
     * group. A group with no healthy member at all is a different story — it
     * keeps its ordinary empty state rather than blaming the link.
     */
    const unavailableMemberId = membersLoaded && routedMemberId && !routedMemberIsHealthy && healthyIds.length > 0
        ? routedMemberId
        : null;

    /** Rewrite the current group Git URL into its explicit-member form, in place. */
    const canonicalizeToMember = useCallback((memberId: string) => {
        const descriptor = {
            routeWorkspaceId: workspaceId,
            workspaceId: memberId,
            commitHash: routeCommitHash,
            filePath: routeFilePath,
        };
        const hash = buildGitRouteHash(descriptor);
        // `replaceState` deliberately adds no Back step — and emits no
        // `hashchange` — so the route effects the router would have produced
        // are dispatched by hand.
        if (location.hash !== hash) window.history.replaceState(null, '', hash);
        dispatch?.({ type: 'SET_GIT_ROUTE', ...descriptor });
        dispatch?.({
            type: 'RECORD_REPO_ROUTE_SUFFIX',
            repoId: workspaceId,
            suffix: buildGitRouteSuffix(descriptor),
        });
    }, [dispatch, workspaceId, routeCommitHash, routeFilePath]);

    // Membership is the only thing that can validate a member, so nothing is
    // selected, canonicalized or persisted until it has loaded.
    useEffect(() => {
        if (!membersLoaded || !routeOwnsThisGroup) return;
        if (routedMemberId) {
            // A validated explicit member becomes the remembered choice.
            if (routedMemberIsHealthy && preferredId !== routedMemberId) setPreferredId(routedMemberId);
            return;
        }
        // Group entry, or an older `/git/{sha}` link: resolve the member the
        // same way the preference always did, then make the URL say so.
        const resolved = resolveRepoGroupGitMember(members, preferredId);
        if (!resolved) return;
        canonicalizeToMember(resolved);
        if (preferredId !== resolved) setPreferredId(resolved);
    }, [
        membersLoaded, routeOwnsThisGroup, routedMemberId, routedMemberIsHealthy,
        members, preferredId, setPreferredId, canonicalizeToMember,
    ]);

    // Badges for every member the picker can select, from one batch request.
    const gitInfo = useRepoGroupMemberGitInfo(healthyIds);

    /**
     * Switching member is a NAVIGATION, not a local state change: it routes to
     * the new member's history, which clears the previous member's commit and
     * file before the keyed panel mounts.
     */
    const handleSelect = useCallback((memberId: string) => {
        if (memberId === selectedId) return;
        if (!healthyIds.includes(memberId)) return;
        setPreferredId(memberId);
        if (routeOwnsThisGroup) {
            location.hash = buildGitRouteHash({
                routeWorkspaceId: workspaceId,
                workspaceId: memberId,
                commitHash: null,
                filePath: null,
            });
        }
    }, [selectedId, healthyIds, setPreferredId, routeOwnsThisGroup, workspaceId]);

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
                        routeWorkspaceId={workspaceId}
                        repositorySelector={repositorySelector}
                        layout={layout}
                        detailContainer={detailContainer}
                        detailActive={detailActive}
                        onActivateDetail={onActivateDetail}
                        headerToolbarContainer={headerToolbarContainer}
                    />
                ) : unavailableMemberId ? (
                    // The link names a repo this group cannot show. Keep the
                    // group open and the picker usable rather than silently
                    // resolving the commit against some other member's history.
                    <div
                        className="text-xs text-[#848484] px-3 py-2"
                        data-testid="repo-group-git-unavailable-member"
                        data-requested-member={unavailableMemberId}
                    >
                        {repositorySelector}
                        <p className="mt-2">
                            This link points at a repository that is no longer part of this group. Pick
                            one of its repositories to continue.
                        </p>
                    </div>
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
