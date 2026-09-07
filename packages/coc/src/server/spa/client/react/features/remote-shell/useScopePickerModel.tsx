/**
 * useScopePickerModel — the headless model behind every scope picker surface.
 *
 * The desktop dropdown (`WorkspaceIdentityChip` → `RepoPickerPopover`), the
 * mobile bottom sheet (`ScopePickerSheet`) and the mobile scope list
 * (`MobileScopeList`) all pick from the same four sections:
 *
 *   1. Pinned scopes      — `usePinnedScopes` + `resolvePinnedScopes`
 *   2. Virtual scopes     — My Work / My Life
 *   3. Repo groups        — `group-*` virtual workspaces (local + remote)
 *   4. Git-remote clusters — `groupReposByRemote` ("remotes")
 *
 * Composing those rows once, here, is what stops the two shells drifting into
 * different behavior for the same list — which is exactly what happened before:
 * the mobile grid navigated through `navigateToWorkspace` directly and so never
 * recorded `RECORD_REMOTE_CLONE`, and a mobile pick did not carry back to
 * desktop.
 *
 * The hook also owns every side surface a row can open (add/clone/group dialogs,
 * the delete confirm, the removal flow, toasts) and hands them back as one
 * `dialogs` node the caller renders in its own tree.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useRepos } from '../../contexts/ReposContext';
import { useMyLifeEnabled } from '../../hooks/feature-flags/useMyLifeEnabled';
import { useMyWorkEnabled } from '../../hooks/feature-flags/useMyWorkEnabled';
import { usePinnedScopesEnabled } from '../../hooks/feature-flags/usePinnedScopesEnabled';
import { useScopeNavigation } from '../../hooks/useScopeNavigation';
import { isHidden as isHiddenTask } from '../../queue/hooks/useRepoQueueStats';
import { AddFolderDialog } from '../../repos/AddFolderDialog';
import { AddRepoDialog } from '../../repos/AddRepoDialog';
import { CloneRepoDialog } from '../../repos/CloneRepoDialog';
import { RepoGroupDialog } from '../../repos/RepoGroupDialog';
import { deleteRepoGroup } from '../../repos/repoGroupService';
import { MY_LIFE_WORKSPACE_ID, MY_WORK_WORKSPACE_ID, isRepoGroupWorkspaceId } from '../../repos/virtualWorkspaceIds';
import { getRepoSelectionId, isRepoSelected, pickCloneForGroup } from '../../repos/cloneIdentity';
import { groupKey, groupReposByRemote, type RepoData, type RepoGroup } from '../../repos/repoGrouping';
import { getGroupRemoteServers, getGroupWsl, type RepoWslInfo } from '../../repos/repoPickerModel';
import type { ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { Dialog } from '../../ui/Dialog';
import { ToastContainer, useToast } from '../../ui/Toast';
import { copyToClipboard } from '../../utils/format';
import { computeCloneStatusMap, describeRemoveBlock, summarizeRemote, type CloneStatus, type RemoteSummary } from './shellModel';
import { isPinnedScope, resolvePinnedScopes, type PinnedScopeRef, type ResolvedPinnedScope } from './pinnedScopes';
import { usePinnedScopes } from './usePinnedScopes';
import { useRecentRemotes } from './useRecentRemotes';
import { useShellNavigation } from './useShellNavigation';
import { useWorkspaceRemoval } from './useWorkspaceRemoval';

/**
 * The path a repo row copies to the clipboard.
 *
 * `copyPath` is the server-resolved, host-reachable form of the workspace root
 * (the Windows `\\wsl.localhost\<distro>\…` UNC path when the CoC server runs
 * natively inside WSL, and the plain path everywhere else). Older payloads and
 * remote sources that predate the field fall back to the raw workspace path.
 * `RepoData.workspace` is untyped, so every candidate is guarded.
 */
export function resolveRepoCopyPath(repo: RepoData): string | null {
    const ws = repo.workspace as { copyPath?: unknown; path?: unknown; rootPath?: unknown } | undefined;
    for (const candidate of [ws?.copyPath, ws?.path, ws?.rootPath]) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate;
        }
    }
    return null;
}

