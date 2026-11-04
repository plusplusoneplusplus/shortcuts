/**
 * panelGitCommit — open one commit in the workspace's split Git detail (the
 * unified right panel's Git tab) without leaving the current surface.
 *
 * Generic hash navigation switches the workspace sub-tab, so callers that
 * must keep the chat or rail on screen publish the Git route in place:
 * `replaceState` the URL, remember the route suffix, and dispatch the atomic
 * `SET_GIT_ROUTE` the router would have produced. The mounted `RepoGitTab` (or
 * group member host) then selects the commit, or all working changes, and
 * opens its panel tab.
 */

import type { CocClient, GitCommit } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor, getSpaCocClient } from '../../../api/cocClient';
import type { AppAction } from '../../../contexts/AppContext';
import { buildGitRouteHash, buildGitRouteSuffix } from '../../../layout/gitRoute';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { isRepoGroupWorkspaceId } from '../../../repos/virtualWorkspaceIds';
import type { WorkspaceOwner } from '../../../repos/workspaceOwnerContext';
import { BRANCH_RANGE_DEEP_LINK, WORKING_CHANGES_DEEP_LINK } from '../../git/repoGitTab/useRepoGitSelection';
import type { UnifiedPanelHost } from './unifiedPanelHost';
import type { UnifiedPanelTab } from './unifiedPanelTabsModel';
import { routingRefForPanelOwner } from './unifiedPanelOwnerRouting';

export interface PanelGitCommitTarget {
    /** Workspace that owns the page: the group selection id, or the repo itself. */
    routeWorkspaceId: string;
    /** Workspace that owns the git data (the group member, or the repo). */
    workspaceId: string;
    /** Concrete clone owner of the git data (remote clone key or local id). */
    sourceSelectionId: string;
}

function publishPanelGitRoute(
    dispatch: (action: AppAction) => void,
    { routeWorkspaceId, workspaceId, sourceSelectionId }: PanelGitCommitTarget,
    commitHash: string,
    extra: Pick<Extract<AppAction, { type: 'SET_GIT_ROUTE' }>, 'knownCommit' | 'openRequest'>,
): void {
    const route = { routeWorkspaceId, workspaceId, commitHash, filePath: null };
    const routeSelectionId = routeWorkspaceId === workspaceId ? sourceSelectionId : routeWorkspaceId;
    window.history.replaceState(null, '', buildGitRouteHash({ ...route, routeWorkspaceId: routeSelectionId }));
    dispatch({ type: 'RECORD_REPO_ROUTE_SUFFIX', repoId: routeSelectionId, suffix: buildGitRouteSuffix(route) });
    dispatch({ type: 'SET_GIT_ROUTE', ...route, ...extra });
}

export function openPanelGitCommit(
    dispatch: (action: AppAction) => void,
    target: PanelGitCommitTarget,
    commitHash: string,
    knownCommit?: GitCommit,
): void {
    publishPanelGitRoute(dispatch, target, commitHash,
        knownCommit ? { knownCommit: { sourceSelectionId: target.sourceSelectionId, commit: knownCommit } } : {});
}

/**
 * Open the target's pending working-tree changes (staged, unstaged and
 * untracked) in the panel's Git tab. Each call carries a fresh open request,
 * so it reapplies even when the route is unchanged and its detail was closed.
 */
export function openPanelGitWorkingChanges(
    dispatch: (action: AppAction) => void,
    target: PanelGitCommitTarget,
): void {
    publishPanelGitRoute(dispatch, target, WORKING_CHANGES_DEEP_LINK, { openRequest: {} });
}

/**
 * Open the target's branch changes (its commits against the base branch) in
 * the panel's Git tab, with a fresh open request like the working changes.
 */
export function openPanelGitBranchChanges(
    dispatch: (action: AppAction) => void,
    target: PanelGitCommitTarget,
): void {
    publishPanelGitRoute(dispatch, target, BRANCH_RANGE_DEEP_LINK, { openRequest: {} });
}

/**
 * The panel Git target for a chat's own commits, or null when the hosting
 * panel cannot show them: a group-level chat names no member repo, and a repo
 * panel only hosts its own repository.
 */
export function chatCommitPanelTarget(
    host: UnifiedPanelHost,
    chatWorkspaceId: string | undefined,
): PanelGitCommitTarget | null {
    if (!chatWorkspaceId || isRepoGroupWorkspaceId(chatWorkspaceId)) return null;
    if (isRepoGroupWorkspaceId(host.workspaceId)) {
        return {
            routeWorkspaceId: host.routingRef ?? host.workspaceId,
            workspaceId: chatWorkspaceId,
            sourceSelectionId: routingRefForPanelOwner(host.routingRef, chatWorkspaceId) ?? chatWorkspaceId,
        };
    }
    if (chatWorkspaceId !== host.workspaceId) return null;
    return {
        routeWorkspaceId: host.workspaceId,
        workspaceId: host.workspaceId,
        sourceSelectionId: host.routingRef ?? host.workspaceId,
    };
}

