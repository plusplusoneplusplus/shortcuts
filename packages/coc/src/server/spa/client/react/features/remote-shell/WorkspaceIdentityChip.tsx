/**
 * WorkspaceIdentityChip — the active-workspace identity pill: status dot,
 * provider badge, remote-group name, `⧉N` clone-count badge, and a chevron that
 * opens the remote-group picker (`RepoPickerPopover`) with the add-repository
 * actions. Extracted from `RemoteScopeCluster` so the chip renders exactly once
 * whether identity lives in the cluster (legacy header) or in the
 * `ScopeSlideSwitcher`'s workspace segment.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useRepos } from '../../contexts/ReposContext';
import { isHidden as isHiddenTask } from '../../queue/hooks/useRepoQueueStats';
import { AddFolderDialog } from '../../repos/AddFolderDialog';
import { AddRepoDialog } from '../../repos/AddRepoDialog';
import { CloneRepoDialog } from '../../repos/CloneRepoDialog';
import { RepoGroupDialog } from '../../repos/RepoGroupDialog';
import { deleteRepoGroup } from '../../repos/repoGroupService';
import { isRepoGroupWorkspaceId } from '../../repos/virtualWorkspaceIds';
import { getRepoSelectionId, isRepoSelected } from '../../repos/cloneIdentity';
import { groupKey, groupReposByRemote, type RepoData, type RepoGroup } from '../../repos/repoGrouping';
import { getGroupRemoteServers, getGroupWsl } from '../../repos/repoPickerModel';
import { ContextMenu, type ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { Dialog } from '../../ui/Dialog';
import { ToastContainer, useToast } from '../../ui/Toast';
import { copyToClipboard } from '../../utils/format';
import { computeCloneStatusMap, describeRemoveBlock, summarizeRemote } from './shellModel';
import { RemoteProviderBadge } from './RemoteProviderBadge';
import { RemoteServerBadge } from './RemoteServerBadge';
import { useDropdownPopover } from './useDropdownPopover';
import { WslBadge } from './WslBadge';
import { PickerEmpty, PickerRow, PickerSection, RepoPickerPopover } from './RepoPickerPopover';
import { useRecentRemotes } from './useRecentRemotes';
import { useShellNavigation } from './useShellNavigation';
import { useWorkspaceRemoval } from './useWorkspaceRemoval';

export interface WorkspaceIdentityChipProps {
    repo?: RepoData;
    repos: RepoData[];
    /**
     * When set, the chip is showing an *inactive* workspace (a virtual scope like
     * My Work / My Life is the active scope). Clicking the identity body then
     * switches back to this workspace instead of opening the picker; the chevron
     * keeps opening the remote-group picker. When unset (workspace is the active
     * scope), the whole chip toggles the picker as before. (AC-02)
     */
    onSwitchBack?: () => void;
    /**
     * When set, the chip shows a *repo-group virtual workspace*'s identity
     * (🗂️ + group name) instead of the repo's: neutral status dot, no provider
     * badge and no `⧉N` clone badge, since none of those describe the group —
     * they belong to whatever repo happens to be remembered underneath. The
     * chevron/picker is unchanged.
     *
     * Note this is a repo-*group virtual workspace*, unrelated to the `RepoGroup`
     * git-remote clustering that `activeGroupKey` / `data-remote-key` refer to;
     * the group id therefore gets its own `data-repo-group-id` attribute.
     */
    groupIdentity?: { id: string; name: string };
}

function Chevron() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
        </svg>
    );
}

function KebabGlyph() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
        </svg>
    );
}

/** Stacked-layers icon marking repo-group entries apart from plain repos. */
function RepoGroupGlyph() {
    return (
        <svg data-testid="repo-group-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l9 5-9 5-9-5 9-5z" />
            <path d="M3 13l9 5 9-5" />
        </svg>
    );
}

function CloneGlyph() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
        </svg>
    );
}

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

const unreadBadgeClass = 'min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none';

function formatUnreadCount(count: number): string {
    return count > 99 ? '99+' : String(count);
}

function groupMatchesSearch(group: RepoGroup, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return group.label.toLowerCase().includes(q)
        || groupKey(group).toLowerCase().includes(q)
        || group.repos.some(repo => String(repo.workspace.name ?? '').toLowerCase().includes(q));
}