/** Does this git-remote cluster match the picker's search box? */
export function groupMatchesSearch(group: RepoGroup, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return group.label.toLowerCase().includes(q)
        || groupKey(group).toLowerCase().includes(q)
        || group.repos.some(repo => String(repo.workspace.name ?? '').toLowerCase().includes(q));
}

/** Does this repo-group virtual workspace match the picker's search box? */
export function repoGroupMatchesSearch(workspace: { id?: unknown; name?: unknown }, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return String(workspace.name ?? '').toLowerCase().includes(q)
        || String(workspace.id ?? '').toLowerCase().includes(q);
}

/** One git-remote cluster row ("remote"): the clones sharing an origin URL. */
export interface ScopePickerRemoteRow {
    kind: 'remote';
    /** `groupKey(group)` — the row's `data-remote-key`. */
    key: string;
    group: RepoGroup;
    summary: RemoteSummary;
    /** All-or-nothing WSL marker; `null` for a mixed or non-WSL cluster. */
    wsl: RepoWslInfo | null;
    /** Any-semantics remote-server names; empty for a local-only cluster. */
    remoteServers: string[];
    active: boolean;
    /**
     * The cluster's only clone when it has exactly one — removal is per clone,
     * never per cluster, so the `⋮` menu only appears here.
     */
    soleClone: RepoData | null;
    pinRef: PinnedScopeRef;
}

/** One repo-group virtual workspace row (a `group-*` workspace). */
export interface ScopePickerGroupRow {
    kind: 'group';
    id: string;
    workspace: any;
    name: string;
    sublabel: string;
    /** Follows the contributing server; an offline group is read-only. */
    offline: boolean;
    serverLabel: string | null;
    /** True when the group was aggregated from another CoC server. */
    isRemote: boolean;
    active: boolean;
    pinRef: PinnedScopeRef;
}

/** My Work / My Life. */
export interface ScopePickerVirtualRow {
    kind: 'virtual';
    id: string;
    icon: string;
    label: string;
    active: boolean;
    onSelect: () => void;
}

export interface ScopePickerFooterAction {
    key: string;
    testId: string;
    label: string;
    icon: 'plus' | 'clone' | 'group';
    onClick: () => void;
}

export interface ScopePickerModelOptions {
    /**
     * Called after any row selection or footer action, so the hosting popover /
     * sheet can dismiss itself. The model never assumes a container.
     */
    onClose?: () => void;
    /**
     * The workspace whose server the "Add repository" actions target, so a
     * picker opened on a remote workspace adds to THAT box, not the local one.
     */
    addTargetRepo?: RepoData;
}

export interface ScopePickerModel {
    query: string;
    setQuery: (value: string) => void;
    showAll: boolean;
    setShowAll: (value: boolean | ((prev: boolean) => boolean)) => void;
    /** How many clusters the "Show all" toggle would reveal. */
    showAllCount: number;

    /** Every git-remote cluster, unfiltered and unordered. */
    groups: RepoGroup[];
    /** Per-clone status, for status dots and remove-blocking. */
    cloneStatus: Record<string, CloneStatus>;
    activeGroup: RepoGroup | null;
    activeGroupKey: string | null;
    activeSummary: RemoteSummary | null;

    /** Section 1 — pinned scopes, resolved against what exists right now. */
    pinnedRows: ResolvedPinnedScope[];
    /** Section 2 — My Work / My Life, filtered by their flags and the search box. */
    virtualRows: ScopePickerVirtualRow[];
    /** Section 3 — repo-group virtual workspaces (local + remote), search-filtered. */
    groupRows: ScopePickerGroupRow[];
    /** Section 4 — recent (or search-matching) git-remote clusters. */
    remoteRows: ScopePickerRemoteRow[];
    /** Build a cluster row for a caller-supplied ordering (the mobile list). */
    buildRemoteRow: (group: RepoGroup) => ScopePickerRemoteRow;
    footerActions: ScopePickerFooterAction[];