/** A repository a Git tab's Open menu reads recent commits from and opens. */
export interface GitTabOpenOwner {
    /** Workspace that owns the git data (the repo, or a group member). */
    workspaceId: string;
    label: string;
    target: PanelGitCommitTarget;
}

/**
 * Who a Git tab's Open menu targets, from the tab's own owner fields: the repo
 * itself, or the group member its view names. A group tab with no member
 * names no owner, so `owner` is null and `choices` lists the live members
 * for an explicit pick — the menu never guesses one.
 */
export function gitTabOpenOwners(
    tab: Pick<UnifiedPanelTab, 'ownerWorkspaceId' | 'ownerRoutingRef' | 'gitMemberId'>,
    members: readonly { workspaceId: string; label: string }[],
): { owner: GitTabOpenOwner | null; choices: GitTabOpenOwner[] } {
    const host: UnifiedPanelHost = { workspaceId: tab.ownerWorkspaceId, chatId: null, routingRef: tab.ownerRoutingRef };
    const ownerOf = (workspaceId: string, label: string): GitTabOpenOwner | null => {
        const target = chatCommitPanelTarget(host, workspaceId);
        return target && { workspaceId, label, target };
    };
    if (!isRepoGroupWorkspaceId(tab.ownerWorkspaceId)) {
        return { owner: ownerOf(tab.ownerWorkspaceId, tab.ownerWorkspaceId), choices: [] };
    }
    if (tab.gitMemberId) {
        const label = members.find(member => member.workspaceId === tab.gitMemberId)?.label ?? tab.gitMemberId;
        return { owner: ownerOf(tab.gitMemberId, label), choices: [] };
    }
    return {
        owner: null,
        choices: members.flatMap(member => ownerOf(member.workspaceId, member.label) ?? []),
    };
}

export const GIT_OPEN_RECENT_LIMIT = 5;

/** What a Git tab's Open submenu shows and does. */
export interface UnifiedPanelGitOpenSource {
    /** The tab's own repository, or null when a group tab names none. */
    owner: GitTabOpenOwner | null;
    /** Group members offered for an explicit choice when `owner` is null. */
    choices: readonly GitTabOpenOwner[];
    /** Set when the owning server cannot be reached; recent commits are not read. */
    unavailable?: string;
    /** Up to `GIT_OPEN_RECENT_LIMIT` newest commits, read from the owner's own server. */
    loadRecent: (owner: GitTabOpenOwner) => Promise<readonly GitCommit[]>;
    /** Open the owner's working tree (`null`) or one commit in the panel's Git tab. */
    open: (owner: GitTabOpenOwner, commit: GitCommit | null) => void;
}

/**
 * The client of the server that owns a Git tab's data, or null when that
 * server is remote and not connected — never the page origin in its place.
 * Group members live on the group's server, so a group tab reads through it.
 */
export function gitTabOwnerClient(
    tab: Pick<UnifiedPanelTab, 'ownerWorkspaceId' | 'ownerRoutingRef'>,
    workspaceOwner: WorkspaceOwner | null,
    groupBaseUrl?: string,
): CocClient | null {
    const ref = tab.ownerRoutingRef === null ? undefined : tab.ownerRoutingRef ?? tab.ownerWorkspaceId;
    if (workspaceOwner && ref !== undefined && (ref === workspaceOwner.selectionId || ref === workspaceOwner.workspaceId)) {
        return workspaceOwner.client ?? getCocClientFor(workspaceOwner.baseUrl);
    }
    const route = resolveCloneRoute(ref);
    if (route.kind === 'remote') return getCocClientFor(route.baseUrl);
    if (groupBaseUrl) return getCocClientFor(groupBaseUrl);
    return route.kind === 'local' ? getSpaCocClient() : null;
}

/** The Open submenu source of a Git tab; `client` comes from `gitTabOwnerClient`. */
export function gitTabOpenSource(
    tab: Pick<UnifiedPanelTab, 'ownerWorkspaceId' | 'ownerRoutingRef' | 'gitMemberId'>,
    members: readonly { workspaceId: string; label: string }[],
    dispatch: (action: AppAction) => void,
    client: CocClient | null,
): UnifiedPanelGitOpenSource {
    return {
        ...gitTabOpenOwners(tab, members),
        ...(client ? {} : { unavailable: 'Recent commits unavailable: the owning server is not connected.' }),
        loadRecent: async owner => {
            if (!client) throw new Error('The owning server is not connected.');
            const result = await client.git.listCommits(owner.workspaceId, { limit: GIT_OPEN_RECENT_LIMIT, refresh: true });
            return result.commits.slice(0, GIT_OPEN_RECENT_LIMIT);
        },
        open: (owner, commit) => {
            if (commit) openPanelGitCommit(dispatch, owner.target, commit.hash, commit);
            else openPanelGitWorkingChanges(dispatch, owner.target);
        },
    };
}