export function WorkspaceIdentityChip({ repo, repos, onSwitchBack, groupIdentity }: WorkspaceIdentityChipProps) {
    const cloneId = repo ? getRepoSelectionId(repo) : '';
    const { state: queueState } = useQueue();
    const { state: appState } = useApp();
    const { fetchRepos, unseenCounts, remoteGroupWorkspaces } = useRepos();
    const { selectClone } = useShellNavigation();
    const { toasts, addToast, removeToast } = useToast();

    const [showAll, setShowAll] = useState(false);
    const [query, setQuery] = useState('');
    const [addFolderOpen, setAddFolderOpen] = useState(false);
    const [addRepoOpen, setAddRepoOpen] = useState(false);
    const [cloneOpen, setCloneOpen] = useState(false);
    const [rowMenu, setRowMenu] = useState<{ repo: RepoData; x: number; y: number } | null>(null);
    const [groupMenu, setGroupMenu] = useState<{ workspace: any; x: number; y: number } | null>(null);
    const [groupDialog, setGroupDialog] = useState<{ groupId: string | null; baseUrl?: string } | null>(null);
    const [groupDeleteTarget, setGroupDeleteTarget] = useState<any | null>(null);
    const [groupDeleting, setGroupDeleting] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const lastCloneByRemote = useRef<Record<string, string>>({});
    const { open, toggle, close, searchRef } = useDropdownPopover(rootRef, triggerRef);

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

    // The picker's add-repository actions target the server the chip is showing:
    // opened on a remote workspace they add to THAT box, not the local one.
    const addTargetServer = useMemo(() => {
        const remote = (repo?.workspace as { remote?: { serverId?: unknown; baseUrl?: unknown } } | undefined)?.remote;
        if (typeof remote?.serverId !== 'string' || !remote.serverId) return null;
        return {
            serverId: remote.serverId,
            baseUrl: typeof remote.baseUrl === 'string' ? remote.baseUrl : undefined,
        };
    }, [repo]);
    const { recentGroups, remainingGroups, recordUse } = useRecentRemotes(groups);

    useEffect(() => {
        if (activeGroupKey) {
            lastCloneByRemote.current[activeGroupKey] = cloneId;
        }
    }, [activeGroupKey, cloneId]);

    const chooseGroup = useCallback((group: RepoGroup) => {
        const key = groupKey(group);
        const remembered = lastCloneByRemote.current[key];
        const target = remembered && group.repos.some(r => isRepoSelected(r, repos, remembered))
            ? remembered
            : (group.repos[0] ? getRepoSelectionId(group.repos[0]) : undefined);
        if (target) {
            recordUse(key);
            selectClone(target);
        }
        close();
        setShowAll(false);
        setQuery('');
    }, [repos, recordUse, selectClone, close]);

    const { requestRemove, removeDialog } = useWorkspaceRemoval({ repos, selectedRepo: repo, addToast });

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
            onClick: () => { setRowMenu(null); close(); void copyRepoPath(rowRepo); },
        }, {
            label: 'Remove from CoC',
            icon: 'X',
            disabled: !!block,
            title: block ?? undefined,
            onClick: () => { setRowMenu(null); close(); requestRemove(rowRepo); },
        }];
    }, [cloneStatus, close, copyRepoPath, requestRemove]);

    // Repo-group virtual workspaces come from the full AppContext workspace
    // list — `repos` only carries non-virtual workspaces (ReposContext filters
    // them for the grid), so groups would never surface from it.
    // Remote servers contribute their own groups through the aggregation, which
    // keeps them out of `repos` (a group is not a repository card). Merging them
    // here is what puts a remote group in the same "Repo groups" section as a
    // local one, tagged with its server. (AC-02)
    const repoGroupWorkspaces = useMemo(() => {
        const local = ((appState.workspaces ?? []) as any[]).filter(ws => isRepoGroupWorkspaceId(ws?.id));
        const remote = ((remoteGroupWorkspaces ?? []) as any[]).filter(ws => isRepoGroupWorkspaceId(ws?.id));
        return remote.length > 0 ? [...local, ...remote] : local;
    }, [appState.workspaces, remoteGroupWorkspaces]);
    const filteredRepoGroupWorkspaces = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return repoGroupWorkspaces;
        return repoGroupWorkspaces.filter(ws =>
            String(ws.name ?? '').toLowerCase().includes(q) || String(ws.id).toLowerCase().includes(q));
    }, [repoGroupWorkspaces, query]);

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

    const buildGroupMenuItems = useCallback((groupWs: any): ContextMenuItem[] => [{
        label: 'Edit group',
        icon: '✎',
        onClick: () => { setGroupMenu(null); close(); setGroupDialog({ groupId: String(groupWs.id), baseUrl: groupWs?.remote?.baseUrl }); },
    }, {
        label: 'Delete group',
        icon: 'X',
        onClick: () => { setGroupMenu(null); close(); setGroupDeleteTarget(groupWs); },
    }], [close]);

    const filteredGroups = query.trim()
        ? groups.filter(group => groupMatchesSearch(group, query))
        : [...recentGroups, ...(showAll ? remainingGroups : [])];
    const showAllCount = remainingGroups.length;

    // Group rows never surface an offline state: a remote group aggregates clones
    // with independent connection states, so offline is only meaningful per-clone
    // (handled by the virtual repo picker). The aggregate status color dot is shown
    // instead. See repo-picker-convergence plan, open question 3.
    const renderGroupRow = (group: RepoGroup) => {
        const key = groupKey(group);
        const summary = summarizeRemote(group, cloneStatus, unseenCounts);
        const isActive = key === activeGroupKey;
        // Removal is per clone, never per group: a group row only offers Remove
        // when it *is* a single clone. Multi-clone groups drill into the clone
        // list (the clone popover), which offers Remove per clone. (AC-01)
        const soleClone = group.repos.length === 1 ? group.repos[0] : null;
        // All-or-nothing: the group row is only marked WSL when every clone under
        // it is WSL-hosted; a mixed group stays unmarked and the per-clone rows
        // carry the distinction. (AC-03)
        const groupWsl = getGroupWsl(group);
        // Any-semantics, unlike the WSL pill: one remote clone is enough to mark
        // the collection as reaching another CoC server.
        const remoteServers = getGroupRemoteServers(group);
        return (
            <PickerRow
                key={key}
                testId="remote-dropdown-item"
                remoteKey={key}
                active={isActive}
                colorDot={summary.color}
                name={summary.name}
                sublabel={group.label}
                onClick={() => chooseGroup(group)}
                rowMenu={soleClone ? (
                    <button
                        data-testid="remote-dropdown-row-menu"
                        data-remote-key={key}
                        aria-label={`More actions for ${summary.name}`}
                        title="More actions"
                        onClick={e => {
                            e.stopPropagation();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setRowMenu({ repo: soleClone, x: rect.left, y: rect.bottom });
                        }}
                        className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 mr-1 rounded text-[#848484] dark:text-[#777] hover:bg-black/[0.06] dark:hover:bg-white/[0.10]"
                    >
                        <KebabGlyph />
                    </button>
                ) : undefined}
                badges={
                    <>
                        {remoteServers.length > 0 && <RemoteServerBadge servers={remoteServers} />}
                        {groupWsl && <WslBadge distro={groupWsl.distro} />}
                        {summary.cloneCount > 1 && (
                            <span className="inline-flex items-center gap-0.5 h-[16px] px-1.5 rounded-full text-[10px] font-semibold leading-none bg-black/[0.06] dark:bg-white/[0.10] text-[#555] dark:text-[#bbb]">
                                <CloneGlyph />
                                {summary.cloneCount}
                            </span>
                        )}
                        {summary.unseen > 0 && (
                            <span
                                className={unreadBadgeClass}
                                data-testid="remote-unseen-badge"
                                aria-label={`${summary.unseen} unread`}
                            >
                                {formatUnreadCount(summary.unseen)}
                            </span>
                        )}
                    </>
                }
            />
        );
    };

    const displayName = groupIdentity
        ? groupIdentity.name
        : (activeSummary?.name ?? (repo?.workspace.name ?? 'Select repository'));
    const chipTitle = groupIdentity
        ? groupIdentity.name
        : (activeGroup?.label ?? (repo?.workspace.name ?? 'Select repository'));
    // The dot + provider badge + name + `⧉N` cluster, shared by the single-button
    // (workspace active) and split (virtual scope active) layouts.
    //
    // In group mode every repo-derived part is dropped rather than reused: the
    // remembered repo's health color, its provider and its clone count would all
    // read as facts about the group. The chip has no member data of its own, so
    // it shows a neutral dot and the 🗂️ marker every other repo-group surface
    // (`getRepoGroupHeaderConfig`, the inline and shell headers) already uses.
    const identityInner = (
        <>
            <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: groupIdentity ? '#848484' : (activeSummary?.color ?? '#848484') }} aria-hidden />
            {groupIdentity ? (
                <span data-testid="remote-chip-group-icon" aria-hidden>🗂️</span>
            ) : (
                <RemoteProviderBadge
                    normalizedUrl={activeGroup?.normalizedUrl}
                    testId="remote-provider-badge"
                    className="hidden xl:inline-flex items-center text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#848484] dark:text-[#777]"
                />
            )}
            <span className="truncate">{displayName}</span>
            {!groupIdentity && activeSummary && activeSummary.cloneCount > 1 && (
                <span className="hidden lg:inline-flex items-center gap-0.5 h-[16px] px-1.5 rounded-full text-[10px] font-semibold leading-none bg-black/[0.06] dark:bg-white/[0.10] text-[#555] dark:text-[#bbb]">
                    <CloneGlyph />
                    {activeSummary.cloneCount}
                </span>
            )}
        </>
    );

    return (
        <div className="relative flex items-center min-w-0 flex-shrink-0" ref={rootRef}>
            {onSwitchBack ? (
                // Inactive workspace under a virtual scope: identity body switches
                // back to this workspace, chevron opens the picker. (AC-02)
                <div className="relative inline-flex items-center rounded-md text-[12.5px] font-semibold text-[#1f2328] dark:text-[#cccccc] max-w-[190px]">
                    <button
                        data-testid="remote-chip"
                        data-remote-key={activeGroupKey ?? ''}
                        data-repo-group-id={groupIdentity?.id}
                        title={`Switch to ${chipTitle}`}
                        aria-label={`Switch to ${displayName}`}
                        onClick={onSwitchBack}
                        className="relative inline-flex items-center gap-1.5 h-[26px] pl-2 pr-1 rounded-l-md min-w-0 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    >
                        {identityInner}
                    </button>
                    <button
                        ref={triggerRef}
                        data-testid="remote-chip-chevron"
                        aria-haspopup="menu"
                        aria-expanded={open}
                        aria-label="Open remote picker"
                        title="Switch remote"
                        onClick={toggle}
                        className="relative inline-flex items-center h-[26px] pl-1 pr-2 rounded-r-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    >
                        <Chevron />
                    </button>
                </div>
            ) : (
                <button
                    ref={triggerRef}
                    data-testid="remote-chip"
                    data-remote-key={activeGroupKey ?? ''}
                    data-repo-group-id={groupIdentity?.id}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    title={chipTitle}
                    onClick={toggle}
                    className="relative inline-flex items-center gap-1.5 h-[26px] px-2 rounded-md text-[12.5px] font-semibold text-[#1f2328] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] max-w-[190px]"
                >
                    {identityInner}
                    <Chevron />
                </button>
            )}

            <RepoPickerPopover
                open={open}
                dropdownTestId="remote-dropdown"
                searchTestId="remote-search-input"
                searchRef={searchRef}
                searchPlaceholder="Search remotes and groups"
                query={query}
                onQueryChange={setQuery}
                footer={
                    <div className="mt-1 pt-1 border-t border-[#eaeef2] dark:border-[#3c3c3c]">
                        <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]">Add repository</div>
                        <button
                            data-testid="remote-add-folder-option"
                            role="menuitem"
                            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10"
                            onClick={() => { close(); setAddFolderOpen(true); }}
                        >
                            <PlusIcon />
                            Add workspace folder
                        </button>
                        <button
                            data-testid="remote-add-repo-option"
                            role="menuitem"
                            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10"
                            onClick={() => { close(); setAddRepoOpen(true); }}
                        >
                            <PlusIcon />
                            Add specific repository
                        </button>
                        <button
                            data-testid="remote-clone-repo-option"
                            role="menuitem"
                            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10"
                            onClick={() => { close(); setCloneOpen(true); }}
                        >
                            <CloneGlyph />
                            Clone repository
                        </button>
                        <button
                            data-testid="remote-new-repo-group-option"
                            role="menuitem"
                            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10"
                            onClick={() => { close(); setGroupDialog({ groupId: null }); }}
                        >
                            <RepoGroupGlyph />
                            New repo group…
                        </button>
                    </div>
                }
            >
                <PickerSection label="Repo groups" />
                {filteredRepoGroupWorkspaces.length > 0 ? (
                    filteredRepoGroupWorkspaces.map(ws => {
                        // A remote group carries the aggregation's marker; a local
                        // one has none. `offline` follows the contributing server,
                        // and an offline group is read-only — no ⋮ menu, so Edit and
                        // Delete are simply unavailable until it reconnects. (AC-04)
                        const remote = ws?.remote as { serverLabel?: string; offline?: boolean } | undefined;
                        const offline = !!remote?.offline;
                        return (
                            // Row click switches the dashboard to the group's virtual
                            // workspace (RepoGroupView) through the same target-aware
                            // navigation repos use; for a remote group the clone
                            // registry already maps its id to the owning server's
                            // baseUrl, so every request from the view routes there.
                            // The ⋮ menu edits/deletes on that same server. (AC-02)
                            <PickerRow
                                key={String(ws.id)}
                                testId="repo-group-item"
                                remoteKey={String(ws.id)}
                                active={appState.selectedRepoId === String(ws.id)}
                                name={String(ws.name ?? ws.id)}
                                sublabel={remote ? `Repo group · ${remote.serverLabel ?? 'remote'}${offline ? ' (offline)' : ''}` : 'Repo group'}
                                offline={offline}
                                onClick={() => {
                                    selectClone(String(ws.id));
                                    close();
                                    setShowAll(false);
                                    setQuery('');
                                }}
                                badges={
                                    <>
                                        <RepoGroupGlyph />
                                        {remote && (
                                            <RemoteServerBadge
                                                testId="repo-group-server-badge"
                                                servers={remote.serverLabel ? [remote.serverLabel] : []}
                                            />
                                        )}
                                    </>
                                }
                                rowMenu={offline ? undefined : (
                                    <button
                                        data-testid="repo-group-row-menu"
                                        data-remote-key={String(ws.id)}
                                        aria-label={`More actions for ${ws.name ?? ws.id}`}
                                        title="More actions"
                                        onClick={e => {
                                            e.stopPropagation();
                                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                            setGroupMenu({ workspace: ws, x: rect.left, y: rect.bottom });
                                        }}
                                        className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 mr-1 rounded text-[#848484] dark:text-[#777] hover:bg-black/[0.06] dark:hover:bg-white/[0.10]"
                                    >
                                        <KebabGlyph />
                                    </button>
                                )}
                            />
                        );
                    })
                ) : (
                    <PickerEmpty>No repo groups</PickerEmpty>
                )}

                <div className="mt-1 border-t border-[#eaeef2] dark:border-[#3c3c3c]" />

                <PickerSection label={query.trim() ? 'Search results' : 'Recent remotes'} />
                {filteredGroups.length > 0 ? (
                    filteredGroups.map(group => renderGroupRow(group))
                ) : (
                    <PickerEmpty>No remotes found</PickerEmpty>
                )}
                {!query.trim() && showAllCount > 0 && (
                    <button
                        data-testid="remote-show-all-btn"
                        role="menuitem"
                        onClick={() => setShowAll(v => !v)}
                        className="mt-1 w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] font-semibold text-[#656d76] dark:text-[#999] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    >
                        <span>{showAll ? 'Hide all' : `Show all (${showAllCount})`}</span>
                        <Chevron />
                    </button>
                )}
            </RepoPickerPopover>

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

            {rowMenu && (
                <ContextMenu
                    position={{ x: rowMenu.x, y: rowMenu.y }}
                    items={buildRowMenuItems(rowMenu.repo)}
                    onClose={() => setRowMenu(null)}
                />
            )}
            {groupMenu && (
                <ContextMenu
                    position={{ x: groupMenu.x, y: groupMenu.y }}
                    items={buildGroupMenuItems(groupMenu.workspace)}
                    onClose={() => setGroupMenu(null)}
                />
            )}
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
        </div>
    );
}
