import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useRepos } from '../../contexts/ReposContext';
import { useTerminalEnabled } from '../../hooks/feature-flags/useTerminalEnabled';
import { useNotesEnabled } from '../notes/hooks/useNotesEnabled';
import { useWorkflowsEnabled } from '../../hooks/feature-flags/useWorkflowsEnabled';
import { usePullRequestsEnabled } from '../../hooks/feature-flags/usePullRequestsEnabled';
import { useDreamsEnabled } from '../../hooks/feature-flags/useDreamsEnabled';
import { useNativeCliSessionsEnabled } from '../../hooks/feature-flags/useNativeCliSessionsEnabled';
import { useShowPlanDepTab } from '../../hooks/feature-flags/useShowPlanDepTab';
import { useUiLayoutMode } from '../../hooks/preferences/useUiLayoutMode';
import { isHidden as isHiddenTask, useRepoQueueStats } from '../../queue/hooks/useRepoQueueStats';
import { useGitInfo } from '../git/hooks/useGitInfo';
import { computeVisibleSubTabs, type SubTabDef } from '../repo-detail/repoSubTabs';
import { getRepoHashColor, getServerHashColor, groupKey, groupReposByRemote, isRemoteRepo, truncatePath } from '../../repos/repoGrouping';
import { getRepoSelectionId } from '../../repos/cloneIdentity';
import { cloneStatusColor, computeCloneStatusMap, computeVisibleTabKeys, partitionShellTabs, summarizeRemote } from './shellModel';
import { useShellNavigation } from './useShellNavigation';
import { useRecentRemotes } from './useRecentRemotes';
import { ContextMenu, type ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { Dialog } from '../../ui/Dialog';
import { ToastContainer, useToast } from '../../ui/Toast';
import { removeWorkspace } from '../../repos/repositoryService';
import { getHostname } from '../../utils/config';
import type { RepoData } from '../../repos/repoGrouping';
import type { RepoSubTab } from '../../types/dashboard';

export interface WorkspaceTabsClusterProps {
    repo: RepoData;
    repos: RepoData[];
}

function Chevron() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

const unreadBadgeClass = 'min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none';

function formatUnreadCount(count: number): string {
    return count > 99 ? '99+' : String(count);
}

export function WorkspaceTabsCluster({ repo, repos }: WorkspaceTabsClusterProps) {
    const ws = repo.workspace;
    const cloneId = String(ws.id);
    const { state } = useApp();
    const { state: queueState } = useQueue();
    const { selectClone, switchSubTab } = useShellNavigation();
    const { fetchRepos, unseenCounts } = useRepos();
    const { toasts, addToast, removeToast } = useToast();

    const terminalEnabled = useTerminalEnabled();
    const notesEnabled = useNotesEnabled();
    const workflowsEnabled = useWorkflowsEnabled();
    const pullRequestsEnabled = usePullRequestsEnabled();
    const dreamsEnabled = useDreamsEnabled();
    const nativeCliSessionsEnabled = useNativeCliSessionsEnabled();
    const showPlanDepTab = useShowPlanDepTab();
    const [uiLayoutMode] = useUiLayoutMode();
    const isGitRepo = !!repo.gitInfo?.isGitRepo;
    const activeTab = state.activeRepoSubTab;

    const { running: runningCount, queued: queuedCount } = useRepoQueueStats(cloneId);
    const { ahead: gitAhead, behind: gitBehind } = useGitInfo(cloneId);

    const tabs = useMemo(() => computeVisibleSubTabs({
        isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled,
        pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, showPlanDepTab, uiLayoutMode,
    }), [isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled, pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, showPlanDepTab, uiLayoutMode]);
    const { clone: cloneTabs } = useMemo(() => partitionShellTabs(tabs), [tabs]);

    const group = useMemo(() => {
        const groups = groupReposByRemote(repos, {});
        return groups.find(g => g.repos.some(r => getRepoSelectionId(r) === getRepoSelectionId(repo))) ?? null;
    }, [repos, repo]);
    const { recordUse: recordRemoteUse } = useRecentRemotes(group ? [group] : []);
    const clones = group?.repos ?? [repo];
    const cloneStatus = useMemo(
        () => computeCloneStatusMap(repos, queueState.repoQueueMap, isHiddenTask),
        [repos, queueState.repoQueueMap],
    );
    const remoteColor = getRepoHashColor(clones[0]?.workspace, getHostname() ?? 'local');
    const remoteLabel = group ? summarizeRemote(group, cloneStatus, {}).name : ws.name;

    const cloneUnreadTotal = useMemo(
        () => clones.reduce((sum, c) => sum + (unseenCounts[String(c.workspace.id)] ?? 0), 0),
        [clones, unseenCounts],
    );

    const [cloneOpen, setCloneOpen] = useState(false);
    const [ovOpen, setOvOpen] = useState(false);
    const [ctxMenu, setCtxMenu] = useState<{ repo: RepoData; x: number; y: number } | null>(null);
    const [infoRepo, setInfoRepo] = useState<RepoData | null>(null);
    const [removeRepo, setRemoveRepo] = useState<RepoData | null>(null);
    const [removing, setRemoving] = useState(false);
    const [visibleKeys, setVisibleKeys] = useState<Set<string> | null>(null);
    const cloneRef = useRef<HTMLDivElement>(null);
    const ovRef = useRef<HTMLDivElement>(null);
    const cloneRegionRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!cloneOpen && !ovOpen) return;
        const onDown = (e: MouseEvent) => {
            const target = e.target as Element | null;
            if (target?.closest?.('[data-testid="context-menu"]')) return;
            if (cloneOpen && cloneRef.current && !cloneRef.current.contains(e.target as Node)) setCloneOpen(false);
            if (ovOpen && ovRef.current && !ovRef.current.contains(e.target as Node)) setOvOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setCloneOpen(false);
                setOvOpen(false);
            }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [cloneOpen, ovOpen]);

    const recomputeOverflow = useCallback(() => {
        const region = cloneRegionRef.current;
        const measure = measureRef.current;
        if (!region || !measure) return;
        const containerWidth = region.clientWidth;
        const els = Array.from(measure.querySelectorAll<HTMLElement>('[data-measure-key]'));
        const measured = els.map(el => ({ key: el.getAttribute('data-measure-key') || '', width: el.offsetWidth }));
        const next = computeVisibleTabKeys(measured, containerWidth, activeTab);
        setVisibleKeys(prev => {
            if (next === null) return prev === null ? prev : null;
            if (prev !== null && prev.size === next.size && [...next].every(k => prev.has(k))) return prev;
            return next;
        });
    }, [activeTab]);

    useEffect(() => {
        const region = cloneRegionRef.current;
        if (!region) return;
        recomputeOverflow();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(recomputeOverflow);
        ro.observe(region);
        return () => ro.disconnect();
    }, [recomputeOverflow, cloneTabs]);

    const visibleCloneTabs = cloneTabs.filter(t => !visibleKeys || visibleKeys.has(t.key));
    const hiddenCloneTabs = visibleKeys ? cloneTabs.filter(t => !visibleKeys.has(t.key)) : [];
    const hasOverflow = hiddenCloneTabs.length > 0;
    const overflowActive = hiddenCloneTabs.some(t => t.key === activeTab);

    const buildMenuItems = useCallback((menuRepo: RepoData): ContextMenuItem[] => {
        const isRemote = isRemoteRepo(menuRepo);
        const close = () => {
            setCtxMenu(null);
            setCloneOpen(false);
        };
        return [
            {
                label: 'Repo info',
                icon: 'i',
                onClick: () => { close(); setInfoRepo(menuRepo); },
            },
            {
                label: 'Copy path',
                icon: 'Copy',
                onClick: () => {
                    close();
                    navigator.clipboard.writeText(menuRepo.workspace.rootPath ?? '').catch(() => {});
                },
            },
            { label: '', separator: true, onClick: () => {} },
            {
                label: 'Remove from CoC',
                icon: 'X',
                disabled: isRemote,
                onClick: () => { close(); setRemoveRepo(menuRepo); },
            },
        ];
    }, []);

    const doRemove = useCallback(async (menuRepo: RepoData) => {
        setRemoving(true);
        try {
            const removingSelected = getRepoSelectionId(menuRepo) === getRepoSelectionId(repo);
            await removeWorkspace(String(menuRepo.workspace.id));
            if (removingSelected) {
                const sibling = clones.find(c => getRepoSelectionId(c) !== getRepoSelectionId(menuRepo));
                if (sibling) {
                    selectClone(getRepoSelectionId(sibling));
                }
            }
            setRemoveRepo(null);
            await fetchRepos();
            addToast(`Removed ${menuRepo.workspace.name}`, 'success');
        } catch {
            addToast(`Failed to remove ${menuRepo.workspace.name}`, 'error');
        } finally {
            setRemoving(false);
        }
    }, [repo, clones, selectClone, fetchRepos, addToast]);

    const onTab = (key: RepoSubTab) => {
        switchSubTab(key);
        setOvOpen(false);
    };

    const badge = (key: RepoSubTab, forMeasure = false) => {
        const tid = (id: string) => (forMeasure ? {} : { 'data-testid': id });
        if ((key === 'activity' || key === 'chats') && runningCount > 0) {
            return <span {...tid('subbar-running-badge')} className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#16825d] text-white px-1 rounded-full">{runningCount}</span>;
        }
        if ((key === 'activity' || key === 'chats') && queuedCount > 0) {
            return <span {...tid('subbar-queued-badge')} className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#0078d4] text-white px-1 rounded-full">{queuedCount}</span>;
        }
        if (key === 'git' && (gitAhead > 0 || gitBehind > 0)) {
            return (
                <span className="ml-0.5 font-mono text-[10px] opacity-70">
                    {gitAhead > 0 && <span>↑{gitAhead}</span>}
                    {gitBehind > 0 && <span>↓{gitBehind}</span>}
                </span>
            );
        }
        return null;
    };

    const renderTab = (t: SubTabDef, testid: string) => {
        const isActive = activeTab === t.key;
        return (
            <button
                key={t.key}
                data-testid={testid}
                data-subtab={t.key}
                data-active={isActive ? 'true' : 'false'}
                aria-current={isActive ? 'page' : undefined}
                title={t.shortcut}
                onClick={() => onTab(t.key)}
                className={
                    'relative inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md text-[13px] whitespace-nowrap shrink-0 transition-colors ' +
                    (isActive
                        ? 'font-bold text-[#0969da] dark:text-[#79c0ff] shadow-[inset_0_-2px_0_#0969da] dark:shadow-[inset_0_-2px_0_#3794ff]'
                        : 'font-semibold text-[#656d76] dark:text-[#999] hover:text-[#1f2328] dark:hover:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]')
                }
            >
                {t.label}
                {badge(t.key)}
            </button>
        );
    };

    return (
        <div className="relative flex items-center gap-0.5 flex-1 min-w-0" data-testid="workspace-tabs-cluster">
            <div ref={measureRef} aria-hidden className="absolute invisible h-0 overflow-hidden flex items-center gap-0.5 pointer-events-none">
                {cloneTabs.map(t => (
                    <span
                        key={t.key}
                        data-measure-key={t.key}
                        className={'inline-flex items-center gap-1.5 h-[26px] px-2.5 text-[13px] whitespace-nowrap ' + (activeTab === t.key ? 'font-bold' : 'font-semibold')}
                    >
                        {t.label}
                        {badge(t.key, true)}
                    </span>
                ))}
            </div>

            <div className="relative flex-shrink-0" ref={cloneRef}>
                <button
                    data-testid="clone-switch"
                    onClick={() => setCloneOpen(o => !o)}
                    aria-haspopup="menu"
                    aria-expanded={cloneOpen}
                    title={ws.name}
                    className="relative inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[13px] font-semibold text-[#1f2328] dark:text-[#cccccc] hover:border-[#0078d4] dark:hover:border-[#0078d4] transition-colors"
                >
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: cloneStatusColor(cloneStatus[cloneId], remoteColor) }} aria-hidden />
                    <span className="max-w-[160px] truncate">{ws.name}</span>
                    {clones.length > 1 && <span className="text-[11px] text-[#848484] dark:text-[#777]">· {clones.length}</span>}
                    {cloneUnreadTotal > 0 && (
                        <span
                            className={`absolute -top-0.5 -right-0.5 ${unreadBadgeClass}`}
                            data-testid="clone-switch-unseen-badge"
                            aria-label={`${cloneUnreadTotal} unread conversations`}
                        >
                            {formatUnreadCount(cloneUnreadTotal)}
                        </span>
                    )}
                    <Chevron />
                </button>
                {cloneOpen && (
                    <div
                        className="absolute z-50 top-full left-0 mt-1 min-w-[280px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg p-1.5"
                        role="menu"
                        data-testid="clone-popover"
                    >
                        <div className="flex items-center justify-between px-2 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]">
                            <span className="truncate">{remoteLabel} · clones</span>
                            <span className="font-mono">{clones.length}</span>
                        </div>
                        {clones.map(c => {
                            const cid = String(c.workspace.id);
                            const selectionId = getRepoSelectionId(c);
                            const isSel = selectionId === getRepoSelectionId(repo);
                            const st = cloneStatus[cid];
                            const isRemote = isRemoteRepo(c);
                            const isOffline = isRemote && st === 'offline';
                            const serverLabel = isRemote
                                ? String((c.workspace as { remote?: { serverLabel?: unknown } }).remote?.serverLabel ?? 'remote')
                                : null;
                            const cloneUnreadCount = unseenCounts[cid] ?? 0;
                            return (
                                <button
                                    key={selectionId}
                                    data-testid="clone-popover-item"
                                    data-remote={isRemote ? 'true' : 'false'}
                                    data-clone-status={st ?? 'idle'}
                                    data-offline={isOffline ? 'true' : 'false'}
                                    disabled={isOffline}
                                    aria-disabled={isOffline}
                                    role="menuitem"
                                    title={isOffline ? `${c.workspace.name} · offline (server unreachable)` : undefined}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        setCtxMenu({ repo: c, x: e.clientX, y: e.clientY });
                                    }}
                                    onClick={() => {
                                        if (isOffline) return;
                                        if (group) recordRemoteUse(groupKey(group));
                                        selectClone(selectionId);
                                        setCloneOpen(false);
                                    }}
                                    className={
                                        'w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left transition-colors ' +
                                        (isOffline
                                            ? 'opacity-50 grayscale cursor-not-allowed'
                                            : (isSel ? 'bg-[#ddf4ff] dark:bg-[#3794ff]/15' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'))
                                    }
                                >
                                    <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5" style={{ background: cloneStatusColor(st, getRepoHashColor(c.workspace, getHostname() ?? 'local')) }} aria-hidden />
                                    <span className="flex-1 min-w-0">
                                        <span className="flex items-center gap-1.5 min-w-0">
                                            <span className={'min-w-0 text-[12.5px] font-semibold truncate ' + (isSel && !isOffline ? 'text-[#0969da] dark:text-[#79c0ff]' : 'text-[#1e1e1e] dark:text-[#cccccc]')}>{c.workspace.name}</span>
                                            {!isRemote && clones.length > 1 && clones.some(cl => isRemoteRepo(cl)) && <span className="text-[9px] font-bold uppercase px-1.5 py-px rounded bg-[#ddf4ff] dark:bg-[#3794ff]/20 text-[#0969da] dark:text-[#79c0ff]">Local</span>}
                                            {serverLabel && (
                                                <span
                                                    data-testid="clone-remote-badge"
                                                    title={`Remote · ${serverLabel}`}
                                                    style={{ color: getServerHashColor(serverLabel), backgroundColor: `${getServerHashColor(serverLabel)}1f` }}
                                                    className="inline-flex items-center max-w-[110px] truncate text-[9px] font-bold uppercase tracking-[0.04em] px-1.5 py-px rounded"
                                                >
                                                    {serverLabel}
                                                </span>
                                            )}
                                            {isOffline && (
                                                <span
                                                    data-testid="clone-offline-badge"
                                                    title="Server offline - showing last-known state"
                                                    className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.04em] px-1.5 py-px rounded bg-[#8c959f]/15 text-[#6e7781] dark:text-[#8c959f]"
                                                >
                                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#8c959f]" aria-hidden />
                                                    offline
                                                </span>
                                            )}
                                            {!isOffline && st === 'running' && <span className="text-[9px] font-bold uppercase px-1.5 py-px rounded bg-[#16a34a]/15 text-[#16a34a]">running</span>}
                                            {cloneUnreadCount > 0 && (
                                                <span
                                                    className={`${unreadBadgeClass} flex-shrink-0`}
                                                    data-testid="clone-row-unseen-badge"
                                                    aria-label={`${cloneUnreadCount} unread conversations`}
                                                >
                                                    {formatUnreadCount(cloneUnreadCount)}
                                                </span>
                                            )}
                                        </span>
                                        <span className="block font-mono text-[10.5px] text-[#848484] dark:text-[#777] truncate mt-0.5">{truncatePath(c.workspace.rootPath || '', 36)}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div ref={cloneRegionRef} className="flex items-center gap-0.5 flex-1 min-w-0 overflow-hidden" data-testid="clone-tab-region">
                {visibleCloneTabs.map(t => renderTab(t, 'clone-scope-tab'))}
            </div>

            {hasOverflow && (
                <div className="relative flex-shrink-0" ref={ovRef}>
                    <button
                        data-testid="subbar-overflow-toggle"
                        data-active={overflowActive ? 'true' : 'false'}
                        aria-label="More clone tabs"
                        aria-expanded={ovOpen}
                        aria-haspopup="menu"
                        title="More"
                        onClick={() => setOvOpen(o => !o)}
                        className={
                            'inline-flex items-center justify-center h-[26px] px-2 rounded-md text-[15px] leading-none transition-colors ' +
                            (overflowActive
                                ? 'font-bold text-[#0969da] dark:text-[#79c0ff] shadow-[inset_0_-2px_0_#0969da] dark:shadow-[inset_0_-2px_0_#3794ff]'
                                : 'text-[#656d76] dark:text-[#999] hover:text-[#1f2328] dark:hover:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]')
                        }
                    >
                        <span aria-hidden className="-mt-1">...</span>
                    </button>
                    {ovOpen && (
                        <div
                            className="absolute z-50 top-full right-0 mt-1 min-w-[190px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg p-1.5"
                            role="menu"
                            data-testid="subbar-overflow-menu"
                        >
                            <div className="px-2 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]">More · this clone</div>
                            {hiddenCloneTabs.map(t => {
                                const isActive = activeTab === t.key;
                                return (
                                    <button
                                        key={t.key}
                                        data-testid="overflow-menu-item"
                                        data-subtab={t.key}
                                        role="menuitem"
                                        onClick={() => onTab(t.key)}
                                        className={
                                            'w-full text-left flex items-center px-2 py-2 rounded-md text-[12.5px] transition-colors ' +
                                            (isActive
                                                ? 'bg-[#ddf4ff] dark:bg-[#3794ff]/15 text-[#0969da] dark:text-[#79c0ff] font-semibold'
                                                : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]')
                                        }
                                    >
                                        {t.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {ctxMenu && (
                <ContextMenu
                    position={{ x: ctxMenu.x, y: ctxMenu.y }}
                    items={buildMenuItems(ctxMenu.repo)}
                    onClose={() => setCtxMenu(null)}
                />
            )}

            {infoRepo && (
                <Dialog
                    open={true}
                    onClose={() => setInfoRepo(null)}
                    title="Repo info"
                    data-testid="clone-info-dialog"
                    footer={
                        <button
                            onClick={() => setInfoRepo(null)}
                            className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#f6f8fa] dark:bg-[#2a2a2a] border border-[#d0d7de] dark:border-[#3c3c3c] text-[#1f2328] dark:text-[#cccccc] hover:bg-[#eaeef2] dark:hover:bg-[#3c3c3c] transition-colors"
                        >
                            Close
                        </button>
                    }
                >
                    <div className="flex flex-col gap-2 text-[13px]" data-testid="clone-info-content">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Name</span>
                            <span className="font-semibold">{infoRepo.workspace.name}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Path</span>
                            <span className="font-mono text-[12px] break-all" data-testid="clone-info-path">{infoRepo.workspace.rootPath ?? '-'}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Branch</span>
                            <span className="font-mono text-[12px]" data-testid="clone-info-branch">{infoRepo.gitInfo?.branch ?? '-'}</span>
                        </div>
                        {(infoRepo.workspace.remoteUrl || infoRepo.gitInfo?.remoteUrl) && (
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Remote URL</span>
                                <span className="font-mono text-[12px] break-all">{infoRepo.workspace.remoteUrl ?? infoRepo.gitInfo?.remoteUrl ?? '-'}</span>
                            </div>
                        )}
                        {(infoRepo.gitInfo?.ahead != null || infoRepo.gitInfo?.behind != null || infoRepo.gitInfo?.dirty != null) && (
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Git status</span>
                                <span className="font-mono text-[12px]">
                                    {infoRepo.gitInfo?.dirty ? 'dirty · ' : 'clean · '}
                                    {infoRepo.gitInfo?.ahead != null && <>↑{infoRepo.gitInfo.ahead} </>}
                                    {infoRepo.gitInfo?.behind != null && <>↓{infoRepo.gitInfo.behind}</>}
                                </span>
                            </div>
                        )}
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Workspace ID</span>
                            <span className="font-mono text-[12px] text-[#848484] dark:text-[#777]">{infoRepo.workspace.id}</span>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                            {isRemoteRepo(infoRepo) ? (
                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[#8250df]/12 text-[#8250df] dark:bg-[#a371f7]/15 dark:text-[#a371f7]">Remote</span>
                            ) : (
                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[#ddf4ff] dark:bg-[#3794ff]/20 text-[#0969da] dark:text-[#79c0ff]">Local</span>
                            )}
                        </div>
                    </div>
                </Dialog>
            )}

            {removeRepo && (
                <Dialog
                    open={true}
                    onClose={() => !removing && setRemoveRepo(null)}
                    title="Remove from CoC?"
                    data-testid="clone-remove-dialog"
                    footer={
                        <>
                            <button
                                onClick={() => setRemoveRepo(null)}
                                disabled={removing}
                                className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#f6f8fa] dark:bg-[#2a2a2a] border border-[#d0d7de] dark:border-[#3c3c3c] text-[#1f2328] dark:text-[#cccccc] hover:bg-[#eaeef2] dark:hover:bg-[#3c3c3c] transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                data-testid="clone-remove-confirm-btn"
                                onClick={() => doRemove(removeRepo)}
                                disabled={removing}
                                className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#cf222e] hover:bg-[#a40e26] text-white transition-colors disabled:opacity-50"
                            >
                                {removing ? 'Removing...' : 'Remove'}
                            </button>
                        </>
                    }
                >
                    <p className="text-[13px]">
                        Remove <strong>{removeRepo.workspace.name}</strong> from CoC?
                    </p>
                    <p className="text-[12px] text-[#848484] dark:text-[#777] mt-1">
                        The folder on disk is left untouched - only the CoC registration is removed.
                    </p>
                </Dialog>
            )}

            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </div>
    );
}
