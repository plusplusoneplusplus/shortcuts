/**
 * panelGitCommit — open one commit in the workspace's `coc://git` page
 * without leaving the current surface.
 *
 * Every caller here names its target the same way it always has — a page
 * owner, a data member and that member's concrete clone key
 * (`PanelGitCommitTarget`) — but the open itself now builds a `coc://git`
 * address and reveals/focuses that single workspace page tab
 * (`openPanelWorkspaceResource`) instead of publishing a hash route and an
 * `AppContext` action. Reopening the page with the same address still
 * reveals/focuses it: there is no need for a "fresh open" token the way the
 * old hash route needed one to force a re-apply. A caller that already read
 * the commit passes it along (`knownCommit.ts`) so the detail skips a refetch.
 */

import type { CocClient, GitCommit } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor, getSpaCocClient } from '../../../api/cocClient';
import type { AppAction } from '../../../contexts/AppContext';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { buildRemoteCloneKey, parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import { isRepoGroupWorkspaceId } from '../../../repos/virtualWorkspaceIds';
import type { WorkspaceOwner } from '../../../repos/workspaceOwnerContext';
import { rememberKnownCommit } from '../../git/repoGitTab/knownCommit';
import type { PersistedGitView } from '../../git/repoGitTab/types';
import type { UnifiedPanelHost } from './unifiedPanelHost';
import type { UnifiedPanelTab } from './unifiedPanelTabsModel';
import { routingRefForPanelOwner } from './unifiedPanelOwnerRouting';
import { openPanelWorkspaceResource } from './unifiedPanelWorkspaceResources';
import { parseCocAddress } from './unifiedPanelAddresses';

export interface PanelGitCommitTarget {
    /** Workspace that owns the page: the group selection id, or the repo itself. */
    routeWorkspaceId: string;
    /** Workspace that owns the git data (the group member, or the repo). */
    workspaceId: string;
    /** Concrete clone owner of the git data (remote clone key or local id). */
    sourceSelectionId: string;
}

/**
 * The page owner's panel scope (a raw workspace id) and routing ref. A remote
 * group's `routeWorkspaceId` is already its clone key, so it names both. A
 * raw id takes its ref from the data member's (`sourceSelectionId`): for an
 * ordinary repo they are the same clone, and for a group member a remote key
 * names the server, so the group root is addressed on that same server.
 */
function panelGitOwner(target: PanelGitCommitTarget): { workspaceId: string; routingRef: string | null } {
    const routeRemote = parseRemoteCloneKey(target.routeWorkspaceId);
    if (routeRemote) return { workspaceId: routeRemote.workspaceId, routingRef: target.routeWorkspaceId };
    if (target.routeWorkspaceId === target.workspaceId) {
        return {
            workspaceId: target.routeWorkspaceId,
            routingRef: target.sourceSelectionId !== target.workspaceId ? target.sourceSelectionId : null,
        };
    }
    const remote = parseRemoteCloneKey(target.sourceSelectionId);
    return {
        workspaceId: target.routeWorkspaceId,
        routingRef: remote ? buildRemoteCloneKey(remote.serverId, target.routeWorkspaceId) : null,
    };
}

function openPanelGitView(target: PanelGitCommitTarget, view?: PersistedGitView): void {
    const owner = { ...panelGitOwner(target), chatId: null };
    const gitMemberId = owner.workspaceId === target.workspaceId ? undefined : target.workspaceId;
    openPanelWorkspaceResource('git', owner, { gitMemberId, view });
}

/**
 * Open the target member's plain history (no view) in the panel's Git page —
 * a group's member switch with no specific commit in mind.
 */
export function openPanelGitMember(
    _dispatch: (action: AppAction) => void,
    target: PanelGitCommitTarget,
): void {
    openPanelGitView(target);
}

export function openPanelGitCommit(
    _dispatch: (action: AppAction) => void,
    target: PanelGitCommitTarget,
    commitHash: string,
    knownCommit?: GitCommit,
): void {
    if (knownCommit?.hash === commitHash) rememberKnownCommit(target.workspaceId, knownCommit);
    openPanelGitView(target, { type: 'commit', hash: commitHash });
}

/**
 * Open the target's pending working-tree changes (staged, unstaged and
 * untracked) in the panel's Git page.
 */
export function openPanelGitWorkingChanges(
    _dispatch: (action: AppAction) => void,
    target: PanelGitCommitTarget,
): void {
    openPanelGitView(target, { type: 'working-tree-all' });
}

/**
 * Open the target's branch changes (its commits against the base branch) in
 * the panel's Git page.
 */
export function openPanelGitBranchChanges(
    _dispatch: (action: AppAction) => void,
    target: PanelGitCommitTarget,
): void {
    openPanelGitView(target, { type: 'branch-range' });
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

/** The explicit member a `coc://git` tab's own address names, or undefined. */
function gitMemberIdOfTab(browserUrl: string | undefined): string | undefined {
    if (!browserUrl) return undefined;
    const address = parseCocAddress(browserUrl);
    return 'error' in address || address.kind !== 'git' ? undefined : address.gitMemberId;
}

/**
 * Who a Git tab's Open menu targets, from the tab's own owner fields and its
 * `coc://git` address: the repo itself, or the group member the address
 * names. A group tab with no member names no owner, so `owner` is null and
 * `choices` lists the live members for an explicit pick — the menu never
 * guesses one.
 */
export function gitTabOpenOwners(
    tab: Pick<UnifiedPanelTab, 'ownerWorkspaceId' | 'ownerRoutingRef' | 'browserUrl'>,
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
    const gitMemberId = gitMemberIdOfTab(tab.browserUrl);
    if (gitMemberId) {
        const label = members.find(member => member.workspaceId === gitMemberId)?.label ?? gitMemberId;
        return { owner: ownerOf(gitMemberId, label), choices: [] };
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
    tab: Pick<UnifiedPanelTab, 'ownerWorkspaceId' | 'ownerRoutingRef' | 'browserUrl'>,
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