    /** Open a cluster on the clone the user was last on, else its primary. */
    chooseGroup: (group: RepoGroup) => void;
    /** Open a specific clone / virtual workspace by selection id. */
    selectScope: (id: string) => void;

    pinnedScopesEnabled: boolean;
    isPinned: (ref: PinnedScopeRef) => boolean;
    pinsFull: boolean;
    togglePin: (ref: PinnedScopeRef) => void;

    /** Copy path / Remove from CoC for a clone. */
    buildRowMenuItems: (repo: RepoData) => ContextMenuItem[];
    /** Edit / Delete for a repo-group virtual workspace. */
    buildGroupMenuItems: (workspace: any) => ContextMenuItem[];
    /** Every dialog, confirm and toast the rows can open. Render once. */
    dialogs: ReactNode;
}

export function useScopePickerModel(repos: RepoData[], options?: ScopePickerModelOptions): ScopePickerModel {
    const { onClose, addTargetRepo } = options ?? {};
    const { state: queueState } = useQueue();
    const { state: appState, dispatch } = useApp();
    const { fetchRepos, unseenCounts, remoteGroupWorkspaces } = useRepos();
    const { selectClone } = useShellNavigation();
    const { goToMyWork, goToMyLife } = useScopeNavigation();
    const { toasts, addToast, removeToast } = useToast();
    const myWorkEnabled = useMyWorkEnabled();
    const myLifeEnabled = useMyLifeEnabled();

    const [query, setQuery] = useState('');
    const [showAll, setShowAll] = useState(false);
    const [addFolderOpen, setAddFolderOpen] = useState(false);
    const [addRepoOpen, setAddRepoOpen] = useState(false);
    const [cloneOpen, setCloneOpen] = useState(false);
    const [groupDialog, setGroupDialog] = useState<{ groupId: string | null; baseUrl?: string } | null>(null);
    const [groupDeleteTarget, setGroupDeleteTarget] = useState<any | null>(null);
    const [groupDeleting, setGroupDeleting] = useState(false);

    const close = useCallback(() => { onClose?.(); }, [onClose]);

    const cloneId = addTargetRepo ? getRepoSelectionId(addTargetRepo) : '';
    const groups = useMemo(() => groupReposByRemote(repos, {}), [repos]);
    const cloneStatus = useMemo(
        () => computeCloneStatusMap(repos, queueState.repoQueueMap, isHiddenTask),
        [repos, queueState.repoQueueMap],
    );
    const activeGroup = useMemo(() => {
        return groups.find(g => g.repos.some(r => isRepoSelected(r, repos, cloneId))) ?? null;
    }, [groups, repos, cloneId]);
    const activeGroupKey = activeGroup ? groupKey(activeGroup) : null;
    const activeSummary = activeGroup ? summarizeRemote(activeGroup, cloneStatus, unseenCounts) : null;

    // The picker's add-repository actions target the server the picker is showing:
    // opened on a remote workspace they add to THAT box, not the local one.
    const addTargetServer = useMemo(() => {
        const remote = (addTargetRepo?.workspace as { remote?: { serverId?: unknown; baseUrl?: unknown } } | undefined)?.remote;
        if (typeof remote?.serverId !== 'string' || !remote.serverId) return null;
        return {
            serverId: remote.serverId,
            baseUrl: typeof remote.baseUrl === 'string' ? remote.baseUrl : undefined,
        };
    }, [addTargetRepo]);

    const { recentGroups, remainingGroups, recordUse } = useRecentRemotes(groups);
    const pinnedScopesEnabled = usePinnedScopesEnabled();
    const { pins, toggle: togglePin, full: pinsFull } = usePinnedScopes();
    const isPinned = useCallback((ref: PinnedScopeRef) => isPinnedScope(pins, ref), [pins]);

    // Remember which clone of the active cluster the user is on, so the picker
    // row AND a pinned repo tab both return here rather than to the cluster's
    // primary. Recorded from the model because deciding the cluster needs the
    // full repo list and the grouping pass (the reducer has neither).
    useEffect(() => {
        if (!activeGroupKey || !cloneId) return;
        dispatch({ type: 'RECORD_REMOTE_CLONE', groupKey: activeGroupKey, cloneId });
    }, [activeGroupKey, cloneId, dispatch]);

    // Which clone of a cluster to open lives in ONE function shared with the
    // pinned scope segments (`resolvePinnedScopes`); the memory it reads lives in
    // AppContext (persisted), so the picker and the pins agree and both survive
    // a reload.
    const chooseGroup = useCallback((group: RepoGroup) => {
        const key = groupKey(group);
        const target = pickCloneForGroup(group, repos, appState.lastCloneByRemote?.[key]);
        if (target) {
            recordUse(key);
            selectClone(target);
        }
        close();
        setShowAll(false);
        setQuery('');
    }, [repos, appState.lastCloneByRemote, recordUse, selectClone, close]);

    const selectScope = useCallback((id: string) => {
        selectClone(id);
        close();
        setShowAll(false);
        setQuery('');
    }, [selectClone, close]);

    const { requestRemove, removeDialog } = useWorkspaceRemoval({ repos, selectedRepo: addTargetRepo, addToast });

    const copyRepoPath = useCallback(async (rowRepo: RepoData) => {
        const path = resolveRepoCopyPath(rowRepo);
        if (!path) {
            return;
        }
        try {
            await copyToClipboard(path);
            addToast('Path copied to clipboard', 'success');
        } catch {
            addToast('Could not copy path', 'error');
        }
    }, [addToast]);

    const buildRowMenuItems = useCallback((rowRepo: RepoData): ContextMenuItem[] => {
        const block = describeRemoveBlock(rowRepo, cloneStatus[String(rowRepo.workspace.id)]);
        const copyPath = resolveRepoCopyPath(rowRepo);
        return [{
            label: 'Copy path',
            icon: '📋',
            disabled: !copyPath,
            title: copyPath ?? 'This repository has no local path',
            onClick: () => { close(); void copyRepoPath(rowRepo); },
        }, {
            label: 'Remove from CoC',
            icon: 'X',
            disabled: !!block,
            title: block ?? undefined,
            onClick: () => { close(); requestRemove(rowRepo); },
        }];
    }, [cloneStatus, close, copyRepoPath, requestRemove]);

    const buildGroupMenuItems = useCallback((groupWs: any): ContextMenuItem[] => [{
        label: 'Edit group',
        icon: '✎',
        onClick: () => { close(); setGroupDialog({ groupId: String(groupWs.id), baseUrl: groupWs?.remote?.baseUrl }); },
    }, {
        label: 'Delete group',
        icon: 'X',
        onClick: () => { close(); setGroupDeleteTarget(groupWs); },
    }], [close]);

    // Repo-group virtual workspaces come from the full AppContext workspace
    // list — `repos` only carries non-virtual workspaces (ReposContext filters
    // them for the grid), so groups would never surface from it.
    // Remote servers contribute their own groups through the aggregation, which
    // keeps them out of `repos` (a group is not a repository card). Merging them
    // here is what puts a remote group in the same "Repo groups" section as a
    // local one, tagged with its server.
    const repoGroupWorkspaces = useMemo(() => {
        const local = ((appState.workspaces ?? []) as any[]).filter(ws => isRepoGroupWorkspaceId(ws?.id));
        const remote = ((remoteGroupWorkspaces ?? []) as any[]).filter(ws => isRepoGroupWorkspaceId(ws?.id));
        return remote.length > 0 ? [...local, ...remote] : local;
    }, [appState.workspaces, remoteGroupWorkspaces]);

    const groupRows = useMemo<ScopePickerGroupRow[]>(() => {
        return repoGroupWorkspaces
            .filter(ws => repoGroupMatchesSearch(ws, query))
            .map(ws => {
                const remote = ws?.remote as { serverLabel?: string; offline?: boolean } | undefined;
                const offline = !!remote?.offline;
                return {
                    kind: 'group' as const,
                    id: String(ws.id),
                    workspace: ws,
                    name: String(ws.name ?? ws.id),
                    sublabel: remote
                        ? `Repo group · ${remote.serverLabel ?? 'remote'}${offline ? ' (offline)' : ''}`
                        : 'Repo group',
                    offline,
                    serverLabel: remote?.serverLabel ?? null,
                    isRemote: !!remote,
                    active: appState.selectedRepoId === String(ws.id),
                    pinRef: { kind: 'group' as const, key: String(ws.id) },
                };
            });
    }, [repoGroupWorkspaces, query, appState.selectedRepoId]);

    const buildRemoteRow = useCallback((group: RepoGroup): ScopePickerRemoteRow => {
        const key = groupKey(group);
        return {
            kind: 'remote',
            key,
            group,
            summary: summarizeRemote(group, cloneStatus, unseenCounts),
            // All-or-nothing: only marked WSL when every clone under it is
            // WSL-hosted; a mixed cluster stays unmarked and the per-clone rows
            // carry the distinction.
            wsl: getGroupWsl(group),
            // Any-semantics, unlike the WSL pill: one remote clone is enough to
            // mark the collection as reaching another CoC server.
            remoteServers: getGroupRemoteServers(group),
            active: key === activeGroupKey,
            soleClone: group.repos.length === 1 ? group.repos[0] : null,
            pinRef: { kind: 'repo', key },
        };
    }, [cloneStatus, unseenCounts, activeGroupKey]);

    const filteredGroups = query.trim()
        ? groups.filter(group => groupMatchesSearch(group, query))
        : [...recentGroups, ...(showAll ? remainingGroups : [])];
    const remoteRows = useMemo(
        () => filteredGroups.map(buildRemoteRow),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [filteredGroups.map(g => groupKey(g)).join(' '), buildRemoteRow, groups],
    );

    const virtualRows = useMemo<ScopePickerVirtualRow[]>(() => {
        const rows: ScopePickerVirtualRow[] = [];
        if (myWorkEnabled) {
            rows.push({
                kind: 'virtual',
                id: MY_WORK_WORKSPACE_ID,
                icon: '💼',
                label: 'My Work',
                active: appState.selectedRepoId === MY_WORK_WORKSPACE_ID,
                onSelect: () => { goToMyWork(); close(); setQuery(''); },
            });
        }
        if (myLifeEnabled) {
            rows.push({
                kind: 'virtual',
                id: MY_LIFE_WORKSPACE_ID,
                icon: '🏠',
                label: 'My Life',
                active: appState.selectedRepoId === MY_LIFE_WORKSPACE_ID,
                onSelect: () => { goToMyLife(); close(); setQuery(''); },
            });
        }
        const q = query.trim().toLowerCase();
        return q ? rows.filter(row => row.label.toLowerCase().includes(q)) : rows;
    }, [myWorkEnabled, myLifeEnabled, appState.selectedRepoId, goToMyWork, goToMyLife, close, query]);

    const pinnedRows = useMemo<ResolvedPinnedScope[]>(() => {
        if (!pinnedScopesEnabled) return [];
        return resolvePinnedScopes(pins, {
            groups,
            groupWorkspaces: repoGroupWorkspaces,
            cloneStatus,
            unseenCounts,
            lastCloneByRemote: appState.lastCloneByRemote,
        });
    }, [pinnedScopesEnabled, pins, groups, repoGroupWorkspaces, cloneStatus, unseenCounts, appState.lastCloneByRemote]);

    const footerActions = useMemo<ScopePickerFooterAction[]>(() => [
        {
            key: 'add-folder',
            testId: 'remote-add-folder-option',
            label: 'Add workspace folder',
            icon: 'plus',
            onClick: () => { close(); setAddFolderOpen(true); },
        },
        {
            key: 'add-repo',
            testId: 'remote-add-repo-option',
            label: 'Add specific repository',
            icon: 'plus',
            onClick: () => { close(); setAddRepoOpen(true); },
        },
        {
            key: 'clone-repo',
            testId: 'remote-clone-repo-option',
            label: 'Clone repository',
            icon: 'clone',
            onClick: () => { close(); setCloneOpen(true); },
        },
        {
            key: 'new-group',
            testId: 'remote-new-repo-group-option',
            label: 'New repo group…',
            icon: 'group',
            onClick: () => { close(); setGroupDialog({ groupId: null }); },
        },
    ], [close]);

    const doDeleteGroup = useCallback(async (groupWs: any) => {
        setGroupDeleting(true);
        try {
            await deleteRepoGroup(String(groupWs.id), groupWs?.remote?.baseUrl);
            setGroupDeleteTarget(null);
            await fetchRepos();
            addToast(`Deleted group ${groupWs.name ?? groupWs.id}`, 'success');
        } catch {
            addToast(`Failed to delete group ${groupWs.name ?? groupWs.id}`, 'error');
        } finally {
            setGroupDeleting(false);
        }
    }, [fetchRepos, addToast]);

    const dialogs = (
        <>
            <AddFolderDialog
                open={addFolderOpen}
                onClose={() => setAddFolderOpen(false)}
                serverId={addTargetServer?.serverId}
                baseUrl={addTargetServer?.baseUrl}
                onAdded={() => { setAddFolderOpen(false); fetchRepos(); }}
            />
            <AddRepoDialog
                open={addRepoOpen}
                onClose={() => setAddRepoOpen(false)}
                serverId={addTargetServer?.serverId}
                baseUrl={addTargetServer?.baseUrl}
                repos={repos}
                onSuccess={() => { setAddRepoOpen(false); fetchRepos(); }}
            />
            <CloneRepoDialog
                open={cloneOpen}
                onClose={() => setCloneOpen(false)}
                serverId={addTargetServer?.serverId}
                baseUrl={addTargetServer?.baseUrl}
                onSuccess={() => { setCloneOpen(false); fetchRepos(); }}
            />
            <RepoGroupDialog
                open={!!groupDialog}
                groupId={groupDialog?.groupId ?? null}
                groupBaseUrl={groupDialog?.baseUrl}
                repos={repos}
                onClose={() => setGroupDialog(null)}
                onSaved={() => { setGroupDialog(null); fetchRepos(); }}
            />
            {groupDeleteTarget && (
                <Dialog
                    open={true}
                    onClose={() => !groupDeleting && setGroupDeleteTarget(null)}
                    title="Delete repo group?"
                    id="repo-group-delete-dialog"
                    footer={
                        <>
                            <button
                                onClick={() => setGroupDeleteTarget(null)}
                                disabled={groupDeleting}
                                className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#f6f8fa] dark:bg-[#2a2a2a] border border-[#d0d7de] dark:border-[#3c3c3c] text-[#1f2328] dark:text-[#cccccc] hover:bg-[#eaeef2] dark:hover:bg-[#3c3c3c] transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                data-testid="repo-group-delete-confirm-btn"
                                onClick={() => doDeleteGroup(groupDeleteTarget)}
                                disabled={groupDeleting}
                                className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#cf222e] hover:bg-[#a40e26] text-white transition-colors disabled:opacity-50"
                            >
                                {groupDeleting ? 'Deleting...' : 'Delete'}
                            </button>
                        </>
                    }
                >
                    <p className="text-[13px]">
                        Delete <strong>{groupDeleteTarget.name ?? groupDeleteTarget.id}</strong> from CoC?
                    </p>
                    <p className="text-[12px] text-[#848484] dark:text-[#777] mt-1">
                        Member repos are not affected, and the group's data folder (notes, history) stays on disk - only the picker entry is removed.
                    </p>
                </Dialog>
            )}
            {removeDialog}
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </>
    );

    return {
        query,
        setQuery,
        showAll,
        setShowAll,
        showAllCount: remainingGroups.length,
        groups,
        cloneStatus,
        activeGroup,
        activeGroupKey,
        activeSummary,
        pinnedRows,
        virtualRows,
        groupRows,
        remoteRows,
        buildRemoteRow,
        footerActions,
        chooseGroup,
        selectScope,
        pinnedScopesEnabled,
        isPinned,
        pinsFull,
        togglePin,
        buildRowMenuItems,
        buildGroupMenuItems,
        dialogs,
    };
}
